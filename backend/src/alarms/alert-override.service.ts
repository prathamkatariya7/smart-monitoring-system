import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { currentManager } from '../common/db/request-context';
import { newId } from '../common/util/id.util';
import { AlertOverride } from './entities/alert-override.entity';
import { Alarm } from './entities/alarm.entity';
import { AlertCatalogService } from './alert-catalog.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { Client } from '../tenancy/entities/client.entity';
import { ProcessAttempt } from '../processes/entities/process-attempt.entity';
import { ProcessAssignment } from '../processes/entities/process-assignment.entity';

/** Part 6.5: who may override, duration limits, recording, and the immediate In-charge alert. */
@Injectable()
export class AlertOverrideService {
  constructor(
    private readonly alertCatalog: AlertCatalogService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  private alertTypeFor(alarm: Alarm): string {
    if (alarm.kind === 'STATIC_LIMIT') {
      return alarm.severity === 'CRITICAL'
        ? 'THRESHOLD_CRITICAL'
        : 'THRESHOLD_WARNING';
    }
    return alarm.kind;
  }

  async create(
    actor: AuthenticatedUser,
    alarmId: string,
    reasonCode: string,
    reasonText: string | undefined,
    durationMin: number,
  ): Promise<AlertOverride> {
    const manager = currentManager();
    const alarm = await manager.findOne(Alarm, { where: { id: alarmId } });
    if (!alarm) throw new NotFoundException('Alarm not found');
    if (alarm.state === 'NORMAL')
      throw new ConflictException('Alarm is not active');

    const alertType = this.alertTypeFor(alarm);
    const catalog = await this.alertCatalog.getByType(alertType);
    if (catalog.overridableBy === 'NONE') {
      throw new ForbiddenException(
        `${alertType} cannot be overridden (silence only)`,
      );
    }

    const [client] = await manager.find(Client, { take: 1 });
    const policyPack = client?.policyPack ?? 'flexible';
    const isCritical = alarm.severity === 'CRITICAL';
    const isAdminOrIncharge =
      actor.roles.includes('ADMIN') || actor.roles.includes('LAB_INCHARGE');

    if (isCritical) {
      // C-28/6.5 override_critical: flexible=owner(<=15min), standard=incharge_only, regulated=never
      if (policyPack === 'regulated') {
        throw new ForbiddenException(
          'Critical alerts cannot be overridden under the Regulated policy pack (silence only)',
        );
      }
      if (policyPack === 'standard' && !isAdminOrIncharge) {
        throw new ForbiddenException(
          'Critical alerts require the Lab In-charge or Admin under the Standard policy pack',
        );
      }
      if (policyPack === 'flexible' && !isAdminOrIncharge) {
        await this.assertIsOwner(actor, alarm);
      }
    } else if (!isAdminOrIncharge) {
      await this.assertIsOwner(actor, alarm);
    }

    const maxMin =
      isCritical && policyPack === 'flexible' && !isAdminOrIncharge
        ? 15
        : catalog.maxOverrideMin;
    const effectiveMin = Math.min(durationMin, maxMin);
    const plannedExpiry = new Date(Date.now() + effectiveMin * 60_000);

    const override = manager.create(AlertOverride, {
      id: newId(),
      alarmId,
      equipmentId: alarm.equipmentId,
      laboratoryId: alarm.laboratoryId,
      attemptId: alarm.attemptId,
      deviceId: null,
      userId: actor.userId,
      source: 'WEB',
      alertType,
      severity: alarm.severity,
      parameter: alarm.parameter,
      valueAtOverride: null,
      limitValue: null,
      thresholdVersionId: alarm.thresholdVersionId,
      deviceTs: null,
      serverTs: new Date(),
      reasonCode,
      reasonText: reasonText ?? null,
      plannedExpiry,
      offlineOrigin: false,
    });
    await manager.save(override);

    await this.audit.record({
      userId: actor.userId,
      action: 'ALERT_SOUND_OVERRIDDEN',
      entityType: 'alert_override',
      entityId: override.id,
      equipmentId: alarm.equipmentId,
      newValue: { alertType, reasonCode, plannedExpiry },
    });

    // Part 6.5: "Alert to the Lab In-charge (in-app, immediate)"
    await this.notifications.notifyLabIncharges(
      alarm.laboratoryId,
      'ALERT_SOUND_OVERRIDDEN',
      'HIGH',
      {
        equipmentId: alarm.equipmentId,
        alertType,
        analystUserId: actor.userId,
        analystName: actor.name,
        reasonCode,
        plannedExpiry,
        overrideId: override.id,
      },
      'alert_override',
      override.id,
    );

    await this.checkRepeatedOverride(alarm.equipmentId, alertType);
    return override;
  }

  private async assertIsOwner(
    actor: AuthenticatedUser,
    alarm: Alarm,
  ): Promise<void> {
    if (!alarm.attemptId) {
      throw new ForbiddenException(
        'No running process attempt on this reactor -- only an assigned analyst may override',
      );
    }
    const manager = currentManager();
    const attempt = await manager.findOne(ProcessAttempt, {
      where: { id: alarm.attemptId },
    });
    if (!attempt) throw new ForbiddenException('Process attempt not found');
    const owner = await manager.findOne(ProcessAssignment, {
      where: {
        processId: attempt.processId,
        role: 'OWNER',
        status: 'ACCEPTED',
      },
    });
    if (!owner || owner.userId !== actor.userId) {
      throw new ForbiddenException(
        'Only the assigned owner analyst may override this alert',
      );
    }
  }

  /** Part 6.5: "same reactor, same alert, three times within one hour" -> second "repeated override" notice. */
  private async checkRepeatedOverride(
    equipmentId: string,
    alertType: string,
  ): Promise<void> {
    const manager = currentManager();
    const oneHourAgo = new Date(Date.now() - 60 * 60_000);
    const count = await manager
      .getRepository(AlertOverride)
      .createQueryBuilder('o')
      .where('o.equipment_id = :equipmentId', { equipmentId })
      .andWhere('o.alert_type = :alertType', { alertType })
      .andWhere('o.server_ts >= :since', { since: oneHourAgo })
      .getCount();

    if (count >= 3) {
      const alarm = await manager.findOne(Alarm, {
        where: { equipmentId },
        order: { onsetTs: 'DESC' },
      });
      await this.notifications.notifyLabIncharges(
        alarm?.laboratoryId ?? '',
        'ALERT_OVERRIDE_REPEATED',
        'HIGH',
        { equipmentId, alertType, countInLastHour: count },
      );
    }
  }

  async revoke(
    actor: AuthenticatedUser,
    id: string,
    reason: string,
  ): Promise<AlertOverride> {
    const manager = currentManager();
    const override = await manager.findOne(AlertOverride, { where: { id } });
    if (!override) throw new NotFoundException('Override not found');
    if (override.endedAt) throw new ConflictException('Override already ended');

    await manager.update(
      AlertOverride,
      { id },
      {
        endedAt: new Date(),
        endCause: 'REVOKED',
      },
    );

    await this.audit.record({
      userId: actor.userId,
      action: 'ALERT_SOUND_OVERRIDE_ENDED',
      entityType: 'alert_override',
      entityId: id,
      equipmentId: override.equipmentId,
      reason,
    });
    return manager.findOneOrFail(AlertOverride, { where: { id } });
  }

  async markSeen(actor: AuthenticatedUser, id: string): Promise<AlertOverride> {
    const manager = currentManager();
    await manager.update(
      AlertOverride,
      { id },
      { seenBy: actor.userId, seenAt: new Date() },
    );
    return manager.findOneOrFail(AlertOverride, { where: { id } });
  }

  async list(filter: {
    equipmentId?: string;
    from?: Date;
    to?: Date;
  }): Promise<AlertOverride[]> {
    const qb = currentManager()
      .getRepository(AlertOverride)
      .createQueryBuilder('o');
    if (filter.equipmentId)
      qb.andWhere('o.equipment_id = :equipmentId', {
        equipmentId: filter.equipmentId,
      });
    if (filter.from) qb.andWhere('o.server_ts >= :from', { from: filter.from });
    if (filter.to) qb.andWhere('o.server_ts <= :to', { to: filter.to });
    return qb.orderBy('o.server_ts', 'DESC').limit(200).getMany();
  }
}
