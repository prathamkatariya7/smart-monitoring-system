import { Injectable, NotFoundException } from '@nestjs/common';
import { currentManager } from '../common/db/request-context';
import { newId } from '../common/util/id.util';
import { MaintenanceRecord } from './entities/maintenance-record.entity';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { CreateMaintenanceDto } from './dto/create-maintenance.dto';

/** Part 12.4: maintenance history + due list. No spare-parts/work-order/cost modules in the MVP. */
@Injectable()
export class MaintenanceService {
  constructor(private readonly audit: AuditService) {}

  async listForEquipment(equipmentId: string): Promise<MaintenanceRecord[]> {
    return currentManager().find(MaintenanceRecord, {
      where: { equipmentId },
      order: { performedOn: 'DESC' },
    });
  }

  async get(id: string): Promise<MaintenanceRecord> {
    const row = await currentManager().findOne(MaintenanceRecord, { where: { id } });
    if (!row) throw new NotFoundException('Maintenance record not found');
    return row;
  }

  async due(withinDays = 30): Promise<MaintenanceRecord[]> {
    const cutoff = new Date(Date.now() + withinDays * 86_400_000).toISOString().slice(0, 10);
    return currentManager()
      .getRepository(MaintenanceRecord)
      .createQueryBuilder('m')
      .where('m.next_due_on IS NOT NULL')
      .andWhere('m.next_due_on <= :cutoff', { cutoff })
      .orderBy('m.next_due_on', 'ASC')
      .getMany();
  }

  async create(actor: AuthenticatedUser, dto: CreateMaintenanceDto): Promise<MaintenanceRecord> {
    const manager = currentManager();
    const row = manager.create(MaintenanceRecord, {
      id: newId(),
      equipmentId: dto.equipmentId,
      kind: dto.kind as MaintenanceRecord['kind'],
      performedOn: dto.performedOn,
      performedBy: actor.userId,
      remarks: dto.remarks ?? null,
      nextDueOn: dto.nextDueOn ?? null,
      linkedDeviceBindingId: null,
    });
    await manager.save(row);

    await this.audit.record({
      userId: actor.userId,
      action: 'MAINTENANCE_RECORDED',
      entityType: 'maintenance_record',
      entityId: row.id,
      equipmentId: dto.equipmentId,
      newValue: { kind: dto.kind, performedOn: dto.performedOn },
    });
    return row;
  }
}
