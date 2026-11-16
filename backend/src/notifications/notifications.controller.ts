import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';

@UseGuards(RolesGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) { }

  /** Active (unseen) notifications — powers the bell badge and notification list. */
  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.listForUser(user);
  }

  /** Full history (seen + unseen) — for a dedicated history / audit screen. */
  @Get('history')
  history(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.listAllForUser(user);
  }

  /** Mark a single notification as seen; it disappears from the active list. */
  @Post(':id/seen')
  markSeen(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.notifications.markSeen(user, id).then(() => ({ ok: true }));
  }

  /** Mark every unseen notification as seen; clears the active list. */
  @Post('seen-all')
  markAllSeen(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.markAllSeen(user).then(() => ({ ok: true }));
  }
}
