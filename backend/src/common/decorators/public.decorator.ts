import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Marks a route as not requiring a JWT (login, health, device-claim trust check). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
