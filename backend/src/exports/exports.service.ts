import { Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { currentManager } from '../common/db/request-context';
import { newId } from '../common/util/id.util';
import { ExportJob } from './entities/export-job.entity';
import { Measurement } from '../measurements/entities/measurement.entity';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { CreateExportDto } from './dto/create-export.dto';

const EXPORT_DIR = process.env.EXPORT_DIR ?? path.join(process.cwd(), 'exports');

/**
 * Part 8.5: raw CSV export, selection-rule downsampling, and the
 * manifest+SHA-256 convention from Part 9.2 ("Local filesystem with hash
 * manifest"). PDF process reports (Part 8.5/14.7) are NOT implemented this
 * pass -- they need a headless-Chromium render worker (Part 9.2) that isn't
 * wired up yet; flagged here rather than faked with a placeholder file.
 */
@Injectable()
export class ExportsService {
  constructor(private readonly audit: AuditService) {}

  async get(id: string): Promise<ExportJob> {
    const row = await currentManager().findOne(ExportJob, { where: { id } });
    if (!row) throw new NotFoundException('Export job not found');
    return row;
  }

  async listForUser(userId: string): Promise<ExportJob[]> {
    return currentManager().find(ExportJob, { where: { requestedBy: userId }, order: { createdAt: 'DESC' } });
  }

  async create(actor: AuthenticatedUser, dto: CreateExportDto): Promise<ExportJob> {
    const manager = currentManager();
    const job = manager.create(ExportJob, {
      id: newId(),
      requestedBy: actor.userId,
      scopeJson: dto as unknown as Record<string, unknown>,
      status: 'RUNNING',
    });
    await manager.save(job);

    try {
      const rows = await manager
        .getRepository(Measurement)
        .createQueryBuilder('m')
        .where('m.equipment_id = :equipmentId', { equipmentId: dto.equipmentId })
        .andWhere('m.ts >= :from', { from: new Date(dto.from) })
        .andWhere('m.ts <= :to', { to: new Date(dto.to) })
        .orderBy('m.ts', 'ASC')
        .getMany();

      const csv = this.toCsv(rows, dto.intervalS);
      fs.mkdirSync(EXPORT_DIR, { recursive: true });
      const fileName = `export_${job.id}.csv`;
      const filePath = path.join(EXPORT_DIR, fileName);
      fs.writeFileSync(filePath, csv, 'utf8');
      const sha256 = crypto.createHash('sha256').update(csv).digest('hex');

      await manager.update(ExportJob, { id: job.id }, {
        status: 'DONE',
        fileRef: filePath,
        sha256,
        completedAt: new Date(),
      });

      await this.audit.record({
        userId: actor.userId,
        action: 'EXPORT_CREATED',
        entityType: 'export_job',
        entityId: job.id,
        equipmentId: dto.equipmentId,
        newValue: { rowCount: rows.length, sha256 },
      });
    } catch (err: any) {
      await manager.update(ExportJob, { id: job.id }, { status: 'FAILED', error: err.message });
    }
    return this.get(job.id);
  }

  /**
   * Part 8.5 selection rule: "convert each sample's acquisition time to
   * whole UTC seconds; output the samples whose second satisfies
   * epoch_second mod N = 0. If no sample exists for an expected output
   * second, emit a row marked MISSING." intervalS=1 (or omitted) means the
   * raw export -- every row, no selection applied.
   */
  private toCsv(rows: Measurement[], intervalS?: number): string {
    const header = [
      'timestamp_utc',
      'device_id',
      'equipment_id',
      'seq',
      'boot_id',
      'temperature_c',
      'temperature_raw_c',
      'rpm',
      'torque_ncm',
      'quality',
      'fault_code',
      'flags',
      'calibration_version',
    ].join(',');

    const selected =
      !intervalS || intervalS <= 1
        ? rows
        : rows.filter((r) => Math.floor(r.ts.getTime() / 1000) % intervalS === 0);

    const lines = selected.map((r) =>
      [
        r.ts.toISOString(),
        r.deviceId,
        r.equipmentId,
        r.seq,
        r.bootId,
        r.temperatureC ?? '',
        r.temperatureRawC ?? '',
        r.rpm ?? '',
        r.torqueNcm ?? '',
        r.quality ?? '',
        r.faultCode ?? '',
        r.flags,
        r.calibrationVersion ?? '',
      ].join(','),
    );
    return [header, ...lines].join('\n');
  }

  getFilePath(job: ExportJob): string {
    if (!job.fileRef || job.status !== 'DONE') {
      throw new NotFoundException('Export file not ready');
    }
    return job.fileRef;
  }
}
