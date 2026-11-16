import { Injectable } from '@nestjs/common';
import { currentManager } from '../common/db/request-context';
import { Measurement } from './entities/measurement.entity';
import { DataGap } from './entities/data-gap.entity';

/** Part 11: GET /reactors/{id}/live and raw measurement retrieval, RLS-scoped via laboratory_id. */
@Injectable()
export class MeasurementsService {
  async recentForEquipment(equipmentId: string, limit = 50): Promise<Measurement[]> {
    return currentManager()
      .getRepository(Measurement)
      .createQueryBuilder('m')
      .where('m.equipment_id = :equipmentId', { equipmentId })
      .orderBy('m.ts', 'DESC')
      .limit(limit)
      .getMany();
  }

  async latestForEquipment(equipmentId: string): Promise<Measurement | null> {
    const rows = await this.recentForEquipment(equipmentId, 1);
    return rows[0] ?? null;
  }

  async gapsForDevice(deviceId: string): Promise<DataGap[]> {
    return currentManager().find(DataGap, {
      where: { deviceId },
      order: { detectedAt: 'DESC' },
      take: 50,
    });
  }
}
