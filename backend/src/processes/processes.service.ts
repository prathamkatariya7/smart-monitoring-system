import {
  ConflictException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { IsNull } from 'typeorm';
import { currentManager } from '../common/db/request-context';
import { newId } from '../common/util/id.util';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { Process } from './entities/process.entity';
import { ProcessAttempt } from './entities/process-attempt.entity';
import { ProcessAssignment } from './entities/process-assignment.entity';
import { OwnershipHistory } from './entities/ownership-history.entity';
import { Handover } from './entities/handover.entity';
import { ThresholdVersion } from './entities/threshold-version.entity';
import { ProcessEvent } from './entities/process-event.entity';
import { AppUser } from '../auth/entities/app-user.entity';
import { Equipment } from '../equipment/entities/equipment.entity';
import { DeviceBinding } from '../devices/entities/device-binding.entity';
import { CfgDesiredService } from '../mqtt/cfg-desired.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateProcessDto } from './dto/create-process.dto';

/**
 * Part 5: process lifecycle state machine (T1-T14). Every state-changing
 * method here is one row in Part 5.2's table; comments reference the
 * transition id so the mapping back to the spec stays obvious.
 */
@Injectable()
export class ProcessesService {
  constructor(
    private readonly audit: AuditService,
    @Inject(forwardRef(() => CfgDesiredService))
    private readonly cfgDesired: CfgDesiredService,
    private readonly notifications: NotificationsService,
  ) {}

  private async pushToBoundDevice(equipmentId: string): Promise<void> {
    try {
      const binding = await currentManager().findOne(DeviceBinding, {
        where: { equipmentId, boundTo: IsNull() },
      });
      if (binding) {
        await this.cfgDesired.pushToDevice(binding.deviceId);
      }
    } catch {
      // Non-fatal if device push fails
    }
  }

  async list(): Promise<any[]> {
    const manager = currentManager();
    const processes = await manager.find(Process, { order: { plannedStartUtc: 'DESC' } });
    const processIds = processes.map((p) => p.id);
    if (processIds.length === 0) return [];

    const assignments = await manager
      .getRepository(ProcessAssignment)
      .createQueryBuilder('pa')
      .leftJoin(AppUser, 'u', 'u.id = pa.user_id')
      .where('pa.process_id IN (:...processIds)', { processIds })
      .select([
        'pa.process_id AS "processId"',
        'pa.user_id AS "userId"',
        'pa.role AS "role"',
        'pa.status AS "status"',
        'u.name AS "userName"',
      ])
      .getRawMany();

    const assignmentsByProcess = new Map<string, Array<{ userId: string; role: string; status: string; userName: string }>>();
    for (const a of assignments) {
      const list = assignmentsByProcess.get(a.processId) ?? [];
      list.push({ userId: a.userId, role: a.role, status: a.status, userName: a.userName });
      assignmentsByProcess.set(a.processId, list);
    }

    return processes.map((p) => {
      const assigns = assignmentsByProcess.get(p.id) ?? [];
      const owner = assigns.find((a) => a.role === 'OWNER') ?? assigns[0];
      return {
        ...p,
        ownerAnalystName: owner?.userName ?? null,
        ownerStatus: owner?.status ?? null,
        assignments: assigns,
      };
    });
  }

  async get(id: string): Promise<Process> {
    const process = await currentManager().findOne(Process, { where: { id } });
    if (!process) throw new NotFoundException('Process not found');
    return process;
  }

  async getAttempts(processId: string): Promise<ProcessAttempt[]> {
    await this.get(processId);
    return currentManager().find(ProcessAttempt, { where: { processId }, order: { attemptNo: 'ASC' } });
  }

  async getCurrentAttempt(processId: string): Promise<ProcessAttempt> {
    const attempts = await this.getAttempts(processId);
    const current = attempts[attempts.length - 1];
    if (!current) throw new NotFoundException('Process has no attempts yet');
    return current;
  }

  async getAssignments(processId: string): Promise<ProcessAssignment[]> {
    await this.get(processId);
    return currentManager().find(ProcessAssignment, { where: { processId } });
  }

  private async logEvent(
    attemptId: string,
    type: string,
    actorUserId: string | null,
    detail: Record<string, unknown> = {},
  ): Promise<void> {
    await currentManager().save(ProcessEvent, {
      id: newId(),
      attemptId,
      ts: new Date(),
      type,
      actorUserId,
      actorDeviceId: null,
      detailJson: detail,
    });
  }

  // ---- T1: (new) -> SCHEDULED ----
  async create(actor: AuthenticatedUser, dto: CreateProcessDto): Promise<Process> {
    const manager = currentManager();
    const equipment = await manager.findOne(Equipment, { where: { id: dto.equipmentId } });
    if (!equipment) throw new NotFoundException('Reactor not found');
    if (equipment.maintenanceMode) {
      throw new ConflictException('Reactor is in maintenance mode and cannot be scheduled');
    }

    const plannedStart = new Date(dto.plannedStartUtc);
    const plannedEnd = new Date(plannedStart.getTime() + dto.plannedDurationS * 1000);

    const process = manager.create(Process, {
      id: newId(),
      equipmentId: dto.equipmentId,
      laboratoryId: equipment.laboratoryId,
      name: dto.name,
      description: dto.description ?? null,
      plannedStartUtc: plannedStart,
      plannedDurationS: dto.plannedDurationS,
      durationUnitDisplay: dto.durationUnitDisplay ?? 'hours',
      plannedEndUtc: plannedEnd,
      status: 'SCHEDULED',
      quickRun: false,
      createdBy: actor.userId,
      remarks: dto.remarks ?? null,
    });

    try {
      await manager.save(process);
    } catch (err: any) {
      if (err.code === '23P01') {
        // GiST exclusion constraint violation (Part 5.3: overlapping processes rejected at creation)
        throw new ConflictException(
          'This reactor already has a scheduled/running process overlapping this time range',
        );
      }
      throw err;
    }

    // Threshold version 1, APPROVED (Part 6.2: "the In-charge sets version 1 at creation (APPROVED)")
    await manager.save(ThresholdVersion, {
      id: newId(),
      processId: process.id,
      versionNo: 1,
      status: 'APPROVED',
      paramsJson: dto.thresholds ?? {},
      proposedBy: actor.userId,
      approvedBy: actor.userId,
      reason: 'Initial threshold set at process creation',
    });

    for (const [i, userId] of dto.analystUserIds.entries()) {
      await manager.save(ProcessAssignment, {
        id: newId(),
        processId: process.id,
        userId,
        role: i === 0 ? 'OWNER' : 'PLANNED_OPERATOR',
        status: 'PENDING',
      });
    }

    await this.audit.record({
      userId: actor.userId,
      action: 'PROCESS_CREATED',
      entityType: 'process',
      entityId: process.id,
      equipmentId: dto.equipmentId,
      processId: process.id,
      newValue: { name: dto.name, plannedStart, plannedEnd, analystUserIds: dto.analystUserIds },
    });

    await this.pushToBoundDevice(dto.equipmentId);

    return process;
  }

  // ---- T2: SCHEDULED edit ----
  async reschedule(
    actor: AuthenticatedUser,
    id: string,
    patch: { plannedStartUtc?: string; plannedDurationS?: number; equipmentId?: string },
    reason: string,
  ): Promise<Process> {
    const manager = currentManager();
    const process = await this.get(id);
    if (process.status !== 'SCHEDULED') {
      throw new ConflictException('Only a SCHEDULED process can be rescheduled');
    }

    const plannedStart = patch.plannedStartUtc ? new Date(patch.plannedStartUtc) : process.plannedStartUtc;
    const durationS = patch.plannedDurationS ?? process.plannedDurationS;
    const plannedEnd = new Date(plannedStart.getTime() + durationS * 1000);

    const previous = {
      plannedStartUtc: process.plannedStartUtc,
      plannedDurationS: process.plannedDurationS,
      equipmentId: process.equipmentId,
    };

    try {
      await manager.update(Process, { id }, {
        plannedStartUtc: plannedStart,
        plannedDurationS: durationS,
        plannedEndUtc: plannedEnd,
        equipmentId: patch.equipmentId ?? process.equipmentId,
      });
    } catch (err: any) {
      if (err.code === '23P01') {
        throw new ConflictException('New schedule overlaps another process on this reactor');
      }
      throw err;
    }

    await this.audit.record({
      userId: actor.userId,
      action: 'PROCESS_RESCHEDULED',
      entityType: 'process',
      entityId: id,
      processId: id,
      previousValue: previous,
      newValue: { plannedStartUtc: plannedStart, plannedDurationS: durationS, equipmentId: patch.equipmentId },
      reason,
    });
    await this.pushToBoundDevice(process.equipmentId);
    if (patch.equipmentId && patch.equipmentId !== process.equipmentId) {
      await this.pushToBoundDevice(patch.equipmentId);
    }
    return this.get(id);
  }

  // ---- T3: SCHEDULED -> ACCEPTED (assignment accepted) ----
  async acceptAssignment(actor: AuthenticatedUser, processId: string, onBehalfOfUserId?: string): Promise<Process> {
    const manager = currentManager();
    const process = await this.get(processId);
    if (process.status !== 'SCHEDULED') {
      throw new ConflictException('Process is not awaiting acceptance');
    }
    const targetUserId = onBehalfOfUserId ?? actor.userId;
    const assignment = await manager.findOne(ProcessAssignment, {
      where: { processId, userId: targetUserId, role: 'OWNER' },
    });
    if (!assignment) throw new NotFoundException('No OWNER assignment for this user on this process');

    await manager.update(ProcessAssignment, { id: assignment.id }, {
      status: 'ACCEPTED',
      respondedAt: new Date(),
    });
    await manager.update(Process, { id: processId }, { status: 'ACCEPTED' });

    await this.audit.record({
      userId: actor.userId,
      action: 'ASSIGNMENT_ACCEPTED',
      entityType: 'process',
      entityId: processId,
      processId,
      reason: onBehalfOfUserId ? 'Accepted on behalf by In-charge/Admin' : undefined,
    });
    await this.pushToBoundDevice(process.equipmentId);
    return this.get(processId);
  }

  // ---- T4: assignment rejected ----
  async rejectAssignment(actor: AuthenticatedUser, processId: string, reason: string): Promise<Process> {
    const manager = currentManager();
    const process = await this.get(processId);
    if (process.status !== 'SCHEDULED') {
      throw new ConflictException('Process is not awaiting acceptance');
    }
    const assignment = await manager.findOne(ProcessAssignment, {
      where: { processId, userId: actor.userId, role: 'OWNER' },
    });
    if (!assignment) throw new NotFoundException('No OWNER assignment for this user on this process');

    await manager.update(ProcessAssignment, { id: assignment.id }, {
      status: 'REJECTED',
      respondedAt: new Date(),
      rejectReason: reason,
    });
    // process remains SCHEDULED with no owner (Part 5.3) -- status unchanged

    await this.audit.record({
      userId: actor.userId,
      action: 'ASSIGNMENT_REJECTED',
      entityType: 'process',
      entityId: processId,
      processId,
      reason,
    });
    await this.notifications.notifyLabIncharges(
      process.laboratoryId,
      'ASSIGNMENT_REJECTED',
      'HIGH',
      {
        equipmentId: process.equipmentId,
        processId: process.id,
        processName: process.name,
        actor: actor.username,
        reason,
        title: `ALERT: ${actor.username} REJECTED assignment for "${process.name}"`,
      },
      'process',
      process.id,
    );
    this.notifications.broadcast('process_updated', { processId: process.id, status: 'SCHEDULED' });
    await this.pushToBoundDevice(process.equipmentId);
    return this.get(processId);
  }

  // ---- T5: ACCEPTED -> RUNNING (Start Process) ----
  async start(actor: AuthenticatedUser, processId: string, startedOffline = false): Promise<ProcessAttempt> {
    const manager = currentManager();
    const process = await this.get(processId);
    if (process.status !== 'ACCEPTED') {
      throw new ConflictException('Process must be ACCEPTED before it can start');
    }
    const owner = await manager.findOne(ProcessAssignment, {
      where: { processId, role: 'OWNER', status: 'ACCEPTED' },
    });
    if (!owner) throw new ConflictException('No accepted owner for this process');

    const now = new Date();
    const attempt = manager.create(ProcessAttempt, {
      id: newId(),
      processId,
      attemptNo: 1,
      previousAttemptId: null,
      startTs: now,
      endTs: null,
      plannedEndTs: new Date(now.getTime() + process.plannedDurationS * 1000),
      activeElapsedS: 0,
      status: 'RUNNING',
    });
    await manager.save(attempt);
    await manager.update(Process, { id: processId }, { status: 'RUNNING' });
    await manager.save(OwnershipHistory, {
      id: newId(),
      attemptId: attempt.id,
      ownerUserId: owner.userId,
      fromTs: now,
      toTs: null,
      reason: 'Process started',
    });

    await this.logEvent(attempt.id, 'ATTEMPT_STARTED', actor.userId, { startedOffline });
    await this.audit.record({
      userId: actor.userId,
      action: 'ATTEMPT_STARTED',
      entityType: 'process_attempt',
      entityId: attempt.id,
      processId,
      newValue: { startedOffline },
    });
    await this.pushToBoundDevice(process.equipmentId);
    return attempt;
  }

  // ---- T6: RUNNING -> PAUSED ----
  async pause(actor: AuthenticatedUser, processId: string, reason: string): Promise<ProcessAttempt> {
    const manager = currentManager();
    const process = await this.get(processId);
    if (process.status !== 'RUNNING') throw new ConflictException('Process is not RUNNING');
    const attempt = await this.getCurrentAttempt(processId);

    await manager.update(ProcessAttempt, { id: attempt.id }, { status: 'PAUSED' });
    await manager.update(Process, { id: processId }, { status: 'PAUSED' });
    await this.logEvent(attempt.id, 'PROCESS_PAUSED', actor.userId, { reason });

    await this.audit.record({
      userId: actor.userId,
      action: 'PROCESS_PAUSED',
      entityType: 'process',
      entityId: processId,
      processId,
      reason,
    });
    await this.pushToBoundDevice(process.equipmentId);
    return this.getCurrentAttempt(processId);
  }

  // ---- T7: PAUSED -> RUNNING ----
  async resume(actor: AuthenticatedUser, processId: string): Promise<ProcessAttempt> {
    const manager = currentManager();
    const process = await this.get(processId);
    if (process.status !== 'PAUSED') throw new ConflictException('Process is not PAUSED');
    const attempt = await this.getCurrentAttempt(processId);

    await manager.update(ProcessAttempt, { id: attempt.id }, { status: 'RUNNING' });
    await manager.update(Process, { id: processId }, { status: 'RUNNING' });
    await this.logEvent(attempt.id, 'PROCESS_RESUMED', actor.userId);

    await this.audit.record({
      userId: actor.userId,
      action: 'PROCESS_RESUMED',
      entityType: 'process',
      entityId: processId,
      processId,
    });
    await this.pushToBoundDevice(process.equipmentId);
    return this.getCurrentAttempt(processId);
  }

  // ---- T8: RUNNING/PAUSED -> AWAITING_COMPLETION (system, at planned end; also callable directly) ----
  async markAwaitingCompletion(processId: string): Promise<void> {
    const manager = currentManager();
    const process = await this.get(processId);
    if (process.status !== 'RUNNING' && process.status !== 'PAUSED') return;
    const attempt = await this.getCurrentAttempt(processId);

    await manager.update(ProcessAttempt, { id: attempt.id }, { status: 'AWAITING_COMPLETION' });
    await manager.update(Process, { id: processId }, { status: 'AWAITING_COMPLETION' });
    await this.logEvent(attempt.id, 'PLANNED_END_REACHED', null);

    await this.audit.record({
      action: 'PLANNED_END_REACHED',
      entityType: 'process',
      entityId: processId,
      processId,
    });
    await this.pushToBoundDevice(process.equipmentId);
  }

  // ---- T9: AWAITING_COMPLETION -> COMPLETED (Submit) ----
  async complete(actor: AuthenticatedUser, processId: string, onBehalf = false): Promise<ProcessAttempt> {
    const manager = currentManager();
    const process = await this.get(processId);
    if (process.status !== 'AWAITING_COMPLETION') {
      throw new ConflictException('Process is not awaiting completion');
    }
    const attempt = await this.getCurrentAttempt(processId);
    const now = new Date();

    await manager.update(ProcessAttempt, { id: attempt.id }, { status: 'COMPLETED', endTs: now });
    await manager.update(Process, { id: processId }, { status: 'COMPLETED' });
    await manager.update(OwnershipHistory, { attemptId: attempt.id, toTs: null as any }, { toTs: now });
    await this.logEvent(attempt.id, 'PROCESS_COMPLETED', actor.userId, { onBehalf });

    await this.audit.record({
      userId: actor.userId,
      action: 'PROCESS_COMPLETED',
      entityType: 'process',
      entityId: processId,
      processId,
      reason: onBehalf ? 'Completed on behalf by In-charge/Admin' : undefined,
    });
    await this.pushToBoundDevice(process.equipmentId);
    return this.getCurrentAttempt(processId);
  }

  // ---- T10: AWAITING_COMPLETION -> RUNNING (extend) ----
  async extend(actor: AuthenticatedUser, processId: string, newPlannedDurationS: number, reason: string): Promise<ProcessAttempt> {
    const manager = currentManager();
    const process = await this.get(processId);
    if (process.status !== 'AWAITING_COMPLETION') {
      throw new ConflictException('Process is not awaiting completion');
    }
    const attempt = await this.getCurrentAttempt(processId);
    const newPlannedEnd = new Date((attempt.startTs?.getTime() ?? Date.now()) + newPlannedDurationS * 1000);

    await manager.update(ProcessAttempt, { id: attempt.id }, {
      status: 'RUNNING',
      plannedEndTs: newPlannedEnd,
    });
    await manager.update(Process, { id: processId }, {
      status: 'RUNNING',
      plannedDurationS: newPlannedDurationS,
      plannedEndUtc: newPlannedEnd,
    });
    await this.logEvent(attempt.id, 'PROCESS_EXTENDED', actor.userId, { newPlannedDurationS, reason });

    await this.audit.record({
      userId: actor.userId,
      action: 'PROCESS_EXTENDED',
      entityType: 'process',
      entityId: processId,
      processId,
      newValue: { newPlannedDurationS },
      reason,
    });
    await this.pushToBoundDevice(process.equipmentId);
    return this.getCurrentAttempt(processId);
  }

  // ---- T11: SCHEDULED/ACCEPTED -> CANCELLED ----
  async cancel(actor: AuthenticatedUser, processId: string, reason: string): Promise<Process> {
    const manager = currentManager();
    const process = await this.get(processId);
    if (process.status !== 'SCHEDULED' && process.status !== 'ACCEPTED') {
      throw new ConflictException('Only a SCHEDULED or ACCEPTED process can be cancelled');
    }
    await manager.update(Process, { id: processId }, { status: 'CANCELLED' });

    await this.audit.record({
      userId: actor.userId,
      action: 'PROCESS_CANCELLED',
      entityType: 'process',
      entityId: processId,
      processId,
      reason,
    });
    await this.notifications.notifyLabIncharges(
      process.laboratoryId,
      'PROCESS_CANCELLED',
      'HIGH',
      {
        equipmentId: process.equipmentId,
        processId: process.id,
        processName: process.name,
        actor: actor.username,
        reason,
        title: `ALERT: Process "${process.name}" was CANCELLED by ${actor.username}`,
      },
      'process',
      process.id,
    );
    this.notifications.broadcast('process_updated', { processId: process.id, status: 'CANCELLED' });
    await this.pushToBoundDevice(process.equipmentId);
    return this.get(processId);
  }

  // ---- T12: RUNNING/PAUSED -> ABORTED ----
  async abort(actor: AuthenticatedUser, processId: string, reason: string): Promise<ProcessAttempt> {
    const manager = currentManager();
    const process = await this.get(processId);
    if (process.status !== 'RUNNING' && process.status !== 'PAUSED' && process.status !== 'AWAITING_COMPLETION') {
      throw new ConflictException('Process is not in a state that can be aborted');
    }
    const attempt = await this.getCurrentAttempt(processId);
    const now = new Date();

    await manager.update(ProcessAttempt, { id: attempt.id }, {
      status: 'ABORTED',
      endTs: now,
      endReason: reason,
    });
    await manager.update(Process, { id: processId }, { status: 'ABORTED' });
    await manager.update(OwnershipHistory, { attemptId: attempt.id, toTs: null as any }, { toTs: now });
    await this.logEvent(attempt.id, 'PROCESS_ABORTED', actor.userId, { reason });

    await this.audit.record({
      userId: actor.userId,
      action: 'PROCESS_ABORTED',
      entityType: 'process',
      entityId: processId,
      processId,
      reason,
    });
    await this.notifications.notifyLabIncharges(
      process.laboratoryId,
      'PROCESS_ABORTED',
      'HIGH',
      {
        equipmentId: process.equipmentId,
        processId: process.id,
        processName: process.name,
        actor: actor.username,
        reason,
        title: `CRITICAL: Process "${process.name}" was ABORTED by ${actor.username}`,
      },
      'process',
      process.id,
    );
    this.notifications.broadcast('process_updated', { processId: process.id, status: 'ABORTED' });
    await this.pushToBoundDevice(process.equipmentId);
    return this.getCurrentAttempt(processId);
  }

  // ---- T13: ABORTED (or failed COMPLETED) -> new attempt in RUNNING ----
  async restart(actor: AuthenticatedUser, processId: string, reason: string): Promise<ProcessAttempt> {
    const manager = currentManager();
    const process = await this.get(processId);
    if (process.status !== 'ABORTED' && process.status !== 'COMPLETED') {
      throw new ConflictException('Only an ABORTED or COMPLETED process can be restarted');
    }
    const previousAttempt = await this.getCurrentAttempt(processId);
    const owner = await manager.findOne(ProcessAssignment, { where: { processId, role: 'OWNER' } });
    const now = new Date();

    const newAttempt = manager.create(ProcessAttempt, {
      id: newId(),
      processId,
      attemptNo: previousAttempt.attemptNo + 1,
      previousAttemptId: previousAttempt.id,
      startTs: now,
      endTs: null,
      plannedEndTs: new Date(now.getTime() + process.plannedDurationS * 1000),
      activeElapsedS: 0,
      status: 'RUNNING',
    });
    await manager.save(newAttempt);
    await manager.update(Process, { id: processId }, { status: 'RUNNING' });
    if (owner) {
      await manager.save(OwnershipHistory, {
        id: newId(),
        attemptId: newAttempt.id,
        ownerUserId: owner.userId,
        fromTs: now,
        toTs: null,
        reason: 'New attempt started',
      });
    }
    await this.logEvent(newAttempt.id, 'ATTEMPT_RESTARTED', actor.userId, {
      previousAttemptId: previousAttempt.id,
      reason,
    });

    await this.audit.record({
      userId: actor.userId,
      action: 'ATTEMPT_RESTARTED',
      entityType: 'process_attempt',
      entityId: newAttempt.id,
      processId,
      previousValue: { previousAttemptId: previousAttempt.id },
      reason,
    });
    await this.pushToBoundDevice(process.equipmentId);
    return newAttempt;
  }

  // ---- T14: handover ----
  async requestHandover(
    actor: AuthenticatedUser,
    processId: string,
    toUserId: string,
    reason: string,
  ): Promise<Handover> {
    const manager = currentManager();
    const attempt = await this.getCurrentAttempt(processId);
    const currentOwnership = await manager.findOne(OwnershipHistory, {
      where: { attemptId: attempt.id, toTs: null as any },
    });
    if (!currentOwnership) throw new ConflictException('No current owner to hand over from');

    const handover = manager.create(Handover, {
      id: newId(),
      attemptId: attempt.id,
      fromUser: currentOwnership.ownerUserId,
      toUser: toUserId,
      requestedBy: actor.userId,
      requestedAt: new Date(),
      acknowledgedAt: null,
      mode: null,
      reason,
    });
    await manager.save(handover);
    await this.logEvent(attempt.id, 'HANDOVER_REQUESTED', actor.userId, { toUserId, reason });

    await this.audit.record({
      userId: actor.userId,
      action: 'HANDOVER_REQUESTED',
      entityType: 'handover',
      entityId: handover.id,
      processId,
      newValue: { fromUser: currentOwnership.ownerUserId, toUser: toUserId },
      reason,
    });
    return handover;
  }

  private async completeHandover(handover: Handover, mode: 'ACK' | 'OVERRIDE', actor: AuthenticatedUser): Promise<void> {
    const manager = currentManager();
    const now = new Date();
    await manager.update(Handover, { id: handover.id }, { acknowledgedAt: now, mode });

    await manager.update(OwnershipHistory, { attemptId: handover.attemptId, toTs: null as any }, { toTs: now });
    await manager.save(OwnershipHistory, {
      id: newId(),
      attemptId: handover.attemptId,
      ownerUserId: handover.toUser,
      fromTs: now,
      toTs: null,
      reason: handover.reason,
      handoverId: handover.id,
    });

    const attempt = await manager.findOne(ProcessAttempt, { where: { id: handover.attemptId } });
    if (attempt) {
      await manager.update(ProcessAssignment, { processId: attempt.processId, role: 'OWNER' }, {
        userId: handover.toUser,
      });
    }

    await this.logEvent(handover.attemptId, mode === 'ACK' ? 'HANDOVER_ACKNOWLEDGED' : 'HANDOVER_OVERRIDDEN', actor.userId);
  }

  async acknowledgeHandover(actor: AuthenticatedUser, handoverId: string): Promise<Handover> {
    const manager = currentManager();
    const handover = await manager.findOne(Handover, { where: { id: handoverId } });
    if (!handover) throw new NotFoundException('Handover not found');
    if (handover.toUser !== actor.userId) {
      throw new ForbiddenException('Only the incoming analyst may acknowledge their own handover');
    }
    if (handover.acknowledgedAt) throw new ConflictException('Handover already resolved');

    await this.completeHandover(handover, 'ACK', actor);
    await this.audit.record({
      userId: actor.userId,
      action: 'HANDOVER_ACKNOWLEDGED',
      entityType: 'handover',
      entityId: handoverId,
    });
    return manager.findOneOrFail(Handover, { where: { id: handoverId } });
  }

  async overrideHandover(actor: AuthenticatedUser, handoverId: string, reason: string): Promise<Handover> {
    const manager = currentManager();
    const handover = await manager.findOne(Handover, { where: { id: handoverId } });
    if (!handover) throw new NotFoundException('Handover not found');
    if (handover.acknowledgedAt) throw new ConflictException('Handover already resolved');

    await this.completeHandover(handover, 'OVERRIDE', actor);
    await this.audit.record({
      userId: actor.userId,
      action: 'HANDOVER_OVERRIDDEN',
      entityType: 'handover',
      entityId: handoverId,
      reason,
    });
    return manager.findOneOrFail(Handover, { where: { id: handoverId } });
  }

  // ---- Thresholds (Part 6.2 / C-08 tighten-only rule) ----
  async getThresholds(processId: string): Promise<ThresholdVersion[]> {
    await this.get(processId);
    return currentManager().find(ThresholdVersion, { where: { processId }, order: { versionNo: 'ASC' } });
  }

  async setThresholds(
    actor: AuthenticatedUser,
    processId: string,
    params: Record<string, unknown>,
    reason: string,
  ): Promise<ThresholdVersion> {
    const manager = currentManager();
    await this.get(processId);
    const versions = await this.getThresholds(processId);
    const approved = versions.filter((v) => v.status === 'APPROVED').pop();
    if (!approved) throw new ConflictException('No approved threshold version to compare against');

    const tightening = this.isTightenOnly(approved.paramsJson, params);
    const nextVersionNo = Math.max(...versions.map((v) => v.versionNo)) + 1;

    if (tightening) {
      await manager.update(ThresholdVersion, { id: approved.id }, { status: 'SUPERSEDED' });
      const version = manager.create(ThresholdVersion, {
        id: newId(),
        processId,
        versionNo: nextVersionNo,
        status: 'APPROVED',
        paramsJson: params,
        proposedBy: actor.userId,
        approvedBy: actor.userId,
        reason,
      });
      await manager.save(version);
      await this.audit.record({
        userId: actor.userId,
        action: 'THRESHOLD_TIGHTENED',
        entityType: 'threshold_version',
        entityId: version.id,
        processId,
        previousValue: approved.paramsJson,
        newValue: params,
        reason,
      });
      return version;
    }

    // Widening -> PROPOSED, needs In-charge approval (C-08)
    const version = manager.create(ThresholdVersion, {
      id: newId(),
      processId,
      versionNo: nextVersionNo,
      status: 'PROPOSED',
      paramsJson: params,
      proposedBy: actor.userId,
      approvedBy: null,
      reason,
    });
    await manager.save(version);
    await this.audit.record({
      userId: actor.userId,
      action: 'THRESHOLD_WIDEN_PROPOSED',
      entityType: 'threshold_version',
      entityId: version.id,
      processId,
      previousValue: approved.paramsJson,
      newValue: params,
      reason,
    });
    return version;
  }

  async approveThreshold(actor: AuthenticatedUser, versionId: string): Promise<ThresholdVersion> {
    const manager = currentManager();
    const version = await manager.findOne(ThresholdVersion, { where: { id: versionId } });
    if (!version) throw new NotFoundException('Threshold version not found');
    if (version.status !== 'PROPOSED') throw new ConflictException('Only a PROPOSED version can be approved');

    const currentApproved = (await this.getThresholds(version.processId)).find((v) => v.status === 'APPROVED');
    if (currentApproved) {
      await manager.update(ThresholdVersion, { id: currentApproved.id }, { status: 'SUPERSEDED' });
    }
    await manager.update(ThresholdVersion, { id: versionId }, { status: 'APPROVED', approvedBy: actor.userId });

    await this.audit.record({
      userId: actor.userId,
      action: 'THRESHOLD_WIDEN_APPROVED',
      entityType: 'threshold_version',
      entityId: versionId,
      processId: version.processId,
    });
    return manager.findOneOrFail(ThresholdVersion, { where: { id: versionId } });
  }

  async rejectThreshold(actor: AuthenticatedUser, versionId: string, reason: string): Promise<ThresholdVersion> {
    const manager = currentManager();
    const version = await manager.findOne(ThresholdVersion, { where: { id: versionId } });
    if (!version) throw new NotFoundException('Threshold version not found');
    if (version.status !== 'PROPOSED') throw new ConflictException('Only a PROPOSED version can be rejected');

    await manager.update(ThresholdVersion, { id: versionId }, { status: 'REJECTED' });
    await this.audit.record({
      userId: actor.userId,
      action: 'THRESHOLD_WIDEN_REJECTED',
      entityType: 'threshold_version',
      entityId: versionId,
      processId: version.processId,
      reason,
    });
    return manager.findOneOrFail(ThresholdVersion, { where: { id: versionId } });
  }

  /**
   * C-08 tighten-only rule heuristic: keys ending in "min" are floors (raising
   * is tighter); keys ending in "max"/"maxrise"/"maxfall" are ceilings
   * (lowering is tighter). Any key not matching this pattern, or any key
   * present in the new set that didn't exist before, is treated as a
   * widening by default -- Part 1 C-08 says loosening is a safety concern,
   * so an ambiguous change must go through approval rather than be
   * auto-approved by a heuristic that might be wrong.
   */
  private isTightenOnly(oldParams: Record<string, any>, newParams: Record<string, any>): boolean {
    const flatten = (obj: Record<string, any>, prefix = ''): Record<string, number> => {
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(obj ?? {})) {
        const key = prefix ? `${prefix}.${k}` : k;
        if (typeof v === 'number') out[key] = v;
        else if (typeof v === 'object' && v !== null) Object.assign(out, flatten(v, key));
      }
      return out;
    };
    const oldFlat = flatten(oldParams);
    const newFlat = flatten(newParams);

    for (const [key, newVal] of Object.entries(newFlat)) {
      const oldVal = oldFlat[key];
      if (oldVal === undefined) return false; // new key introduced -- cannot classify, require approval
      if (oldVal === newVal) continue;
      const lower = key.toLowerCase();
      if (lower.endsWith('min')) {
        if (newVal < oldVal) return false; // floor lowered = widened
      } else if (lower.endsWith('max') || lower.endsWith('maxrise') || lower.endsWith('maxfall')) {
        if (newVal > oldVal) return false; // ceiling raised = widened
      } else {
        return false; // unrecognized shape -- safer to require approval
      }
    }
    return true;
  }
}
