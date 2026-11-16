import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { currentManager } from '../common/db/request-context';
import { newId } from '../common/util/id.util';
import { Equipment } from './entities/equipment.entity';
import { DeviceBinding } from '../devices/entities/device-binding.entity';
import { DeviceState } from '../mqtt/entities/device-state.entity';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.types';

export type EquipmentWithConnectivity = Equipment & {
  online: boolean;
  boundDeviceId: string | null;
};

/** Part 3.1/10.2: the reactor is the permanent identity; never deleted, only DECOMMISSIONED. */
@Injectable()
export class EquipmentService {
  constructor(private readonly audit: AuditService) {}

  async list(): Promise<EquipmentWithConnectivity[]> {
    const list = await currentManager().find(Equipment, { where: { status: 'ACTIVE' as const } });
    if (list.length === 0) return [];

    const activeBindings = await currentManager()
      .getRepository(DeviceBinding)
      .createQueryBuilder('b')
      .where('b.equipment_id IN (:...ids) AND b.bound_to IS NULL', { ids: list.map((e) => e.id) })
      .getMany();

    const deviceIds = activeBindings.map((b) => b.deviceId);
    const deviceStates = deviceIds.length > 0
      ? await currentManager()
          .getRepository(DeviceState)
          .createQueryBuilder('s')
          .where('s.device_id IN (:...ids)', { ids: deviceIds })
          .getMany()
      : [];

    const stateByDeviceId = new Map(deviceStates.map((s) => [s.deviceId, s.online]));
    const bindingByEqId = new Map(activeBindings.map((b) => [b.equipmentId, b.deviceId]));

    return list.map((eq) => {
      const devId = bindingByEqId.get(eq.id) ?? null;
      const isOnline = devId ? (stateByDeviceId.get(devId) ?? false) : false;
      return {
        ...eq,
        boundDeviceId: devId,
        online: isOnline,
      };
    });
  }

  async get(id: string): Promise<EquipmentWithConnectivity> {
    const eq = await currentManager().findOne(Equipment, { where: { id } });
    if (!eq) throw new NotFoundException('Reactor not found');
    const binding = await currentManager()
      .getRepository(DeviceBinding)
      .createQueryBuilder('b')
      .where('b.equipment_id = :id AND b.bound_to IS NULL', { id })
      .getOne();

    let online = false;
    if (binding) {
      const state = await currentManager().findOne(DeviceState, {
        where: { deviceId: binding.deviceId },
      });
      online = state?.online ?? false;
    }
    return { ...eq, boundDeviceId: binding?.deviceId ?? null, online };
  }

  async create(
    actor: AuthenticatedUser,
    laboratoryId: string,
    reactorNumber: string,
    displayName?: string,
    profileId?: string,
  ): Promise<Equipment> {
    const manager = currentManager();
    const dup = await manager.findOne(Equipment, {
      where: { laboratoryId, reactorNumber },
    });
    if (dup) {
      throw new ConflictException(
        `Reactor number ${reactorNumber} already exists in this laboratory (C-19: unique per laboratory)`,
      );
    }
    const equipment = manager.create(Equipment, {
      id: newId(),
      laboratoryId,
      equipmentType: 'REACTOR',
      reactorNumber,
      displayName: displayName ?? null,
      profileId: profileId ?? null,
      maintenanceMode: false,
      status: 'ACTIVE',
    });
    await manager.save(equipment);
    await this.audit.record({
      userId: actor.userId,
      action: 'REACTOR_CREATED',
      entityType: 'equipment',
      entityId: equipment.id,
      equipmentId: equipment.id,
      newValue: { laboratoryId, reactorNumber, displayName },
    });
    return equipment;
  }

  async setMaintenanceMode(
    actor: AuthenticatedUser,
    id: string,
    maintenanceMode: boolean,
    reason: string,
  ): Promise<Equipment> {
    const manager = currentManager();
    const eq = await this.get(id);
    await manager.update(Equipment, { id }, { maintenanceMode });
    await this.audit.record({
      userId: actor.userId,
      action: 'REACTOR_MAINTENANCE_MODE_CHANGED',
      entityType: 'equipment',
      entityId: id,
      equipmentId: id,
      previousValue: { maintenanceMode: eq.maintenanceMode },
      newValue: { maintenanceMode },
      reason,
    });
    return this.get(id);
  }

  async decommission(actor: AuthenticatedUser, id: string, reason: string): Promise<Equipment> {
    const manager = currentManager();
    await this.get(id);
    await manager.update(Equipment, { id }, { status: 'DECOMMISSIONED' });
    await this.audit.record({
      userId: actor.userId,
      action: 'REACTOR_DECOMMISSIONED',
      entityType: 'equipment',
      entityId: id,
      equipmentId: id,
      reason,
    });
    return this.get(id);
  }
}
