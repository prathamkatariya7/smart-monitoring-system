import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { currentManager } from '../common/db/request-context';
import { newId } from '../common/util/id.util';
import { Alarm } from './entities/alarm.entity';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { NotificationsService } from '../notifications/notifications.service';
import { Process } from '../processes/entities/process.entity';
import { ProcessAttempt } from '../processes/entities/process-attempt.entity';
import { ThresholdVersion } from '../processes/entities/threshold-version.entity';

interface ThresholdLimits {
  min?: number;
  max?: number;
  rate_rise_max?: number; // max increase rate per minute (°C/min or RPM/min)
  rate_fall_max?: number; // max decrease rate per minute
}

/**
 * Part 6: server-side threshold evaluation (system of record, Part C-07 --
 * the device also evaluates locally for display/sound, but duplicates are
 * expected and the server never trusts the device's verdict). Static min/max
 * and rate-of-change (RoC) limits are evaluated here.
 */
@Injectable()
export class AlarmsService {
  private readonly logger = new Logger(AlarmsService.name);
  private readonly sampleHistory = new Map<
    string,
    Array<{ ts: number; t: number | null; rpm: number | null }>
  >();

  constructor(
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(): Promise<Alarm[]> {
    return currentManager().find(Alarm, { order: { onsetTs: 'DESC' }, take: 200 });
  }

  async listActiveForEquipment(equipmentId: string): Promise<Alarm[]> {
    return currentManager()
      .getRepository(Alarm)
      .createQueryBuilder('a')
      .where('a.equipment_id = :equipmentId', { equipmentId })
      .andWhere("a.state != 'NORMAL'")
      .orderBy('a.onset_ts', 'DESC')
      .getMany();
  }

  async get(id: string): Promise<Alarm> {
    const alarm = await currentManager().findOne(Alarm, { where: { id } });
    if (!alarm) throw new NotFoundException('Alarm not found');
    return alarm;
  }

  async ack(actor: AuthenticatedUser, id: string): Promise<Alarm> {
    const manager = currentManager();
    const alarm = await this.get(id);
    const nextState = alarm.state === 'ACTIVE_UNACK' ? 'ACTIVE_ACK' : alarm.state === 'RETURNED_UNACK' ? 'NORMAL' : alarm.state;
    await manager.update(Alarm, { id }, {
      state: nextState,
      ackBy: actor.userId,
      ackTs: new Date(),
    });

    await this.audit.record({
      userId: actor.userId,
      action: 'ALARM_ACKNOWLEDGED',
      entityType: 'alarm',
      entityId: id,
      equipmentId: alarm.equipmentId,
      newValue: { state: nextState },
    });
    return this.get(id);
  }

  /**
   * Called from the ingestion pipeline after each sample is written (Part
   * 6.1/6.2). Only evaluated when the sample belongs to a running attempt
   * with an APPROVED threshold version -- idle monitoring has no process
   * context to evaluate against yet.
   */
  async evaluateSample(
    equipmentId: string,
    laboratoryId: string,
    attemptId: string | null,
    values: { temperature_c?: number | null; rpm?: number | null; torque_ncm?: number | null },
  ): Promise<void> {
    const manager = currentManager();
    let approved: ThresholdVersion | null = null;
    let effectiveAttemptId: string | null = attemptId;

    if (attemptId) {
      const attempt = await manager.findOne(ProcessAttempt, { where: { id: attemptId } });
      if (attempt) {
        approved = await manager
          .getRepository(ThresholdVersion)
          .createQueryBuilder('t')
          .where('t.process_id = :processId', { processId: attempt.processId })
          .andWhere("t.status = 'APPROVED'")
          .getOne();
      }
    }

    if (!approved) {
      const activeProcess = await manager
        .getRepository(Process)
        .createQueryBuilder('p')
        .where('p.equipment_id = :equipmentId', { equipmentId })
        .andWhere("p.status IN ('RUNNING', 'ACCEPTED', 'SCHEDULED', 'PAUSED')")
        .orderBy('p.planned_start_utc', 'ASC')
        .getOne();
      if (activeProcess) {
        approved = await manager
          .getRepository(ThresholdVersion)
          .createQueryBuilder('t')
          .where('t.process_id = :processId', { processId: activeProcess.id })
          .andWhere("t.status = 'APPROVED'")
          .getOne();
      }
    }

    // Default safety limits (prevent thermal runaway / fire hazard even if unconfigured)
    const fallbackLimits: Record<string, ThresholdLimits> = {
      temperature: { max: 75.0, rate_rise_max: 5.0 },
      rpm: { max: 1000.0, rate_rise_max: 300.0 },
    };

    const params: Record<string, ThresholdLimits> = approved?.paramsJson
      ? (approved.paramsJson as Record<string, ThresholdLimits>)
      : fallbackLimits;

    const channels: Array<{ key: string; value: number | null | undefined }> = [
      { key: 'temperature', value: values.temperature_c },
      { key: 'rpm', value: values.rpm },
      { key: 'torque', value: values.torque_ncm },
    ];

    for (const { key, value } of channels) {
      const limits = params[key] ?? fallbackLimits[key];
      if (!limits || value === null || value === undefined) continue;

      const breached =
        (limits.min !== undefined && value < limits.min) ||
        (limits.max !== undefined && value > limits.max);

      await this.applyEvaluation(
        equipmentId,
        laboratoryId,
        effectiveAttemptId,
        key,
        'STATIC_LIMIT',
        breached,
        value,
        limits,
        approved?.id ?? null,
        value > (limits.max ?? 80) ? 'CRITICAL' : 'WARNING',
      );
    }

    // Rate-of-Change (RoC) evaluation (safety limit against rapid runaway / fire hazard)
    const now = Date.now();
    const points = this.sampleHistory.get(equipmentId) ?? [];
    points.push({ ts: now, t: values.temperature_c ?? null, rpm: values.rpm ?? null });
    while (points.length > 0 && now - points[0].ts > 120000) {
      points.shift();
    }
    this.sampleHistory.set(equipmentId, points);

    // Look back 10s to 45s to measure rate
    const past = points.find((p) => now - p.ts >= 15000) ?? (points.length >= 5 ? points[0] : null);
    if (past && now - past.ts >= 5000) {
      const dtMin = (now - past.ts) / 60000.0;
      if (dtMin > 0.04) {
        // Temperature RoC
        if (values.temperature_c !== null && values.temperature_c !== undefined && past.t !== null) {
          const tRoc = (values.temperature_c - past.t) / dtMin; // °C per minute
          const tLimits = params['temperature'] ?? fallbackLimits['temperature'];
          const maxRise = tLimits?.rate_rise_max ?? 5.0;
          const breachedRise = tRoc > maxRise;
          const breachedFall = tLimits?.rate_fall_max !== undefined && tRoc < -tLimits.rate_fall_max;
          await this.applyEvaluation(
            equipmentId,
            laboratoryId,
            effectiveAttemptId,
            'temperature_roc',
            'RATE_OF_CHANGE_LIMIT',
            breachedRise || breachedFall,
            Number(tRoc.toFixed(2)),
            tLimits ?? {},
            approved?.id ?? null,
            'CRITICAL',
          );
        }

        // RPM RoC
        if (values.rpm !== null && values.rpm !== undefined && past.rpm !== null) {
          const rpmRoc = (values.rpm - past.rpm) / dtMin; // RPM per minute
          const rLimits = params['rpm'] ?? fallbackLimits['rpm'];
          const maxRise = rLimits?.rate_rise_max ?? 300.0;
          const breachedRpm = rpmRoc > maxRise;
          await this.applyEvaluation(
            equipmentId,
            laboratoryId,
            effectiveAttemptId,
            'rpm_roc',
            'RATE_OF_CHANGE_LIMIT',
            breachedRpm,
            Number(rpmRoc.toFixed(1)),
            rLimits ?? {},
            approved?.id ?? null,
            'CRITICAL',
          );
        }
      }
    }
  }

  async handleDeviceAlarm(equipmentId: string, laboratoryId: string, detail: Record<string, unknown>): Promise<void> {
    const manager = currentManager();
    const parameter = String(detail.parameter ?? 'temperature');
    const value = typeof detail.value === 'number' ? detail.value : null;
    const kind = String(detail.kind ?? 'RATE_OF_CHANGE_LIMIT');
    const severity = 'CRITICAL';

    const existing = await manager
      .getRepository(Alarm)
      .createQueryBuilder('a')
      .where('a.equipment_id = :equipmentId', { equipmentId })
      .andWhere('a.parameter = :parameter', { parameter })
      .andWhere("a.state != 'NORMAL'")
      .orderBy('a.onset_ts', 'DESC')
      .getOne();

    const isReturningToActive = existing && existing.state === 'RETURNED_UNACK';
    if (!existing || isReturningToActive) {
      const alarm = !existing
        ? manager.create(Alarm, {
            id: newId(),
            equipmentId,
            laboratoryId,
            parameter,
            kind,
            severity,
            onsetTs: new Date(),
            state: 'ACTIVE_UNACK',
            origin: 'DEVICE',
          })
        : existing;

      if (isReturningToActive) {
        alarm.state = 'ACTIVE_UNACK';
        alarm.onsetTs = new Date();
        alarm.returnTs = null as any;
        alarm.severity = severity;
      }
      await manager.save(alarm);

      const title = detail.rate
        ? `FIRE/SAFETY CRITICAL: Temperature Rate of Change (+${detail.rate}°C/min > limit ${detail.limit}°C/min)`
        : `FIRE/SAFETY CRITICAL: ${parameter.toUpperCase()} alarm triggered on hardware device`;

      await this.notifications.notifyLabIncharges(
        laboratoryId,
        'ALARM_ACTIVE',
        'HIGH',
        {
          equipmentId,
          parameter,
          value,
          alarmId: alarm.id,
          severity,
          kind,
          title,
        },
        'alarm',
        alarm.id,
      );
      this.notifications.broadcast('ALARM_ACTIVE', {
        equipmentId,
        parameter,
        value,
        alarmId: alarm.id,
        severity,
        kind,
        title,
      });
    }
  }

  async handleDeviceAlarmCleared(equipmentId: string, detail: Record<string, unknown>): Promise<void> {
    const manager = currentManager();
    const parameter = String(detail.parameter ?? 'temperature');
    await manager
      .getRepository(Alarm)
      .createQueryBuilder()
      .update(Alarm)
      .set({ state: 'RETURNED_UNACK', returnTs: new Date() })
      .where('equipment_id = :equipmentId', { equipmentId })
      .andWhere('parameter = :parameter', { parameter })
      .andWhere("state != 'NORMAL'")
      .execute();

    this.notifications.broadcast('ALARM_CLEARED', { equipmentId, parameter });
  }

  private async applyEvaluation(
    equipmentId: string,
    laboratoryId: string,
    attemptId: string | null,
    parameter: string,
    kind: string,
    breached: boolean,
    value: number,
    limits: ThresholdLimits,
    thresholdVersionId: string | null,
    severity: 'WARNING' | 'CRITICAL' = 'WARNING',
  ): Promise<void> {
    const manager = currentManager();
    const existing = await manager
      .getRepository(Alarm)
      .createQueryBuilder('a')
      .where('a.equipment_id = :equipmentId', { equipmentId })
      .andWhere('a.parameter = :parameter', { parameter })
      .andWhere('a.kind = :kind', { kind })
      .andWhere("a.state != 'NORMAL'")
      .orderBy('a.onset_ts', 'DESC')
      .getOne();

    const isReturningToActive = breached && existing && existing.state === 'RETURNED_UNACK';
    if ((breached && !existing) || isReturningToActive) {
      const alarm = !existing
        ? manager.create(Alarm, {
            id: newId(),
            attemptId: attemptId ?? undefined,
            equipmentId,
            laboratoryId,
            parameter,
            kind,
            severity,
            thresholdVersionId: thresholdVersionId ?? undefined,
            onsetTs: new Date(),
            state: 'ACTIVE_UNACK',
            origin: 'SERVER',
          })
        : existing;

      if (isReturningToActive) {
        alarm.state = 'ACTIVE_UNACK';
        alarm.onsetTs = new Date();
        alarm.returnTs = null as any;
        alarm.severity = severity;
      }
      await manager.save(alarm);
      await this.audit.record({
        action: 'ALARM_RAISED',
        entityType: 'alarm',
        entityId: alarm.id,
        equipmentId,
        newValue: { parameter, value, limits, severity },
      });
      const title = severity === 'CRITICAL'
        ? `FIRE/SAFETY CRITICAL: ${parameter.toUpperCase()} Rate of Change / High Limit Breached (${value})`
        : `Threshold Warning: ${parameter.toUpperCase()} exceeded limit (${value})`;
      await this.notifications.notifyLabIncharges(
        laboratoryId,
        'ALARM_ACTIVE',
        severity === 'CRITICAL' ? 'HIGH' : 'NORMAL',
        {
          equipmentId,
          parameter,
          value,
          limits,
          alarmId: alarm.id,
          severity,
          kind,
          title,
        },
        'alarm',
        alarm.id,
      );
      this.notifications.broadcast('ALARM_ACTIVE', {
        equipmentId,
        parameter,
        value,
        limits,
        alarmId: alarm.id,
        severity,
        kind,
        title,
      });
    } else if (!breached && existing) {
      await manager.update(Alarm, { id: existing.id }, {
        state: 'RETURNED_UNACK',
        returnTs: new Date(),
      });
      await this.audit.record({
        action: 'ALARM_RETURNED_TO_NORMAL',
        entityType: 'alarm',
        entityId: existing.id,
        equipmentId,
      });
      this.notifications.broadcast('ALARM_CLEARED', { equipmentId, parameter, alarmId: existing.id });
    }
  }
}
