import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/** Part 4 permission matrix: gate an endpoint to one or more role codes. */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
