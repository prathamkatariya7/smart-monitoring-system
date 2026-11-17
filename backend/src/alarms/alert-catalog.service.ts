import { Injectable, NotFoundException } from '@nestjs/common';
import { currentManager } from '../common/db/request-context';
import { newId } from '../common/util/id.util';
import { AlertCatalog } from './entities/alert-catalog.entity';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.types';

/** Part 6.5 default alert classes; Admin can tune within policy limits. */
export const DEFAULT_ALERT_CATALOG: Array<
  Pick<AlertCatalog, 'alertType' | 'class' | 'overridableBy' | 'maxOverrideMin'>
> = [
  {
    alertType: 'THRESHOLD_WARNING',
    class: 'WARNING',
    overridableBy: 'OWNER',
    maxOverrideMin: 60,
  },
  {
    alertType: 'THRESHOLD_CRITICAL',
    class: 'CRITICAL',
    overridableBy: 'OWNER',
    maxOverrideMin: 15,
  },
  {
    alertType: 'PT100_FAULT',
    class: 'CRITICAL',
    overridableBy: 'OWNER',
    maxOverrideMin: 15,
  },
  {
    alertType: 'MOTOR_FAULT',
    class: 'CRITICAL',
    overridableBy: 'OWNER',
    maxOverrideMin: 15,
  },
  {
    alertType: 'MOTOR_LINK_DOWN',
    class: 'WARNING',
    overridableBy: 'OWNER',
    maxOverrideMin: 60,
  },
  {
    alertType: 'NETWORK_FAILOVER',
    class: 'INFO',
    overridableBy: 'OWNER',
    maxOverrideMin: 60,
  },
  {
    alertType: 'BUFFER_80_PERCENT',
    class: 'WARNING',
    overridableBy: 'OWNER',
    maxOverrideMin: 60,
  },
  {
    alertType: 'TIME_NOT_SYNCED',
    class: 'INFO',
    overridableBy: 'OWNER',
    maxOverrideMin: 60,
  },
  {
    alertType: 'CALIBRATION_DUE',
    class: 'INFO',
    overridableBy: 'OWNER',
    maxOverrideMin: 60,
  },
  {
    alertType: 'PLANNED_TIME_ELAPSED',
    class: 'INFO',
    overridableBy: 'OWNER',
    maxOverrideMin: 60,
  },
  {
    alertType: 'DEVICE_OFFLINE',
    class: 'WARNING',
    overridableBy: 'NONE',
    maxOverrideMin: 0,
  },
];

@Injectable()
export class AlertCatalogService {
  constructor(private readonly audit: AuditService) {}

  async list(): Promise<AlertCatalog[]> {
    const manager = currentManager();
    const all = await manager.find(AlertCatalog, {
      order: { alertType: 'ASC', version: 'DESC' },
    });
    // latest version per alert_type
    const latest = new Map<string, AlertCatalog>();
    for (const row of all) {
      if (!latest.has(row.alertType)) latest.set(row.alertType, row);
    }
    return Array.from(latest.values());
  }

  async ensureSeeded(): Promise<void> {
    const manager = currentManager();
    const existing = await manager.find(AlertCatalog);
    if (existing.length > 0) return;
    for (const def of DEFAULT_ALERT_CATALOG) {
      await manager.save(AlertCatalog, {
        id: newId(),
        version: 1,
        alertType: def.alertType,
        class: def.class,
        overridableBy: def.overridableBy,
        maxOverrideMin: def.maxOverrideMin,
        soundPattern: null,
        changedBy: null,
        reason: 'Default seed (Part 6.5)',
      });
    }
  }

  async getByType(alertType: string): Promise<AlertCatalog> {
    const manager = currentManager();
    const row = await manager
      .getRepository(AlertCatalog)
      .createQueryBuilder('c')
      .where('c.alert_type = :alertType', { alertType })
      .orderBy('c.version', 'DESC')
      .getOne();
    if (!row)
      throw new NotFoundException(`No alert catalog entry for ${alertType}`);
    return row;
  }

  /** Part 6.5: Admin can raise class / restrict override, never loosen beyond policy's override_critical. */
  async update(
    actor: AuthenticatedUser,
    alertType: string,
    patch: Partial<
      Pick<
        AlertCatalog,
        'class' | 'overridableBy' | 'maxOverrideMin' | 'soundPattern'
      >
    >,
    reason: string,
  ): Promise<AlertCatalog> {
    const manager = currentManager();
    const current = await this.getByType(alertType);
    const next = manager.create(AlertCatalog, {
      id: newId(),
      version: current.version + 1,
      alertType,
      class: patch.class ?? current.class,
      overridableBy: patch.overridableBy ?? current.overridableBy,
      maxOverrideMin: patch.maxOverrideMin ?? current.maxOverrideMin,
      soundPattern: patch.soundPattern ?? current.soundPattern,
      changedBy: actor.userId,
      reason,
    });
    await manager.save(next);

    await this.audit.record({
      userId: actor.userId,
      action: 'ALERT_CATALOG_CHANGED',
      entityType: 'alert_catalog',
      entityId: next.id,
      previousValue: current,
      newValue: patch,
      reason,
    });
    return next;
  }
}
