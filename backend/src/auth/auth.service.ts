import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import * as argon2 from 'argon2';
import { authenticator } from 'otplib';
import { AppUser } from './entities/app-user.entity';
import { UserRole } from './entities/user-role.entity';
import { Role } from './entities/role.entity';
import { UserLabScope } from './entities/user-lab-scope.entity';
import { Laboratory } from '../tenancy/entities/laboratory.entity';
import { AuditService } from '../audit/audit.service';
import { Db } from '../common/db/db.service';
import { newId } from '../common/util/id.util';
import { AuthenticatedUser } from './auth.types';

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;

@Injectable()
export class AuthService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly db: Db,
  ) {}

  /** Part 9.2: Argon2id passwords, TOTP MFA, short-lived JWT + rotating refresh. */
  async login(username: string, password: string, mfaCode?: string) {
    const manager = this.dataSource.manager;
    const user = await manager.findOne(AppUser, { where: { username } });

    // Audit every login failure/lockout regardless of which check fails (Part 13.1),
    // using an admin-scoped background transaction since there is no caller context yet.
    const fail = async (reason: string) => {
      await this.db.runAsAdmin(async () => {
        await this.audit.record({
          action: 'LOGIN_FAILED',
          entityType: 'app_user',
          entityId: user?.id ?? null,
          reason,
        });
      });
      throw new UnauthorizedException('Invalid credentials');
    };

    if (!user || user.status !== 'ACTIVE' || !user.passwordHash) {
      return fail('unknown user or inactive');
    }
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      return fail('account locked');
    }

    const passwordOk = await argon2.verify(user.passwordHash, password);
    if (!passwordOk) {
      const failedCount = user.failedLoginCount + 1;
      const lockedUntil =
        failedCount >= MAX_FAILED_LOGINS
          ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000)
          : null;
      await manager.update(
        AppUser,
        { id: user.id },
        {
          failedLoginCount: failedCount,
          lockedUntil,
        },
      );
      return fail(lockedUntil ? 'bad password, now locked' : 'bad password');
    }

    if (user.mfaEnabled) {
      if (!mfaCode || !authenticator.check(mfaCode, user.mfaSecret ?? '')) {
        return fail('bad or missing MFA code');
      }
    }

    await manager.update(
      AppUser,
      { id: user.id },
      {
        failedLoginCount: 0,
        lockedUntil: null,
      },
    );

    await this.db.runAsAdmin(async () => {
      await this.audit.record({
        userId: user.id,
        action: 'LOGIN_SUCCEEDED',
        entityType: 'app_user',
        entityId: user.id,
      });
    });

    return this.issueTokens(user.id);
  }

  async refresh(refreshToken: string) {
    let payload: { sub: string };
    try {
      payload = await this.jwt.verifyAsync(refreshToken, {
        secret: this.config.get<string>('auth.refreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const user = await this.dataSource.manager.findOne(AppUser, {
      where: { id: payload.sub },
    });
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Invalid refresh token');
    }
    return this.issueTokens(user.id);
  }

  private async issueTokens(userId: string) {
    const accessToken = await this.jwt.signAsync(
      { sub: userId },
      {
        secret: this.config.get<string>('auth.accessSecret'),
        expiresIn: this.config.get<string>('auth.accessTtl'),
      },
    );
    const refreshToken = await this.jwt.signAsync(
      { sub: userId },
      {
        secret: this.config.get<string>('auth.refreshSecret'),
        expiresIn: this.config.get<string>('auth.refreshTtl'),
      },
    );
    return { accessToken, refreshToken };
  }

  /** Generates a TOTP secret + enrolment URI; the user confirms with a code to flip mfaEnabled on. */
  async beginMfaEnrolment(userId: string) {
    const secret = authenticator.generateSecret();
    await this.dataSource.manager.update(
      AppUser,
      { id: userId },
      { mfaSecret: secret },
    );
    const user = await this.dataSource.manager.findOneOrFail(AppUser, {
      where: { id: userId },
    });
    const uri = authenticator.keyuri(
      user.username,
      this.config.get<string>('auth.mfaIssuer') ?? 'RMP',
      secret,
    );
    return { secret, uri };
  }

  async confirmMfaEnrolment(userId: string, code: string) {
    const user = await this.dataSource.manager.findOneOrFail(AppUser, {
      where: { id: userId },
    });
    if (!user.mfaSecret || !authenticator.check(code, user.mfaSecret)) {
      throw new BadRequestException('Invalid MFA code');
    }
    await this.dataSource.manager.update(
      AppUser,
      { id: userId },
      { mfaEnabled: true },
    );
  }

  static async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  // Not in the original spec -- added for the frontend, since nothing else exposes a
  // user picker (process analyst assignment, handover "to user", etc.) over REST.
  // Also carries each user's home lab + (for analysts) who they report to, so the
  // Users table and the Create User form's "Reports to" picker don't need extra
  // round-trips (Task 1 of the lab-hierarchy work).
  async listUsers() {
    const manager = this.dataSource.manager;
    const users = await manager.find(AppUser, { where: { status: 'ACTIVE' } });
    const userRoles = await manager.find(UserRole);
    const roleIds = [...new Set(userRoles.map((r) => r.roleId))];
    const roles = roleIds.length
      ? await manager
          .getRepository(Role)
          .createQueryBuilder('r')
          .where('r.id IN (:...ids)', { ids: roleIds })
          .getMany()
      : [];
    const roleById = new Map(roles.map((r) => [r.id, r.code]));
    const rolesByUser = new Map<string, string[]>();
    for (const ur of userRoles) {
      const list = rolesByUser.get(ur.userId) ?? [];
      const code = roleById.get(ur.roleId);
      if (code) list.push(code);
      rolesByUser.set(ur.userId, list);
    }

    const scopeRows = await manager.find(UserLabScope);
    const labIdByUser = new Map(
      scopeRows.map((s) => [s.userId, s.laboratoryId]),
    );
    const labIds = [...new Set(scopeRows.map((s) => s.laboratoryId))];
    // `laboratory` carries an RLS policy (unlike app_user/role/user_lab_scope),
    // so this lookup must run inside an admin-scoped context or Postgres
    // silently returns zero rows (not an error) -- found 2026-11-11 when
    // laboratoryName kept coming back null despite a correct laboratoryId.
    const labs = labIds.length
      ? await this.db.runAsAdmin((m) =>
          m
            .getRepository(Laboratory)
            .createQueryBuilder('l')
            .where('l.id IN (:...ids)', { ids: labIds })
            .getMany(),
        )
      : [];
    const labNameById = new Map(labs.map((l) => [l.id, l.name]));
    const nameByUserId = new Map(users.map((u) => [u.id, u.name]));

    return users.map((u) => {
      const laboratoryId = labIdByUser.get(u.id) ?? null;
      return {
        id: u.id,
        name: u.name,
        username: u.username,
        roles: rolesByUser.get(u.id) ?? [],
        laboratoryId,
        laboratoryName: laboratoryId
          ? (labNameById.get(laboratoryId) ?? null)
          : null,
        reportsToUserId: u.reportsToUserId,
        reportsToName: u.reportsToUserId
          ? (nameByUserId.get(u.reportsToUserId) ?? null)
          : null,
      };
    });
  }

  /**
   * Creates a new app user + role assignment(s). `app_user`/`role`/
   * `user_role` carry no RLS policy (Admin-managed globally -- see
   * JwtStrategy), so this writes via the global DataSource like the rest of
   * this service, not `currentManager()`.
   *
   * Privilege-escalation guard: only a caller who already holds
   * `BOROSIL_ADMIN` may grant the `BOROSIL_ADMIN` role to a new user --
   * otherwise a client Admin could mint their own Borosil-level account.
   *
   * Lab hierarchy (Task 1): LAB_INCHARGE and ANALYST both require
   * `laboratoryId` (their single home lab -- see UserLabScope's updated
   * doc comment). ANALYST additionally requires `reportsToUserId`, which
   * must be an existing LAB_INCHARGE scoped to that *same* lab -- this is
   * the "admin assigns an analyst to their lab in-charge" step you
   * described. Other roles (ADMIN/BOROSIL_ADMIN/AUDITOR/SUPPORT) are global
   * and never get a lab row.
   */
  async createUser(
    caller: AuthenticatedUser,
    input: {
      name: string;
      username: string;
      password: string;
      roles: string[];
      laboratoryId?: string;
      reportsToUserId?: string;
    },
  ) {
    if (
      input.roles.includes('BOROSIL_ADMIN') &&
      !caller.roles.includes('BOROSIL_ADMIN')
    ) {
      throw new ForbiddenException(
        'Only a Borosil Admin may grant the Borosil Admin role',
      );
    }
    const manager = this.dataSource.manager;
    const existing = await manager.findOne(AppUser, {
      where: { username: input.username },
    });
    if (existing) {
      throw new ConflictException(
        `Username "${input.username}" is already taken`,
      );
    }
    const roleRows = await manager
      .getRepository(Role)
      .createQueryBuilder('r')
      .where('r.code IN (:...codes)', { codes: input.roles })
      .getMany();
    if (roleRows.length !== input.roles.length) {
      throw new BadRequestException(
        'One or more role codes are not recognised',
      );
    }

    const needsLab =
      input.roles.includes('LAB_INCHARGE') || input.roles.includes('ANALYST');
    const needsReportsTo = input.roles.includes('ANALYST');
    if (needsLab && !input.laboratoryId) {
      throw new BadRequestException(
        'laboratoryId is required for LAB_INCHARGE and ANALYST users',
      );
    }
    if (input.laboratoryId) {
      // Same RLS caveat as listUsers() above -- laboratory has a policy, the
      // rest of this service's tables don't.
      const lab = await this.db.runAsAdmin((m) =>
        m.findOne(Laboratory, { where: { id: input.laboratoryId } }),
      );
      if (!lab) {
        throw new BadRequestException(
          'laboratoryId does not refer to an existing laboratory',
        );
      }
    }
    if (needsReportsTo) {
      if (!input.reportsToUserId) {
        throw new BadRequestException(
          'reportsToUserId is required for ANALYST users',
        );
      }
      await this.assertIsLabIncharge(
        input.reportsToUserId,
        input.laboratoryId!,
      );
    }

    const user = manager.create(AppUser, {
      id: newId(),
      name: input.name,
      username: input.username,
      passwordHash: await AuthService.hashPassword(input.password),
      status: 'ACTIVE',
      createdBy: caller.userId,
      reportsToUserId: needsReportsTo ? input.reportsToUserId! : null,
    });
    await manager.save(user);
    await manager.save(
      roleRows.map((r) =>
        manager.create(UserRole, { userId: user.id, roleId: r.id }),
      ),
    );
    if (input.laboratoryId) {
      await manager.save(
        manager.create(UserLabScope, {
          id: newId(),
          userId: user.id,
          laboratoryId: input.laboratoryId,
          grantedBy: caller.userId,
        }),
      );
    }

    await this.db.runAsAdmin(async () => {
      await this.audit.record({
        userId: caller.userId,
        action: 'USER_CREATED',
        entityType: 'app_user',
        entityId: user.id,
        newValue: {
          name: user.name,
          username: user.username,
          roles: input.roles,
          laboratoryId: input.laboratoryId ?? null,
          reportsToUserId: user.reportsToUserId,
        },
      });
    });

    return {
      id: user.id,
      name: user.name,
      username: user.username,
      roles: input.roles,
      laboratoryId: input.laboratoryId ?? null,
      reportsToUserId: user.reportsToUserId,
    };
  }

  /** Throws unless `userId` holds LAB_INCHARGE and is home-scoped to `laboratoryId`. */
  private async assertIsLabIncharge(userId: string, laboratoryId: string) {
    const manager = this.dataSource.manager;
    const roleRows = await manager.find(UserRole, { where: { userId } });
    const roleCodes = roleRows.length
      ? (
          await manager
            .getRepository(Role)
            .createQueryBuilder('r')
            .where('r.id IN (:...ids)', { ids: roleRows.map((r) => r.roleId) })
            .getMany()
        ).map((r) => r.code)
      : [];
    if (!roleCodes.includes('LAB_INCHARGE')) {
      throw new BadRequestException(
        'reportsToUserId must be a user with the LAB_INCHARGE role',
      );
    }
    const scope = await manager.findOne(UserLabScope, { where: { userId } });
    if (!scope || scope.laboratoryId !== laboratoryId) {
      throw new BadRequestException(
        'reportsToUserId must be a Lab In-charge scoped to the same laboratoryId',
      );
    }
  }

  /**
   * Admin-only: reassigns a user's home lab (and, for analysts, who they
   * report to). Covers the "transfer this Lab In-charge/Analyst to another
   * lab" workflow -- replaces their single `UserLabScope` row rather than
   * adding another, since a user has exactly one home lab (see that
   * entity's doc comment).
   */
  async reassignLab(
    targetUserId: string,
    laboratoryId: string,
    reportsToUserId?: string,
  ) {
    const manager = this.dataSource.manager;
    const user = await manager.findOne(AppUser, {
      where: { id: targetUserId },
    });
    if (!user) {
      throw new BadRequestException('User not found');
    }
    const lab = await this.db.runAsAdmin((m) =>
      m.findOne(Laboratory, { where: { id: laboratoryId } }),
    );
    if (!lab) {
      throw new BadRequestException(
        'laboratoryId does not refer to an existing laboratory',
      );
    }

    const roleRows = await manager.find(UserRole, {
      where: { userId: targetUserId },
    });
    const roleCodes = roleRows.length
      ? (
          await manager
            .getRepository(Role)
            .createQueryBuilder('r')
            .where('r.id IN (:...ids)', { ids: roleRows.map((r) => r.roleId) })
            .getMany()
        ).map((r) => r.code)
      : [];
    if (roleCodes.includes('ANALYST')) {
      if (!reportsToUserId) {
        throw new BadRequestException(
          'reportsToUserId is required when reassigning an ANALYST',
        );
      }
      await this.assertIsLabIncharge(reportsToUserId, laboratoryId);
    }

    const existingScope = await manager.findOne(UserLabScope, {
      where: { userId: targetUserId },
    });
    if (existingScope) {
      await manager.update(
        UserLabScope,
        { userId: targetUserId },
        { laboratoryId },
      );
    } else {
      await manager.save(
        manager.create(UserLabScope, {
          id: newId(),
          userId: targetUserId,
          laboratoryId,
          grantedBy: targetUserId,
        }),
      );
    }
    await manager.update(
      AppUser,
      { id: targetUserId },
      {
        reportsToUserId: roleCodes.includes('ANALYST')
          ? reportsToUserId!
          : user.reportsToUserId,
      },
    );

    return { ok: true };
  }

  /**
   * Resets a user's password (support action -- e.g. a client Admin locked
   * out of their own account). Also clears failed-login/lockout state so a
   * locked account is usable again immediately.
   *
   * Guard: a target holding `BOROSIL_ADMIN` can only have their password
   * reset by another `BOROSIL_ADMIN` caller -- a client Admin can reset
   * passwords for their own users, but never for Borosil's own account.
   */
  async resetPassword(
    caller: AuthenticatedUser,
    targetUserId: string,
    newPassword: string,
  ) {
    const manager = this.dataSource.manager;
    const target = await manager.findOne(AppUser, {
      where: { id: targetUserId },
    });
    if (!target) {
      throw new BadRequestException('User not found');
    }
    const targetRoleRows = await manager.find(UserRole, {
      where: { userId: targetUserId },
    });
    const targetRoleCodes = targetRoleRows.length
      ? (
          await manager
            .getRepository(Role)
            .createQueryBuilder('r')
            .where('r.id IN (:...ids)', {
              ids: targetRoleRows.map((r) => r.roleId),
            })
            .getMany()
        ).map((r) => r.code)
      : [];
    if (
      targetRoleCodes.includes('BOROSIL_ADMIN') &&
      !caller.roles.includes('BOROSIL_ADMIN')
    ) {
      throw new ForbiddenException(
        "Only a Borosil Admin may reset a Borosil Admin account's password",
      );
    }

    await manager.update(
      AppUser,
      { id: targetUserId },
      {
        passwordHash: await AuthService.hashPassword(newPassword),
        failedLoginCount: 0,
        lockedUntil: null,
      },
    );

    await this.db.runAsAdmin(async () => {
      await this.audit.record({
        userId: caller.userId,
        action: 'PASSWORD_RESET',
        entityType: 'app_user',
        entityId: targetUserId,
      });
    });

    return { ok: true };
  }
}
