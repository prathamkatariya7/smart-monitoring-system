import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Part 9.8: nightly full backup (RPO ~5 min via WAL on the primary disk,
 * RTO ~4 hours by restoring the latest pg_dump). Shells out to pg_dump
 * (postgresql16-client, added to the Alpine image) and writes a timestamped
 * plain-SQL dump to BACKUP_DIR. A manual trigger is also exposed via the API.
 * Connects as the migration superuser, not rmp_app, because RLS blocks
 * pg_dump's COPY from a restricted role -- a backup must see every row.
 */
@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  constructor(private readonly config: ConfigService) {}

  private get backupDir(): string {
    return this.config.get<string>('backup.dir')!;
  }

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async nightlyBackup() {
    try {
      await this.runBackup();
    } catch (err: any) {
      this.logger.error(`Nightly backup failed: ${err.message}`);
    }
  }

  async runBackup(): Promise<{ file: string; sizeBytes: number }> {
    fs.mkdirSync(this.backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `rmp-backup-${stamp}.sql`;
    const filePath = path.join(this.backupDir, fileName);

    const host = this.config.get<string>('db.host')!;
    const port = String(this.config.get<number>('db.port')!);
    const database = this.config.get<string>('db.database')!;
    const username = this.config.get<string>('backup.dbUsername')!;
    const password = this.config.get<string>('backup.dbPassword')!;

    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(filePath);
      const proc = spawn(
        'pg_dump',
        ['-h', host, '-p', port, '-U', username, '-d', database, '-F', 'p', '--no-owner'],
        { env: { ...process.env, PGPASSWORD: password } },
      );
      proc.stdout.pipe(out);
      let stderr = '';
      proc.stderr.on('data', (d) => (stderr += d.toString()));
      proc.on('error', reject);
      proc.on('close', (code) => {
        out.close();
        if (code === 0) resolve();
        else reject(new Error(`pg_dump exited with code ${code}: ${stderr}`));
      });
    });

    const sizeBytes = fs.statSync(filePath).size;
    this.logger.log(`Backup written: ${filePath} (${sizeBytes} bytes)`);
    return { file: fileName, sizeBytes };
  }

  /** Latest backup file's age in ms, or null if no backups exist yet (used by health check). */
  latestBackupAgeMs(): number | null {
    if (!fs.existsSync(this.backupDir)) return null;
    const files = fs
      .readdirSync(this.backupDir)
      .filter((f) => f.startsWith('rmp-backup-') && f.endsWith('.sql'))
      .map((f) => ({ f, mtime: fs.statSync(path.join(this.backupDir, f)).mtimeMs }));
    if (files.length === 0) return null;
    const latest = files.sort((a, b) => b.mtime - a.mtime)[0];
    return Date.now() - latest.mtime;
  }

  list(): Array<{ file: string; sizeBytes: number; createdAt: string }> {
    if (!fs.existsSync(this.backupDir)) return [];
    return fs
      .readdirSync(this.backupDir)
      .filter((f) => f.startsWith('rmp-backup-') && f.endsWith('.sql'))
      .map((f) => {
        const stat = fs.statSync(path.join(this.backupDir, f));
        return { file: f, sizeBytes: stat.size, createdAt: new Date(stat.mtimeMs).toISOString() };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
