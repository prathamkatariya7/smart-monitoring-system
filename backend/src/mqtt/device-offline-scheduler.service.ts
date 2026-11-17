import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Db } from '../common/db/db.service';
import { DeviceState } from './entities/device-state.entity';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Monitors device heartbeat timeouts. A device's `state`/`tele` messages
 * bump `device_state.updated_at` on every message (ingestion.service.ts).
 * This scheduler runs every 5 seconds with a 15-second heartbeat window.
 * When a device goes quiet for >15s, it flips `online` back to false and
 * broadcasts a real-time 'device_status' event to connected frontend clients.
 */
@Injectable()
export class DeviceOfflineSchedulerService {
  private readonly logger = new Logger(DeviceOfflineSchedulerService.name);
  private static readonly TIMEOUT_SECONDS = 12;

  constructor(
    private readonly db: Db,
    private readonly notifications: NotificationsService,
  ) {}

  @Interval(3_000)
  async expireStaleDevices(): Promise<void> {
    await this.db.runAsAdmin(async (manager) => {
      const staleStates = await manager
        .getRepository(DeviceState)
        .createQueryBuilder('s')
        .where('s.online = true')
        .andWhere(
          `s.updated_at < now() - interval '${DeviceOfflineSchedulerService.TIMEOUT_SECONDS} seconds'`,
        )
        .getMany();

      if (staleStates.length > 0) {
        const ids = staleStates.map((s) => s.deviceId);
        await manager
          .getRepository(DeviceState)
          .createQueryBuilder()
          .update(DeviceState)
          .set({ online: false })
          .where('device_id IN (:...ids)', { ids })
          .execute();

        for (const id of ids) {
          this.notifications.broadcast('device_status', {
            deviceId: id,
            online: false,
          });
        }
        this.logger.log(
          `Marked ${ids.length} device(s) offline (no heartbeat in ${DeviceOfflineSchedulerService.TIMEOUT_SECONDS}s)`,
        );
      }
    });
  }
}
