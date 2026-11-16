import { Injectable, Logger } from '@nestjs/common';
import { In, IsNull, Not, MoreThan } from 'typeorm';
import { currentManager } from '../common/db/request-context';
import { newId } from '../common/util/id.util';
import { Notification } from './entities/notification.entity';
import { RealtimeGateway } from './realtime.gateway';
import { AppUser } from '../auth/entities/app-user.entity';
import { Role } from '../auth/entities/role.entity';
import { UserRole } from '../auth/entities/user-role.entity';
import { UserLabScope } from '../auth/entities/user-lab-scope.entity';
import { AuthenticatedUser } from '../auth/auth.types';

export interface CreateNotificationInput {
  userId: string;
  type: string;
  priority: 'NORMAL' | 'HIGH';
  payload: Record<string, unknown>;
  refEntity?: string;
  refId?: string;
  laboratoryId?: string;
}

/** Part 6.6: in-app notification centre, no e-mail. */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly gateway: RealtimeGateway) {}

  async create(input: CreateNotificationInput): Promise<Notification> {
    const manager = currentManager();

    // Industry Standard Deduplication / Alert Holding Window:
    // If an active (unseen) notification already exists for this incident (refEntity + refId),
    // update the ongoing incident context (duration, occurrence count, latest value)
    // instead of creating redundant duplicate notification rows every second.
    if (input.refEntity && input.refId) {
      const existing = await manager.findOne(Notification, {
        where: {
          userId: input.userId,
          refEntity: input.refEntity,
          refId: input.refId,
          seenAt: IsNull(),
        },
      });
      if (existing) {
        const prevPayload = existing.payloadJson || {};
        const count = ((prevPayload.occurrences as number) || 1) + 1;
        const onsetMs = new Date(existing.createdAt).getTime();
        const durationSec = Math.round((Date.now() - onsetMs) / 1000);
        const durationMin = Math.round(durationSec / 60);

        existing.payloadJson = {
          ...prevPayload,
          ...input.payload,
          occurrences: count,
          durationSec,
          durationMin,
          lastUpdated: new Date().toISOString(),
        };
        existing.priority = input.priority === 'HIGH' ? 'HIGH' : existing.priority;
        await manager.save(existing);
        this.gateway.pushToUser(input.userId, 'notification_update', existing);
        this.gateway.server?.emit('notification_update', existing);
        return existing;
      }
    }

    const row = manager.create(Notification, {
      id: newId(),
      userId: input.userId,
      type: input.type,
      priority: input.priority,
      payloadJson: {
        ...input.payload,
        occurrences: 1,
        durationSec: 0,
        durationMin: 0,
        lastUpdated: new Date().toISOString(),
      },
      refEntity: input.refEntity ?? null,
      refId: input.refId ?? null,
      laboratoryId: input.laboratoryId ?? null,
      createdAt: new Date(),
      deliveredAt: new Date(),
    });
    await manager.save(row);
    this.gateway.pushToUser(input.userId, 'notification', row);
    return row;
  }

  /** Notify every In-charge of a laboratory (falling back to Admin if none), per Part 6.5 "Alert to the Lab In-charge". */
  async notifyLabIncharges(
    laboratoryId: string,
    type: string,
    priority: 'NORMAL' | 'HIGH',
    payload: Record<string, unknown>,
    refEntity?: string,
    refId?: string,
  ): Promise<Notification[]> {
    const manager = currentManager();
    const incharge = await manager.findOne(Role, { where: { code: 'LAB_INCHARGE' } });
    const admin = await manager.findOne(Role, { where: { code: 'ADMIN' } });

    let recipientIds: string[] = [];
    if (incharge) {
      const scopedUserIds = (
        await manager.find(UserLabScope, { where: { laboratoryId } })
      ).map((s) => s.userId);
      if (scopedUserIds.length > 0) {
        const inchargeUserRoles = await manager
          .getRepository(UserRole)
          .createQueryBuilder('ur')
          .where('ur.role_id = :roleId', { roleId: incharge.id })
          .andWhere('ur.user_id IN (:...ids)', { ids: scopedUserIds })
          .getMany();
        recipientIds = inchargeUserRoles.map((r) => r.userId);
      }
    }

    if (recipientIds.length === 0 && admin) {
      const adminRoles = await manager.find(UserRole, { where: { roleId: admin.id } });
      recipientIds = adminRoles.map((r) => r.userId);
    }

    const created: Notification[] = [];
    for (const userId of recipientIds) {
      created.push(
        await this.create({ userId, type, priority, payload, refEntity, refId, laboratoryId }),
      );
    }
    this.gateway.pushToLaboratory(laboratoryId, type, payload);
    this.gateway.server?.emit('notification_broadcast', { type, priority, payload, laboratoryId });
    return created;
  }

  broadcast(event: string, payload: unknown): void {
    this.gateway.server?.emit(event, payload);
  }

  /** Returns only UNSEEN notifications for the active bell/list UI.
   *  Seen notifications are archived in the DB (seenAt IS NOT NULL) but
   *  no longer appear in the live feed — they never get deleted. */
  async listForUser(user: AuthenticatedUser): Promise<Notification[]> {
    if (user.isAdmin) {
      return currentManager().find(Notification, {
        where: { seenAt: IsNull() },
        order: { createdAt: 'DESC' },
        take: 50,
      });
    }
    const labIds = user.laboratoryIds || [];
    return currentManager().find(Notification, {
      where: labIds.length > 0
        ? [{ userId: user.userId, seenAt: IsNull() }, { laboratoryId: In(labIds), seenAt: IsNull() }]
        : { userId: user.userId, seenAt: IsNull() },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }

  /** Returns recent seen notifications for the History tab (last 48 hours or up to 30 items),
   *  preventing UI clutter while keeping complete history in the database audit log. */
  async listAllForUser(user: AuthenticatedUser): Promise<Notification[]> {
    const cutoff = new Date(Date.now() - 48 * 3600 * 1000);
    if (user.isAdmin) {
      return currentManager().find(Notification, {
        where: { seenAt: Not(IsNull()), createdAt: MoreThan(cutoff) },
        order: { createdAt: 'DESC' },
        take: 30,
      });
    }
    const labIds = user.laboratoryIds || [];
    return currentManager().find(Notification, {
      where: labIds.length > 0
        ? [
            { userId: user.userId, seenAt: Not(IsNull()), createdAt: MoreThan(cutoff) },
            { laboratoryId: In(labIds), seenAt: Not(IsNull()), createdAt: MoreThan(cutoff) },
          ]
        : { userId: user.userId, seenAt: Not(IsNull()), createdAt: MoreThan(cutoff) },
      order: { createdAt: 'DESC' },
      take: 30,
    });
  }

  async markSeen(user: AuthenticatedUser, id: string): Promise<void> {
    const manager = currentManager();
    if (user.isAdmin) {
      await manager.update(Notification, { id }, { seenAt: new Date() });
    } else {
      const labIds = user.laboratoryIds || [];
      if (labIds.length > 0) {
        await manager
          .createQueryBuilder()
          .update(Notification)
          .set({ seenAt: new Date() })
          .where('id = :id AND (user_id = :userId OR laboratory_id IN (:...labIds))', {
            id,
            userId: user.userId,
            labIds,
          })
          .execute();
      } else {
        await manager.update(Notification, { id, userId: user.userId }, { seenAt: new Date() });
      }
    }
    this.broadcast('notification_seen', { id });
  }

  async markAllSeen(user: AuthenticatedUser): Promise<void> {
    const manager = currentManager();
    if (user.isAdmin) {
      await manager.update(Notification, { seenAt: IsNull() }, { seenAt: new Date() });
    } else {
      const labIds = user.laboratoryIds || [];
      if (labIds.length > 0) {
        await manager
          .createQueryBuilder()
          .update(Notification)
          .set({ seenAt: new Date() })
          .where('seen_at IS NULL AND (user_id = :userId OR laboratory_id IN (:...labIds))', {
            userId: user.userId,
            labIds,
          })
          .execute();
      } else {
        await manager.update(Notification, { userId: user.userId, seenAt: IsNull() }, { seenAt: new Date() });
      }
    }
    this.broadcast('notification_seen', { all: true });
  }

  /** Part 6.6 escalation: unseen HIGH notifications older than `afterMinutes` escalate to the given Admin user. */
  async escalateUnseen(afterMinutes: number, escalateToUserId: (laboratoryId: string | null) => Promise<string | null>): Promise<number> {
    const manager = currentManager();
    const cutoff = new Date(Date.now() - afterMinutes * 60_000);
    const stale = await manager
      .getRepository(Notification)
      .createQueryBuilder('n')
      .where('n.priority = :p', { p: 'HIGH' })
      .andWhere('n.seen_at IS NULL')
      .andWhere('n.escalated_at IS NULL')
      .andWhere('n.created_at <= :cutoff', { cutoff })
      .getMany();

    let count = 0;
    for (const n of stale) {
      const escalateTo = await escalateToUserId(n.laboratoryId);
      if (!escalateTo) continue;
      await manager.update(Notification, { id: n.id }, { escalatedAt: new Date(), escalatedTo: escalateTo });
      // Keep the original `type` unchanged (no "_ESCALATED" string chaining) -- the
      // escalation relationship is carried in payload.escalatedFrom instead.
      const escalation = await this.create({
        userId: escalateTo,
        type: n.type,
        priority: 'HIGH',
        payload: { ...n.payloadJson, escalatedFrom: n.id },
        refEntity: n.refEntity ?? undefined,
        refId: n.refId ?? undefined,
        laboratoryId: n.laboratoryId ?? undefined,
      });
      // Stamp the newly-created escalation notification as already-escalated so it
      // can never be picked up by a future scan and re-escalate itself recursively.
      await manager.update(Notification, { id: escalation.id }, { escalatedAt: new Date() });
      count++;
    }
    if (count > 0) this.logger.log(`Escalated ${count} unseen high-priority notifications`);
    return count;
  }
}
