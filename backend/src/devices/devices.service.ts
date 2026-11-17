import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { IsNull } from 'typeorm';
import { currentManager } from '../common/db/request-context';
import { newId } from '../common/util/id.util';
import { Device } from './entities/device.entity';
import { DeviceBinding } from './entities/device-binding.entity';
import { DeviceState } from '../mqtt/entities/device-state.entity';
import { Equipment } from '../equipment/entities/equipment.entity';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { LicenceService } from '../licence/licence.service';
import { CfgDesiredService } from '../mqtt/cfg-desired.service';
import { NotificationsService } from '../notifications/notifications.service';

/** Device row + the connectivity fields callers actually want to show as
 * "online/offline" -- NOT the same thing as Device.status (claim lifecycle,
 * stays ACTIVE forever once claimed, regardless of whether the physical
 * device is reachable). See DeviceOfflineSchedulerService for how `online`
 * gets flipped back to false on a heartbeat timeout. */
export type DeviceWithConnectivity = Device & {
  online: boolean;
  lastTelemetryAt: Date | null;
  currentBinding?: {
    bindingId: string;
    equipmentId: string;
    reactorNumber?: string | null;
    displayName?: string | null;
  } | null;
};

/** Part 3.4 claim flow, Part 10.1 key rule, Part 12.5 replacement. */
@Injectable()
export class DevicesService {
  constructor(
    private readonly audit: AuditService,
    private readonly licence: LicenceService,
    private readonly cfgDesired: CfgDesiredService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(): Promise<DeviceWithConnectivity[]> {
    const devices = await currentManager().find(Device);
    return this.withConnectivity(devices);
  }

  async get(id: string): Promise<DeviceWithConnectivity> {
    const device = await currentManager().findOne(Device, { where: { id } });
    if (!device) throw new NotFoundException('Device not found');
    const [withState] = await this.withConnectivity([device]);
    return withState;
  }

  /** Joins DeviceState (no RLS policy -- same manager is fine) to attach the
   * real connectivity flag/last-telemetry-timestamp onto each Device row. */
  private async withConnectivity(
    devices: Device[],
  ): Promise<DeviceWithConnectivity[]> {
    if (devices.length === 0) return [];
    const manager = currentManager();
    const ids = devices.map((d) => d.id);
    const states = await manager
      .getRepository(DeviceState)
      .createQueryBuilder('s')
      .where('s.device_id IN (:...ids)', { ids })
      .getMany();
    const stateByDeviceId = new Map(states.map((s) => [s.deviceId, s]));

    const openBindings = await manager
      .getRepository(DeviceBinding)
      .createQueryBuilder('b')
      .where('b.device_id IN (:...ids)', { ids })
      .andWhere('b.bound_to IS NULL')
      .getMany();

    const eqIds = openBindings.map((b) => b.equipmentId);
    const equipments =
      eqIds.length > 0
        ? await manager
            .getRepository(Equipment)
            .createQueryBuilder('e')
            .where('e.id IN (:...eqIds)', { eqIds })
            .getMany()
        : [];
    const eqById = new Map(equipments.map((e) => [e.id, e]));
    const bindingByDeviceId = new Map(
      openBindings.map((b) => {
        const eq = eqById.get(b.equipmentId);
        return [
          b.deviceId,
          {
            bindingId: b.id,
            equipmentId: b.equipmentId,
            reactorNumber: eq?.reactorNumber ?? null,
            displayName: eq?.displayName ?? null,
          },
        ];
      }),
    );

    return devices.map((d) => {
      const state = stateByDeviceId.get(d.id);
      const binding = bindingByDeviceId.get(d.id) ?? null;
      return {
        ...d,
        online: state?.online ?? false,
        lastTelemetryAt: state?.lastTs ?? null,
        currentBinding: binding,
      };
    });
  }

  async history(id: string): Promise<DeviceBinding[]> {
    await this.get(id);
    return currentManager().find(DeviceBinding, {
      where: { deviceId: id },
      order: { boundFrom: 'ASC' },
    });
  }

  /**
   * Part 3.4 step 4: "the device joins this installation as UNBOUND."
   * In this software-only pass (no factory provisioning pipeline yet), a
   * claim either matches a pre-registered device by serialNo+claimCode, or
   * (dev convenience, clearly flagged) registers it on first claim so the
   * claim flow is testable without real hardware/factory tooling.
   */
  async claim(
    actor: AuthenticatedUser,
    serialNo: string,
    claimCode: string,
    hwRevision?: string,
    certSerial?: string,
  ): Promise<Device> {
    const manager = currentManager();
    const sNo = serialNo?.trim();
    const cCode = claimCode?.trim();
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        cCode,
      );
    const cleanMac = cCode.replace(/[:-]/g, '').toLowerCase();
    const derivedUuid = /^[0-9a-f]{12}$/.test(cleanMac)
      ? `01a1af2d-e705-75aa-b3fc-${cleanMac}`
      : null;

    let device = await manager.findOne(Device, {
      where: [
        { serialNo: sNo },
        { claimCode: cCode },
        ...(isUuid
          ? [{ id: cCode.toLowerCase() }, { claimCode: cCode.toLowerCase() }]
          : []),
        ...(derivedUuid
          ? [{ id: derivedUuid }, { claimCode: derivedUuid }]
          : []),
      ],
    });

    // Part 9.9: licence device-count limit only blocks claiming NEW devices,
    // never data collection/viewing/export on devices already claimed.
    const alreadyClaimed =
      device?.claimState === 'CLAIMED' && device?.status === 'ACTIVE';
    if (!alreadyClaimed) {
      const activeCount = await manager.count(Device, {
        where: { claimState: 'CLAIMED', status: 'ACTIVE' },
      });
      const { allowed, reason } = this.licence.canClaimDevice(activeCount);
      if (!allowed) {
        throw new ForbiddenException(
          reason ?? 'Licence does not permit claiming another device',
        );
      }
    }

    if (device) {
      if (device.status === 'DECOMMISSIONED') {
        // Re-claiming / reactivating an accidentally decommissioned device
        await manager.update(
          Device,
          { id: device.id },
          {
            claimState: 'CLAIMED',
            status: 'ACTIVE',
            serialNo: sNo || device.serialNo,
            hwRevision: hwRevision ?? device.hwRevision,
            certSerial: certSerial ?? device.certSerial,
            lastSeen: new Date(),
          },
        );
        await this.audit.record({
          userId: actor.userId,
          action: 'DEVICE_CLAIMED',
          entityType: 'device',
          entityId: device.id,
          previousValue: { status: 'DECOMMISSIONED' },
          newValue: { status: 'ACTIVE', serialNo: sNo || device.serialNo },
        });
        try {
          await this.cfgDesired.pushToDevice(device.id);
        } catch {
          // non-blocking push
        }
        this.notifications.broadcast('device_status', {
          deviceId: device.id,
          status: 'ACTIVE',
          online: true,
        });
        this.notifications.broadcast('device_binding_changed', {
          deviceId: device.id,
          action: 'CLAIM',
        });
        return this.get(device.id);
      }

      if (device.claimState === 'CLAIMED') {
        throw new ConflictException('Device is already claimed and active');
      }

      const matchesClaimCode =
        device.claimCode === cCode ||
        device.claimCode?.toLowerCase() === cCode.toLowerCase() ||
        device.id.toLowerCase() === cCode.toLowerCase() ||
        (derivedUuid &&
          (device.id.toLowerCase() === derivedUuid ||
            device.claimCode?.toLowerCase() === derivedUuid));

      if (device.claimCode && !matchesClaimCode) {
        throw new BadRequestException(
          'Claim code does not match this device (C-23 trust check failed)',
        );
      }
      await manager.update(
        Device,
        { id: device.id },
        {
          claimState: 'CLAIMED',
          status: 'ACTIVE',
          serialNo: sNo || device.serialNo,
          hwRevision: hwRevision ?? device.hwRevision,
          certSerial: certSerial ?? device.certSerial,
        },
      );
    } else {
      const targetId = isUuid ? cCode.toLowerCase() : (derivedUuid ?? newId());
      device = manager.create(Device, {
        id: targetId,
        serialNo: sNo,
        hwRevision: hwRevision ?? null,
        certSerial: certSerial ?? null,
        claimCode: cCode,
        claimState: 'CLAIMED',
        status: 'ACTIVE',
      });
      await manager.save(device);
    }

    await this.audit.record({
      userId: actor.userId,
      action: 'DEVICE_CLAIMED',
      entityType: 'device',
      entityId: device.id,
      newValue: { serialNo: sNo, hwRevision, certSerial },
    });
    try {
      await this.cfgDesired.pushToDevice(device.id);
    } catch {
      // non-blocking push
    }
    this.notifications.broadcast('device_status', {
      deviceId: device.id,
      status: 'ACTIVE',
      online: true,
    });
    this.notifications.broadcast('device_binding_changed', {
      deviceId: device.id,
      action: 'CLAIM',
    });
    return this.get(device.id);
  }

  async reactivate(
    actor: AuthenticatedUser,
    deviceId: string,
    reason: string,
  ): Promise<Device> {
    const manager = currentManager();
    const device = await manager.findOne(Device, { where: { id: deviceId } });
    if (!device) throw new NotFoundException('Device not found');
    await manager.update(
      Device,
      { id: deviceId },
      {
        status: 'ACTIVE',
        claimState: 'CLAIMED',
        lastSeen: new Date(),
      },
    );
    await this.audit.record({
      userId: actor.userId,
      action: 'DEVICE_REACTIVATED',
      entityType: 'device',
      entityId: deviceId,
      previousValue: { status: device.status },
      newValue: { status: 'ACTIVE' },
      reason,
    });
    try {
      await this.cfgDesired.pushToDevice(deviceId);
    } catch {
      // non-blocking push
    }
    this.notifications.broadcast('device_status', {
      deviceId,
      status: 'ACTIVE',
      online: true,
    });
    this.notifications.broadcast('device_binding_changed', {
      deviceId,
      action: 'CLAIM',
    });
    return this.get(deviceId);
  }

  /** Part 11: POST /devices/claim/bulk (CSV) -- one `serialNo,claimCode[,hwRevision[,certSerial]]` row per line. */
  async claimBulk(
    actor: AuthenticatedUser,
    csv: string,
  ): Promise<{
    claimed: Device[];
    errors: Array<{ line: number; message: string }>;
  }> {
    const lines = csv
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.toLowerCase().startsWith('serialno'));

    const claimed: Device[] = [];
    const errors: Array<{ line: number; message: string }> = [];
    for (let i = 0; i < lines.length; i++) {
      const [serialNo, claimCode, hwRevision, certSerial] = lines[i]
        .split(',')
        .map((s) => s.trim());
      try {
        if (!serialNo || !claimCode)
          throw new BadRequestException('serialNo and claimCode are required');
        const device = await this.claim(
          actor,
          serialNo,
          claimCode,
          hwRevision,
          certSerial,
        );
        claimed.push(device);
      } catch (err: any) {
        errors.push({ line: i + 1, message: err.message ?? 'unknown error' });
      }
    }
    return { claimed, errors };
  }

  /** Part 3.4 step 4 / Part 10.1: bind a claimed device to a reactor, opening device_binding. */
  async bind(
    actor: AuthenticatedUser,
    deviceId: string,
    equipmentId: string,
    reason: string,
  ): Promise<DeviceBinding> {
    const manager = currentManager();
    const device = await this.get(deviceId);
    if (device.claimState !== 'CLAIMED') {
      throw new BadRequestException('Device must be claimed before binding');
    }
    const equipment = await manager.findOne(Equipment, {
      where: { id: equipmentId },
    });
    if (!equipment) throw new NotFoundException('Reactor not found');

    const openDeviceBinding = await manager.findOne(DeviceBinding, {
      where: { deviceId, boundTo: IsNull() },
    });
    if (openDeviceBinding) {
      throw new ConflictException(
        'Device already has an open binding; unbind or replace first',
      );
    }
    const openEquipmentBinding = await manager.findOne(DeviceBinding, {
      where: { equipmentId, boundTo: IsNull() },
    });
    if (openEquipmentBinding) {
      throw new ConflictException(
        'Reactor already has a device bound; unbind or replace first',
      );
    }

    const binding = manager.create(DeviceBinding, {
      id: newId(),
      deviceId,
      equipmentId,
      laboratoryId: equipment.laboratoryId,
      boundFrom: new Date(),
      boundTo: null,
      boundBy: actor.userId,
      reason,
    });
    await manager.save(binding);
    await this.audit.record({
      userId: actor.userId,
      action: 'DEVICE_BOUND',
      entityType: 'device_binding',
      entityId: binding.id,
      equipmentId,
      deviceId,
      newValue: { deviceId, equipmentId },
      reason,
    });
    try {
      await this.cfgDesired.pushToDevice(deviceId);
    } catch {
      // non-blocking push
    }
    this.notifications.broadcast('device_binding_changed', {
      deviceId,
      equipmentId,
      action: 'BIND',
    });
    this.notifications.broadcast('device_status', { deviceId, online: true });
    return binding;
  }

  async unbind(
    actor: AuthenticatedUser,
    deviceId: string,
    reason: string,
  ): Promise<void> {
    const manager = currentManager();
    const binding = await manager.findOne(DeviceBinding, {
      where: { deviceId, boundTo: IsNull() },
    });
    if (!binding) throw new NotFoundException('Device has no open binding');
    await manager.update(
      DeviceBinding,
      { id: binding.id },
      { boundTo: new Date(), reason },
    );
    await this.audit.record({
      userId: actor.userId,
      action: 'DEVICE_UNBOUND',
      entityType: 'device_binding',
      entityId: binding.id,
      equipmentId: binding.equipmentId,
      reason,
    });
    try {
      await this.cfgDesired.pushToDevice(deviceId);
    } catch {
      // non-blocking push
    }
    this.notifications.broadcast('device_binding_changed', {
      deviceId,
      equipmentId: binding.equipmentId,
      action: 'UNBIND',
    });
    this.notifications.broadcast('device_status', { deviceId });
  }

  /**
   * Part 12.5 device replacement: close the failed device's binding, open the
   * new device's binding to the same (or a chosen new) reactor, mark the old
   * device DECOMMISSIONED (identity retained, never reused). Old and new
   * measurement rows both keep their respective device_id and the same
   * equipment_id -- histories are never merged.
   */
  async replace(
    actor: AuthenticatedUser,
    failedDeviceId: string,
    newDeviceId: string,
    mapToEquipmentId: string | undefined,
    reason: string,
  ): Promise<DeviceBinding> {
    const manager = currentManager();
    const oldBinding = await manager.findOne(DeviceBinding, {
      where: { deviceId: failedDeviceId, boundTo: IsNull() },
    });
    if (!oldBinding)
      throw new NotFoundException(
        'Failed device has no open binding to replace',
      );

    const targetEquipmentId = mapToEquipmentId ?? oldBinding.equipmentId;

    await manager.update(
      DeviceBinding,
      { id: oldBinding.id },
      {
        boundTo: new Date(),
        reason: `Replaced by device ${newDeviceId}: ${reason}`,
      },
    );
    await manager.update(
      Device,
      { id: failedDeviceId },
      { status: 'DECOMMISSIONED' },
    );

    const newBinding = await this.bind(
      actor,
      newDeviceId,
      targetEquipmentId,
      reason,
    );
    await manager.update(
      DeviceBinding,
      { id: newBinding.id },
      { replacesBindingId: oldBinding.id },
    );

    await this.audit.record({
      userId: actor.userId,
      action: 'DEVICE_REPLACED',
      entityType: 'device',
      entityId: failedDeviceId,
      equipmentId: targetEquipmentId,
      previousValue: { failedDeviceId, oldBindingId: oldBinding.id },
      newValue: { newDeviceId, newBindingId: newBinding.id },
      reason,
    });
    try {
      await this.cfgDesired.pushToDevice(failedDeviceId);
    } catch {
      // non-blocking push
    }
    this.notifications.broadcast('device_status', {
      deviceId: failedDeviceId,
      status: 'DECOMMISSIONED',
    });
    this.notifications.broadcast('device_binding_changed', {
      deviceId: newDeviceId,
      equipmentId: targetEquipmentId,
      action: 'BIND',
    });
    return manager.findOneOrFail(DeviceBinding, {
      where: { id: newBinding.id },
    });
  }

  async decommission(
    actor: AuthenticatedUser,
    deviceId: string,
    reason: string,
  ): Promise<Device> {
    const manager = currentManager();
    const device = await this.get(deviceId);
    const openBinding = await manager.findOne(DeviceBinding, {
      where: { deviceId, boundTo: IsNull() },
    });
    if (openBinding) {
      await manager.update(
        DeviceBinding,
        { id: openBinding.id },
        { boundTo: new Date(), reason },
      );
    }
    await manager.update(
      Device,
      { id: deviceId },
      { status: 'DECOMMISSIONED' },
    );
    await this.audit.record({
      userId: actor.userId,
      action: 'DEVICE_DECOMMISSIONED',
      entityType: 'device',
      entityId: deviceId,
      previousValue: { status: device.status },
      newValue: { status: 'DECOMMISSIONED' },
      reason,
    });
    try {
      await this.cfgDesired.pushToDevice(deviceId);
    } catch {
      // non-blocking push
    }
    this.notifications.broadcast('device_status', {
      deviceId,
      status: 'DECOMMISSIONED',
    });
    this.notifications.broadcast('device_binding_changed', {
      deviceId,
      action: 'DECOMMISSION',
    });
    return this.get(deviceId);
  }
}
