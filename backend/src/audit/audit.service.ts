import { Injectable } from '@nestjs/common';
import { newId } from '../common/util/id.util';
import { currentManager } from '../common/db/request-context';
import { AuditRecord } from './entities/audit-record.entity';

export interface AuditInput {
  userId?: string | null;
  userRole?: string | null;
  deviceId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  previousValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
  processId?: string | null;
  equipmentId?: string | null;
  configVersion?: number | null;
}

/**
 * Part 13.1: every state-changing action in Parts 3-12 goes through here.
 * hash/prev_hash are computed server-side by the audit_record_chain trigger
 * (migration 1730000000008), so the service only needs to insert the row
 * inside the current RLS-scoped transaction (currentManager()).
 */
@Injectable()
export class AuditService {
  async record(input: AuditInput): Promise<void> {
    const manager = currentManager();
    const row = manager.create(AuditRecord, {
      auditId: newId(),
      tsUtc: new Date(),
      userId: input.userId ?? null,
      userRole: input.userRole ?? null,
      deviceId: input.deviceId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      previousValueJson: input.previousValue ?? null,
      newValueJson: input.newValue ?? null,
      reason: input.reason ?? null,
      processId: input.processId ?? null,
      equipmentId: input.equipmentId ?? null,
      configVersion: input.configVersion ?? null,
      // hash/prev_hash are overwritten by the DB trigger; placeholder to satisfy the type.
      hash: '',
    });
    await manager.save(row);
  }

  /** Part 13.1 verification job: recompute the chain (in SQL, same formula as the trigger) and find the first break. */
  async verifyChain(): Promise<{ ok: boolean; brokenAtAuditId?: string; reason?: string }> {
    const manager = currentManager();
    const rows: Array<{ broken_audit_id: string | null; reason: string | null }> =
      await manager.query(`SELECT * FROM verify_audit_chain();`);
    if (rows.length === 0 || rows[0].broken_audit_id === null) {
      return { ok: true };
    }
    return { ok: false, brokenAtAuditId: rows[0].broken_audit_id, reason: rows[0].reason ?? undefined };
  }
}
