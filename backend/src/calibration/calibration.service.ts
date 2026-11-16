import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { currentManager } from '../common/db/request-context';
import { newId } from '../common/util/id.util';
import { CalibrationVersion } from './entities/calibration-version.entity';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { CommandDispatcherService } from '../mqtt/command-dispatcher.service';
import { CfgDesiredService } from '../mqtt/cfg-desired.service';
import { Client } from '../tenancy/entities/client.entity';
import { CreateCalibrationDto } from './dto/create-calibration.dto';

/**
 * Part 12: calibration workflow.
 */
@Injectable()
export class CalibrationService {
  constructor(
    private readonly audit: AuditService,
    private readonly commandDispatcher: CommandDispatcherService,
    private readonly cfgDesired: CfgDesiredService,
  ) {}

  async listAll(): Promise<CalibrationVersion[]> {
    return currentManager().find(CalibrationVersion, { order: { createdAt: 'DESC' } });
  }

  async listForDevice(deviceId: string): Promise<CalibrationVersion[]> {
    return currentManager().find(CalibrationVersion, { where: { deviceId }, order: { createdAt: 'DESC' } });
  }

  async get(id: string): Promise<CalibrationVersion> {
    const row = await currentManager().findOne(CalibrationVersion, { where: { id } });
    if (!row) throw new NotFoundException('Calibration version not found');
    return row;
  }

  async dueList(withinDays = 30): Promise<CalibrationVersion[]> {
    const cutoff = new Date(Date.now() + withinDays * 86_400_000).toISOString().slice(0, 10);
    return currentManager()
      .getRepository(CalibrationVersion)
      .createQueryBuilder('c')
      .where("c.status = 'APPLIED'")
      .andWhere('c.due_on IS NOT NULL')
      .andWhere('c.due_on <= :cutoff', { cutoff })
      .getMany();
  }

  async create(actor: AuthenticatedUser, dto: CreateCalibrationDto): Promise<CalibrationVersion> {
    const manager = currentManager();
    const previous = await manager.findOne(CalibrationVersion, {
      where: { deviceId: dto.deviceId, channel: dto.channel, status: 'APPLIED' },
    });

    const { a, b, errorSummary } = this.computeCoefficients(dto.method, dto.points);

    const row = manager.create(CalibrationVersion, {
      id: newId(),
      deviceId: dto.deviceId,
      equipmentId: dto.equipmentId,
      channel: dto.channel,
      method: dto.method,
      pointsJson: { points: dto.points },
      coefficientsJson: { a, b },
      previousVersionId: previous?.id ?? null,
      errorSummary,
      referenceInstrument: dto.referenceInstrument ?? null,
      certificateNo: dto.certificateNo ?? null,
      certificateFileRef: dto.certificateFileRef ?? null,
      calibratedOn: dto.calibratedOn ?? null,
      dueOn: dto.dueOn ?? null,
      status: 'DRAFT',
      enteredBy: actor.userId,
      reason: dto.reason,
    });
    await manager.save(row);

    await this.audit.record({
      userId: actor.userId,
      action: 'CALIBRATION_ENTERED',
      entityType: 'calibration_version',
      entityId: row.id,
      equipmentId: dto.equipmentId,
      newValue: { channel: dto.channel, method: dto.method, a, b },
      reason: dto.reason,
    });
    return row;
  }

  /** Part 12.1: error = indicated - reference; correction = -error (C-11). Two-point: linear fit a*raw+b. */
  private computeCoefficients(
    method: string,
    points: Array<{ reference: number; indicated: number }>,
  ): { a: number; b: number; errorSummary: Record<string, unknown> } {
    const errors = points.map((p) => ({ ...p, error: p.indicated - p.reference }));

    if (method === 'single_point' || points.length === 1) {
      const correction = -errors[0].error;
      return { a: 1, b: correction, errorSummary: { errors } };
    }

    // two_point / multi_point: least-squares linear fit indicated = a*reference + b,
    // then invert so corrected = a_inv*indicated + b_inv maps indicated back onto reference.
    const n = points.length;
    const sumX = points.reduce((s, p) => s + p.indicated, 0);
    const sumY = points.reduce((s, p) => s + p.reference, 0);
    const sumXY = points.reduce((s, p) => s + p.indicated * p.reference, 0);
    const sumXX = points.reduce((s, p) => s + p.indicated * p.indicated, 0);
    const denom = n * sumXX - sumX * sumX;
    const a = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 1;
    const b = denom !== 0 ? (sumY - a * sumX) / n : -errors[0].error;

    return { a, b, errorSummary: { errors } };
  }

  async approve(actor: AuthenticatedUser, id: string): Promise<CalibrationVersion> {
    const manager = currentManager();
    const row = await this.get(id);
    if (row.status !== 'DRAFT') throw new ConflictException('Only a DRAFT calibration can be approved');

    const [client] = await manager.find(Client, { take: 1 });
    if (client?.policyPack === 'regulated' && row.enteredBy === actor.userId) {
      throw new ForbiddenException(
        'Regulated policy pack requires dual approval -- a second Admin must approve (cannot self-approve)',
      );
    }

    await manager.update(CalibrationVersion, { id }, { status: 'APPROVED', approvedBy: actor.userId });
    await this.audit.record({
      userId: actor.userId,
      action: 'CALIBRATION_APPROVED',
      entityType: 'calibration_version',
      entityId: id,
      equipmentId: row.equipmentId,
    });
    return this.get(id);
  }

  async apply(actor: AuthenticatedUser, id: string): Promise<CalibrationVersion> {
    const manager = currentManager();
    const row = await this.get(id);
    if (row.status !== 'APPROVED') throw new ConflictException('Only an APPROVED calibration can be applied');

    const coeff = (row.coefficientsJson as any) ?? {};
    await this.commandDispatcher.send(
      row.deviceId,
      'set_calibration',
      {
        version: id,
        channel: row.channel,
        method: row.method,
        coefficients: row.coefficientsJson,
        offset: typeof coeff.b === 'number' ? coeff.b : 0.0,
        gain: typeof coeff.a === 'number' ? coeff.a : 1.0,
      },
      actor.userId,
    );

    if (row.previousVersionId) {
      await manager.update(CalibrationVersion, { id: row.previousVersionId }, { status: 'SUPERSEDED' });
    }
    await manager.update(CalibrationVersion, { id }, { status: 'APPLIED', validFrom: new Date() });
    await this.cfgDesired.pushToDevice(row.deviceId);

    await this.audit.record({
      userId: actor.userId,
      action: 'CALIBRATION_APPLIED',
      entityType: 'calibration_version',
      entityId: id,
      equipmentId: row.equipmentId,
    });
    return this.get(id);
  }

  async rollback(actor: AuthenticatedUser, id: string, reason: string): Promise<CalibrationVersion> {
    const manager = currentManager();
    const row = await this.get(id);
    if (row.status !== 'APPLIED') throw new ConflictException('Only an APPLIED calibration can be rolled back');
    if (!row.previousVersionId) throw new ConflictException('No previous calibration version to roll back to');

    const previous = await this.get(row.previousVersionId);
    await this.commandDispatcher.send(
      row.deviceId,
      'set_calibration',
      { version: previous.id, channel: previous.channel, method: previous.method, coefficients: previous.coefficientsJson },
      actor.userId,
    );

    await manager.update(CalibrationVersion, { id }, { status: 'ROLLED_BACK' });
    await manager.update(CalibrationVersion, { id: previous.id }, { status: 'APPLIED' });

    await this.audit.record({
      userId: actor.userId,
      action: 'CALIBRATION_ROLLED_BACK',
      entityType: 'calibration_version',
      entityId: id,
      equipmentId: row.equipmentId,
      previousValue: { rolledBackFrom: id },
      newValue: { restoredVersion: previous.id },
      reason,
    });
    return this.get(previous.id);
  }
}
