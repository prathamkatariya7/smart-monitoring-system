import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { AuthenticatedUser } from './auth.types';

/** Part 4 permission matrix: a route decorated with @Roles(...) requires one of them. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest();
    const user: AuthenticatedUser | undefined = req.user;
    if (!user) throw new ForbiddenException('Not authenticated');
    const ok = user.roles.some((r) => required.includes(r));
    if (!ok) {
      throw new ForbiddenException(
        `Requires one of roles [${required.join(', ')}], user has [${user.roles.join(', ')}]`,
      );
    }
    return true;
  }
}
