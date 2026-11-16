import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AppUser } from './entities/app-user.entity';
import { UserRole } from './entities/user-role.entity';
import { Role } from './entities/role.entity';
import { UserLabScope } from './entities/user-lab-scope.entity';
import { AuthenticatedUser } from './auth.types';

/**
 * Validates the access token and loads the user's roles + lab scopes
 * (Part 4). Runs before RlsInterceptor, so it queries app_user/role/
 * user_lab_scope directly via the global DataSource -- those tables carry no
 * RLS policy (they are Admin-managed globally), so this is safe and avoids a
 * chicken-and-egg problem of needing an RLS context before one is built.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly dataSource: DataSource,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('auth.accessSecret'),
    });
  }

  async validate(payload: { sub: string }): Promise<AuthenticatedUser> {
    const manager = this.dataSource.manager;
    const user = await manager.findOne(AppUser, { where: { id: payload.sub } });
    if (!user || user.status !== 'ACTIVE') {
      throw new Error('User not found or inactive');
    }
    const userRoles = await manager.find(UserRole, { where: { userId: user.id } });
    const roleIds = userRoles.map((r) => r.roleId);
    const roles = roleIds.length
      ? await manager
          .getRepository(Role)
          .createQueryBuilder('r')
          .where('r.id IN (:...ids)', { ids: roleIds })
          .getMany()
      : [];
    const roleCodes = roles.map((r) => r.code);
    const isAdmin = roleCodes.includes('ADMIN');

    const scopes = await manager.find(UserLabScope, { where: { userId: user.id } });
    const laboratoryIds = scopes.map((s) => s.laboratoryId);

    return {
      userId: user.id,
      username: user.username,
      name: user.name,
      roles: roleCodes,
      isAdmin,
      laboratoryIds,
    };
  }
}
