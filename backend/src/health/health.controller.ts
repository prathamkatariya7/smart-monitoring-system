import { Controller, Get } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as fs from 'fs';
import { Public } from '../common/decorators/public.decorator';
import { MqttClientService } from '../mqtt/mqtt-client.service';
import { BackupService } from '../backup/backup.service';
import { LicenceService } from '../licence/licence.service';

/** Part 9.10: built-in health page data source. No-auth so an on-site health page/kiosk can poll it. */
@Controller('health')
export class HealthController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly mqtt: MqttClientService,
    private readonly backup: BackupService,
    private readonly licence: LicenceService,
  ) {}

  @Public()
  @Get()
  async check() {
    let dbOk = false;
    try {
      await this.dataSource.query('SELECT 1');
      dbOk = true;
    } catch {
      dbOk = false;
    }

    const brokerOk = this.mqtt.isConnected();

    let diskFreeBytes: number | null = null;
    let diskTotalBytes: number | null = null;
    try {
      const stats = await fs.promises.statfs('/app');
      diskFreeBytes = stats.bfree * stats.bsize;
      diskTotalBytes = stats.blocks * stats.bsize;
    } catch {
      // statfs unavailable on this platform -- not fatal, just omit disk stats.
    }
    const diskLow = diskFreeBytes !== null && diskTotalBytes !== null && diskFreeBytes / diskTotalBytes < 0.1;

    const backupAgeMs = this.backup.latestBackupAgeMs();
    const backupStale = backupAgeMs === null || backupAgeMs > 36 * 60 * 60 * 1000; // > 36h since last backup

    const licenceStatus = this.licence.status();

    const degraded = !dbOk || !brokerOk || diskLow || backupStale || !licenceStatus.valid || licenceStatus.expired;

    return {
      status: !dbOk || !brokerOk ? 'critical' : degraded ? 'degraded' : 'ok',
      timestamp: new Date().toISOString(),
      checks: {
        database: dbOk ? 'ok' : 'unreachable',
        mqttBroker: brokerOk ? 'ok' : 'unreachable',
        disk:
          diskFreeBytes === null
            ? 'unknown'
            : { freeBytes: diskFreeBytes, totalBytes: diskTotalBytes, low: diskLow },
        backup: {
          lastBackupAgeMs: backupAgeMs,
          stale: backupStale,
        },
        licence: {
          installed: licenceStatus.installed,
          valid: licenceStatus.valid,
          expired: licenceStatus.expired,
          edition: licenceStatus.payload?.edition ?? null,
          maxDevices: licenceStatus.payload?.maxDevices ?? null,
        },
      },
    };
  }
}
