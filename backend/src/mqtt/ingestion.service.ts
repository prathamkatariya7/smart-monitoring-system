import { Injectable, Logger } from '@nestjs/common';
import { EntityManager, IsNull } from 'typeorm';
import { Db } from '../common/db/db.service';
import { newId } from '../common/util/id.util';
import { MqttClientService } from './mqtt-client.service';
import { BatchPayload, DeviceEventPayload, DeviceStatePayload, FLAG_BITS } from './mqtt.types';
import { Device } from '../devices/entities/device.entity';
import { DeviceBinding } from '../devices/entities/device-binding.entity';
import { DeviceState } from './entities/device-state.entity';
import { DeviceEvent } from './entities/device-event.entity';
import { Measurement } from '../measurements/entities/measurement.entity';
import { DataGap } from '../measurements/entities/data-gap.entity';
import { AlarmsService } from '../alarms/alarms.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CfgDesiredService } from './cfg-desired.service';
import { Process } from '../processes/entities/process.entity';
import { ProcessAssignment } from '../processes/entities/process-assignment.entity';
import { ProcessAttempt } from '../processes/entities/process-attempt.entity';
import { Equipment } from '../equipment/entities/equipment.entity';

/**
 * Part 8.2/8.3 ingestion pipeline: subscribes to every device's state/
 * tele/batch/tele/backlog/event topics, de-dupes into the measurement
 * hypertable (idempotent via its composite PK), detects sequence gaps, keeps
 * device_state current, and acks back on ack/data so the device can free
 * ring buffer space (Part 7.6 write-ahead rule).
 *
 * Device offline detection by state/heartbeat timeout (90s, Part 8.2) runs in
 * the scheduler module (added alongside command dispatcher, task 7) -- this
 * service only reacts to messages as they arrive.
 */
@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    private readonly mqtt: MqttClientService,
    private readonly db: Db,
    private readonly alarms: AlarmsService,
    private readonly notifications: NotificationsService,
    private readonly cfgDesired: CfgDesiredService,
  ) { }

  registerHandlers(): void {
    this.mqtt.subscribe('rmp/v1/+/state', (topic, payload) => this.onState(topic, payload));
    this.mqtt.subscribe('rmp/v1/+/tele/batch', (topic, payload) => this.onBatch(topic, payload, false));
    this.mqtt.subscribe('rmp/v1/+/tele/backlog', (topic, payload) => this.onBatch(topic, payload, true));
    this.mqtt.subscribe('rmp/v1/+/event', (topic, payload) => this.onEvent(topic, payload));
  }

  private deviceIdFromTopic(topic: string): string {
    // rmp/v1/{device_id}/...
    return topic.split('/')[2];
  }

  private async onState(topic: string, payload: Buffer): Promise<void> {
    const deviceId = this.deviceIdFromTopic(topic);
    let parsed: DeviceStatePayload;
    try {
      parsed = JSON.parse(payload.toString('utf8'));
    } catch {
      this.logger.warn(`Malformed state payload from ${deviceId}`);
      return;
    }

    await this.db.runAsAdmin(async (manager) => {
      let device = await manager.findOne(Device, { where: { id: deviceId } });
      if (device && device.status === 'DECOMMISSIONED') {
        this.logger.warn(`State heartbeat from decommissioned device ${deviceId} -- sending decommission directive`);
        this.mqtt.publish(
          `rmp/v1/${deviceId}/cfg/desired`,
          JSON.stringify({
            version: 0,
            status: 'DECOMMISSIONED',
            decommissioned: true,
            binding: null,
          }),
          { qos: 1, retain: true },
        );
        return;
      }
      if (!device) {
        device = manager.create(Device, {
          id: deviceId,
          serialNo: `DEV-${deviceId.slice(-4).toUpperCase()}`,
          claimCode: deviceId,
          claimState: 'CLAIMED',
          status: 'ACTIVE',
          lastSeen: new Date(),
        });
        await manager.save(device);
        this.logger.log(`Auto-registered new hardware board ${deviceId} (${device.serialNo})`);
      }
      // Lock order: Device row, then DeviceState row -- must match onBatch()'s
      // order exactly, or concurrent state/batch messages for the same device
      // can deadlock (see the longer comment in onBatch()).
      await manager.update(Device, { id: deviceId }, { lastSeen: new Date() });

      const existing = await manager.findOne(DeviceState, { where: { deviceId } });
      await manager.save(DeviceState, {
        deviceId,
        bootId: parsed.boot ?? existing?.bootId ?? null,
        lastSeq: existing?.lastSeq ?? null,
        lastTs: existing?.lastTs ?? null,
        lastMonoMs: existing?.lastMonoMs ?? null,
        link: parsed.link ?? existing?.link ?? null,
        online: parsed.online,
        updatedAt: new Date(),
      });
      this.notifications.broadcast('device_status', { deviceId, online: parsed.online });
    });
  }

  private async onBatch(topic: string, payload: Buffer, fromBacklog: boolean): Promise<void> {
    const deviceId = this.deviceIdFromTopic(topic);
    let batch: BatchPayload;
    try {
      batch = JSON.parse(payload.toString('utf8'));
    } catch {
      this.logger.warn(`Malformed batch payload from ${deviceId}`);
      return;
    }

    await this.db.runAsAdmin(async (manager) => {
      const device = await manager.findOne(Device, { where: { id: deviceId } });
      if (device && device.status === 'DECOMMISSIONED') {
        this.logger.warn(`Batch from decommissioned device ${deviceId} -- rejected`);
        this.mqtt.publish(
          `rmp/v1/${deviceId}/cfg/desired`,
          JSON.stringify({
            version: 0,
            status: 'DECOMMISSIONED',
            decommissioned: true,
            binding: null,
          }),
          { qos: 1, retain: true },
        );
        return;
      }

      const binding = await manager.findOne(DeviceBinding, {
        where: { deviceId, boundTo: IsNull() },
      });
      if (!binding) {
        this.logger.warn(
          `Batch from device ${deviceId} with no open binding -- dropped (bind this device to a reactor via UI)`,
        );
        return;
      }

      const colIndex = (name: string) => batch.f.indexOf(name);
      const iSeq = colIndex('seq');
      const iMono = colIndex('mono');
      const iTs = colIndex('ts');
      const iT = colIndex('t');
      const iTRaw = colIndex('t_raw');
      const iRpm = colIndex('rpm');
      const iTq = colIndex('tq');
      const iQ = colIndex('q');
      const iFlt = colIndex('flt');
      const iFl = colIndex('fl');

      const state = await manager.findOne(DeviceState, { where: { deviceId } });
      let priorSeq = state?.bootId === batch.boot ? state?.lastSeq ?? null : null;
      const batchId = newId();
      const receivedAt = new Date();

      const numOrNull = (val: any): number | null => {
        if (val === null || val === undefined || val === '') return null;
        const n = Number(val);
        return Number.isFinite(n) ? n : null;
      };

      for (const row of batch.d) {
        const seq = Number(row[iSeq]);
        const mono = iMono >= 0 ? Number(row[iMono]) : null;
        let flags = iFl >= 0 ? Number(row[iFl]) : 0;
        let ts: Date;
        let tsOriginal: Date | null = null;

        if (batch.tsync === 1 && iTs >= 0) {
          ts = new Date(Number(row[iTs]));
        } else {
          // Not yet time-anchored to real UTC (Part 7.5): fall back to server
          // receipt time and flag it. Full anchor-based derivation (using a
          // TIME_ANCHOR event's boot/uptime pair to compute true UTC for
          // unsynced samples) lands with the command dispatcher/time-sync
          // work; this keeps ingestion correct-but-honest in the meantime.
          ts = receivedAt;
          if (iTs >= 0) tsOriginal = new Date(Number(row[iTs]));
          flags |= FLAG_BITS.TIME_UNSYNCED;
        }

        // Gap detection (Part 8.3): non-contiguous seq within this boot. The
        // skipped range is unrecoverable (the device's ring already moved
        // past it), so the ack high-water mark still advances past the gap
        // once it's recorded -- acking is about freeing device buffer space,
        // not about pretending the gap didn't happen.
        if (priorSeq !== null && seq > priorSeq + 1) {
          await manager.save(DataGap, {
            id: newId(),
            deviceId,
            attemptId: batch.attempt ?? null,
            fromTs: ts,
            toTs: ts,
            expectedN: seq - priorSeq - 1,
            kind: 'MISSING_SEQ',
            detectedAt: new Date(),
          });
          flags |= FLAG_BITS.GAP;
        }

        const tempVal = iT >= 0 ? numOrNull(row[iT]) : null;
        const tempRawVal = iTRaw >= 0 ? numOrNull(row[iTRaw]) : null;
        const rpmVal = iRpm >= 0 ? numOrNull(row[iRpm]) : null;
        const tqVal = iTq >= 0 ? numOrNull(row[iTq]) : null;

        await manager
          .createQueryBuilder()
          .insert()
          .into(Measurement)
          .values({
            ts,
            receivedAt,
            deviceId,
            equipmentId: binding.equipmentId,
            laboratoryId: binding.laboratoryId,
            processId: null,
            attemptId: batch.attempt ?? null,
            bootId: batch.boot,
            seq,
            monoMs: mono !== null ? String(mono) : null,
            tsOriginal,
            temperatureC: tempVal,
            temperatureRawC: tempRawVal,
            rpm: rpmVal,
            torqueNcm: tqVal,
            quality: iQ >= 0 && row[iQ] ? this.encodeQuality(String(row[iQ])) : null,
            faultCode: iFlt >= 0 ? numOrNull(row[iFlt]) : null,
            flags,
            calibrationVersion: batch.cal ?? null,
            fwVersion: batch.fw ?? null,
            batchId,
          })
          .orIgnore() // idempotent re-delivery (QoS 1, Part 8.2) -> no duplicate row
          .execute();

        // Part 6: server-side threshold evaluation (system of record, C-07).
        await this.alarms.evaluateSample(binding.equipmentId, binding.laboratoryId, batch.attempt ?? null, {
          temperature_c: tempVal,
          rpm: rpmVal,
          torque_ncm: tqVal,
        });

        priorSeq = seq;
      }

      // Lock order must match onState()'s (Device row, then DeviceState row) --
      // onState() and onBatch() both touch these two rows per device, and if
      // one update order is reversed between the two methods, two concurrent
      // handlers (the device publishes `state` and `tele/batch` back-to-back
      // every cycle) can deadlock acquiring the same two row locks in opposite
      // order (Postgres 40P01). Found 2026-11-10 after it crashed the whole
      // backend process repeatedly under nothing more than one bench device
      // publishing every 5s -- an unhandled rejection from this deadlock was
      // fatal, not just a failed request.
      await manager.update(Device, { id: deviceId }, { lastSeen: new Date() });
      await manager.save(DeviceState, {
        deviceId,
        bootId: batch.boot,
        lastSeq: priorSeq,
        lastTs: new Date(),
        lastMonoMs: iMono >= 0 && batch.d.length ? String(batch.d[batch.d.length - 1][iMono]) : null,
        link: batch.link ?? state?.link ?? null,
        online: true,
        updatedAt: new Date(),
      });

      if (!state?.online) {
        this.notifications.broadcast('device_status', { deviceId, online: true });
      }

      if (priorSeq !== null) {
        this.mqtt.publish(
          `rmp/v1/${deviceId}/ack/data`,
          JSON.stringify({ boot: batch.boot, upto_seq: priorSeq }),
        );
      }

      // Realtime telemetry push to connected web browsers via Socket.IO
      if (batch.d && batch.d.length > 0) {
        const lastRow = batch.d[batch.d.length - 1];
        const lastTemp = iT >= 0 ? numOrNull(lastRow[iT]) : null;
        const lastRpm = iRpm >= 0 ? numOrNull(lastRow[iRpm]) : null;
        const lastTq = iTq >= 0 ? numOrNull(lastRow[iTq]) : null;
        this.notifications.broadcast('telemetry', {
          equipmentId: binding.equipmentId,
          temperatureC: lastTemp,
          rpm: lastRpm,
          torqueNcm: lastTq,
          ts: new Date().toISOString(),
        });
      }

      this.logger.log(
        `Ingested ${batch.d.length} samples from device ${deviceId} (boot ${batch.boot}, backlog=${fromBacklog})`,
      );
    });
  }

  private async onEvent(topic: string, payload: Buffer): Promise<void> {
    const deviceId = this.deviceIdFromTopic(topic);
    let event: DeviceEventPayload;
    try {
      event = JSON.parse(payload.toString('utf8'));
    } catch {
      this.logger.warn(`Malformed event payload from ${deviceId}`);
      return;
    }

    await this.db.runAsAdmin(async (manager: EntityManager) => {
      let device = await manager.findOne(Device, { where: { id: deviceId } });
      if (device && device.status === 'DECOMMISSIONED') {
        this.logger.warn(`State heartbeat from decommissioned device ${deviceId} -- sending decommission directive`);
        this.mqtt.publish(
          `rmp/v1/${deviceId}/cfg/desired`,
          JSON.stringify({
            version: 0,
            status: 'DECOMMISSIONED',
            decommissioned: true,
            binding: null,
          }),
          { qos: 1, retain: true },
        );
        return;
      }
      if (!device) {
        device = manager.create(Device, {
          id: deviceId,
          serialNo: `DEV-${deviceId.slice(-4).toUpperCase()}`,
          claimCode: deviceId,
          claimState: 'CLAIMED',
          status: 'ACTIVE',
          lastSeen: new Date(),
        });
        await manager.save(device);
        this.logger.log(`Auto-registered new hardware board ${deviceId} (${device.serialNo})`);
      }

      await manager.save(DeviceEvent, {
        id: newId(),
        deviceId,
        bootId: event.boot ?? null,
        ts: event.ts ? new Date(event.ts) : new Date(),
        type: event.type,
        detailJson: event as unknown as Record<string, unknown>,
      });

      // Part 7.5: a TIME_ANCHOR event is the device confirming it has
      // resynced to real NTP time; record it on the device record.
      if (event.type === 'TIME_ANCHOR') {
        await manager.update(Device, { id: deviceId }, {
          clockSource: 'NTP',
          lastNtpSync: new Date(),
        });
      }

      // HMI Analyst Workflow Events: ACCEPT, REJECT, START, CANCEL
      const binding = await manager.findOne(DeviceBinding, {
        where: { deviceId, boundTo: IsNull() },
      });

      if (binding) {
        const activeProcess = await manager
          .getRepository(Process)
          .createQueryBuilder('p')
          .where('p.equipment_id = :equipmentId', { equipmentId: binding.equipmentId })
          .andWhere("p.status IN ('SCHEDULED', 'ACCEPTED', 'RUNNING', 'PAUSED')")
          .orderBy('p.planned_start_utc', 'ASC')
          .getOne();

        const detail = (event as any).detailJson || event;
        const analystName = detail.analyst || 'Analyst';

        if (activeProcess) {
          if (event.type === 'ASSIGNMENT_ACCEPTED') {
            await manager.update(Process, { id: activeProcess.id }, { status: 'ACCEPTED' });
            await manager.update(
              ProcessAssignment,
              { processId: activeProcess.id, role: 'OWNER' },
              { status: 'ACCEPTED', respondedAt: new Date() },
            );
            await this.notifications.notifyLabIncharges(
              binding.laboratoryId,
              'ASSIGNMENT_ACCEPTED',
              'NORMAL',
              {
                equipmentId: binding.equipmentId,
                processId: activeProcess.id,
                analyst: analystName,
                title: `${analystName} ACCEPTED process "${activeProcess.name}"`,
              },
              'process',
              activeProcess.id,
            );
            this.notifications.broadcast('process_updated', { processId: activeProcess.id, status: 'ACCEPTED' });
            await this.cfgDesired.pushToDevice(deviceId);
          } else if (event.type === 'ASSIGNMENT_REJECTED') {
            await manager.update(Process, { id: activeProcess.id }, { status: 'SCHEDULED' });
            await manager.update(
              ProcessAssignment,
              { processId: activeProcess.id, role: 'OWNER' },
              { status: 'REJECTED', respondedAt: new Date(), rejectReason: 'Rejected on device' },
            );
            await this.notifications.notifyLabIncharges(
              binding.laboratoryId,
              'ASSIGNMENT_REJECTED',
              'HIGH',
              {
                equipmentId: binding.equipmentId,
                processId: activeProcess.id,
                analyst: analystName,
                title: `ALERT: ${analystName} REJECTED assignment for "${activeProcess.name}"`,
              },
              'process',
              activeProcess.id,
            );
            this.notifications.broadcast('process_updated', { processId: activeProcess.id, status: 'SCHEDULED' });
            await this.cfgDesired.pushToDevice(deviceId);
          } else if (event.type === 'ATTEMPT_STARTED') {
            await manager.update(Process, { id: activeProcess.id }, { status: 'RUNNING' });
            const existingAttempt = await manager.findOne(ProcessAttempt, {
              where: { processId: activeProcess.id, status: 'RUNNING' },
            });
            if (!existingAttempt) {
              const attempt = manager.create(ProcessAttempt, {
                id: newId(),
                processId: activeProcess.id,
                attemptNo: 1,
                startTs: new Date(),
                status: 'RUNNING',
              });
              await manager.save(attempt);
            }
            await this.notifications.notifyLabIncharges(
              binding.laboratoryId,
              'PROCESS_STARTED',
              'NORMAL',
              {
                equipmentId: binding.equipmentId,
                processId: activeProcess.id,
                analyst: analystName,
                title: `${analystName} STARTED process "${activeProcess.name}"`,
              },
              'process',
              activeProcess.id,
            );
            this.notifications.broadcast('process_updated', { processId: activeProcess.id, status: 'RUNNING' });
            await this.cfgDesired.pushToDevice(deviceId);
          } else if (event.type === 'PROCESS_CANCELLED') {
            await manager.update(Process, { id: activeProcess.id }, { status: 'CANCELLED' });
            await this.notifications.notifyLabIncharges(
              binding.laboratoryId,
              'PROCESS_CANCELLED',
              'HIGH',
              {
                equipmentId: binding.equipmentId,
                processId: activeProcess.id,
                analyst: analystName,
                title: `Process "${activeProcess.name}" CANCELLED by ${analystName}`,
              },
              'process',
              activeProcess.id,
            );
            this.notifications.broadcast('process_updated', { processId: activeProcess.id, status: 'CANCELLED' });
            await this.cfgDesired.pushToDevice(deviceId);
          } else if (event.type === 'PROCESS_ABORTED') {
            await manager.update(Process, { id: activeProcess.id }, { status: 'ABORTED' });
            const currentAttempt = await manager.findOne(ProcessAttempt, {
              where: { processId: activeProcess.id, status: 'RUNNING' },
            });
            if (currentAttempt) {
              await manager.update(ProcessAttempt, { id: currentAttempt.id }, {
                status: 'ABORTED',
                endTs: new Date(),
                endReason: (event as any).reason ?? 'Aborted from hardware device',
              });
            }
            await this.notifications.notifyLabIncharges(
              binding.laboratoryId,
              'PROCESS_ABORTED',
              'HIGH',
              {
                equipmentId: binding.equipmentId,
                processId: activeProcess.id,
                analyst: analystName,
                title: `CRITICAL: Process "${activeProcess.name}" ABORTED on device by ${analystName}`,
              },
              'process',
              activeProcess.id,
            );
            this.notifications.broadcast('process_updated', { processId: activeProcess.id, status: 'ABORTED' });
            await this.cfgDesired.pushToDevice(deviceId);
          }
        }

        // Direct hardware device alarms (independent of process context)
        const alarmDetail = (event as any).detail ?? (event as any).detailJson ?? event;
        if (event.type === 'ALARM_TRIGGERED') {
          await this.alarms.handleDeviceAlarm(binding.equipmentId, binding.laboratoryId, alarmDetail);
        } else if (event.type === 'ALARM_CLEARED') {
          await this.alarms.handleDeviceAlarmCleared(binding.equipmentId, alarmDetail);
        } else if (event.type === 'ALERT_MUTED') {
          await this.notifications.notifyLabIncharges(
            binding.laboratoryId,
            'ALERT_SOUND_OVERRIDDEN',
            'NORMAL',
            {
              equipmentId: binding.equipmentId,
              title: `Hardware siren silenced on device by operator`,
            },
          );
        }
      }
    });
  }

  /** Part 8.2: `q` is one letter per channel (G=GOOD, S=SUSPECT, B=BAD); packed 2 bits/channel for storage. */
  private encodeQuality(q: string): number {
    const map: Record<string, number> = { G: 0, S: 1, B: 2 };
    let value = 0;
    for (let i = 0; i < q.length; i++) {
      value |= (map[q[i]] ?? 0) << (i * 2);
    }
    return value;
  }
}
