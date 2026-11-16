import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { IsNull } from 'typeorm';
import { currentManager } from '../common/db/request-context';
import { newId } from '../common/util/id.util';
import { MqttClientService } from './mqtt-client.service';
import { DeviceConfigVersion } from './entities/device-config-version.entity';
import { Device } from '../devices/entities/device.entity';
import { DeviceBinding } from '../devices/entities/device-binding.entity';
import { Equipment } from '../equipment/entities/equipment.entity';
import { Laboratory } from '../tenancy/entities/laboratory.entity';
import { Client } from '../tenancy/entities/client.entity';
import { FeatureSwitch } from '../tenancy/entities/feature-switch.entity';
import { Process } from '../processes/entities/process.entity';
import { ProcessAssignment } from '../processes/entities/process-assignment.entity';
import { AppUser } from '../auth/entities/app-user.entity';
import { ThresholdVersion } from '../processes/entities/threshold-version.entity';
import { CalibrationVersion } from '../calibration/entities/calibration-version.entity';

/**
 * Part 8.2 `cfg/desired`: retained, versioned configuration + assignment
 * bundle. Threshold/calibration/alert-catalog/network sections are added by
 * their owning modules as they land (process lifecycle, calibration,
 * alarms); this builds the parts that already exist (policy pack, feature
 * switches, current reactor binding) so the retained topic is meaningful
 * now and additive later -- never a breaking shape change (Part 9.7.3).
 */
@Injectable()
export class CfgDesiredService {
  private readonly logger = new Logger(CfgDesiredService.name);

  constructor(private readonly mqtt: MqttClientService) {}

  async pushToDevice(deviceId: string): Promise<DeviceConfigVersion> {
    const manager = currentManager();
    const device = await manager.findOne(Device, { where: { id: deviceId } });
    if (!device) throw new NotFoundException('Device not found');

    const binding = await manager.findOne(DeviceBinding, { where: { deviceId, boundTo: IsNull() } });
    const equipment = binding
      ? await manager.findOne(Equipment, { where: { id: binding.equipmentId } })
      : null;
    const laboratory = equipment
      ? await manager.findOne(Laboratory, { where: { id: equipment.laboratoryId } })
      : null;
    const [client] = await manager.find(Client, { take: 1 });
    const featureSwitches = await manager.find(FeatureSwitch);

    let assignmentData: Record<string, unknown> | null = null;
    let thresholdData: Record<string, unknown> | null = null;

    if (binding) {
      const activeProcess = await manager
        .getRepository(Process)
        .createQueryBuilder('p')
        .where('p.equipment_id = :equipmentId', { equipmentId: binding.equipmentId })
        .andWhere("p.status IN ('SCHEDULED', 'ACCEPTED', 'RUNNING', 'PAUSED')")
        .orderBy('p.planned_start_utc', 'ASC')
        .getOne();

      if (activeProcess) {
        const ownerAssign = await manager.findOne(ProcessAssignment, {
          where: { processId: activeProcess.id, role: 'OWNER' },
        });
        let ownerName = '';
        if (ownerAssign) {
          const user = await manager.findOne(AppUser, { where: { id: ownerAssign.userId } });
          ownerName = user?.name ?? '';
        }
        const thr = await manager.findOne(ThresholdVersion, {
          where: { processId: activeProcess.id, status: 'APPROVED' },
        });
        thresholdData = thr?.paramsJson ?? null;
        assignmentData = {
          processId: activeProcess.id,
          processName: activeProcess.name,
          status: activeProcess.status,
          assignmentStatus: ownerAssign?.status ?? 'PENDING',
          ownerName: ownerName,
          ownerUserId: ownerAssign?.userId ?? null,
          thresholds: thresholdData,
        };
      }
    }

    const activeCal = await manager
      .getRepository(CalibrationVersion)
      .createQueryBuilder('c')
      .where('c.device_id = :deviceId', { deviceId })
      .andWhere("c.status = 'APPLIED'")
      .orderBy('c.created_at', 'DESC')
      .getOne();

    let calibrationData: Record<string, unknown> | null = null;
    if (activeCal) {
      const coeff = (activeCal.coefficientsJson as any) ?? {};
      calibrationData = {
        version: activeCal.configVersion ?? 1,
        channel: activeCal.channel,
        method: activeCal.method,
        offset: typeof coeff.b === 'number' ? coeff.b : 0.0,
        gain: typeof coeff.a === 'number' ? coeff.a : 1.0,
        validUntil: activeCal.dueOn ?? null,
      };
    }

    const lastVersionRow = await manager
      .getRepository(DeviceConfigVersion)
      .createQueryBuilder('v')
      .where('v.device_id = :deviceId', { deviceId })
      .orderBy('v.version', 'DESC')
      .limit(1)
      .getOne();
    const version = (lastVersionRow?.version ?? 0) + 1;

    const isDecommissioned = device.status === 'DECOMMISSIONED';

    const bundle = {
      version,
      status: device.status,
      decommissioned: isDecommissioned,
      policyPack: client?.policyPack ?? 'flexible',
      featureSwitches: Object.fromEntries(featureSwitches.map((f) => [f.key, f.value])),
      binding: isDecommissioned
        ? null
        : binding
          ? { equipmentId: binding.equipmentId, laboratoryId: binding.laboratoryId, reactorNumber: equipment?.reactorNumber }
          : null,
      laboratoryName: isDecommissioned ? null : (laboratory?.name ?? null),
      assignment: isDecommissioned ? null : assignmentData,
      thresholds: isDecommissioned ? null : thresholdData,
      alertCatalog: null,
      calibration: isDecommissioned ? null : calibrationData,
      network: null,
    };

    const row = manager.create(DeviceConfigVersion, {
      id: newId(),
      deviceId,
      version,
      bundleJson: bundle,
    });
    await manager.save(row);

    this.mqtt.publish(`rmp/v1/${deviceId}/cfg/desired`, JSON.stringify(bundle), {
      qos: 1,
      retain: true,
    });
    this.logger.log(`Pushed cfg/desired v${version} to device ${deviceId}`);
    return row;
  }
}
