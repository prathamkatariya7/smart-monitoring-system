import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Db } from '../common/db/db.service';
import { NotificationsService } from './notifications.service';
import { currentManager } from '../common/db/request-context';
import { Role } from '../auth/entities/role.entity';
import { UserRole } from '../auth/entities/user-role.entity';

/** Part 6.6: "Unseen high-priority item -> Admin after the configured time (default 15 min)." */
@Injectable()
export class NotificationsSchedulerService {
  private readonly logger = new Logger(NotificationsSchedulerService.name);
  private readonly escalateAfterMinutes = 15;

  constructor(
    private readonly db: Db,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async run(): Promise<void> {
    await this.db.runAsAdmin(async () => {
      await this.notifications.escalateUnseen(this.escalateAfterMinutes, async () => {
        const manager = currentManager();
        const admin = await manager.findOne(Role, { where: { code: 'ADMIN' } });
        if (!admin) return null;
        const adminUserRole = await manager.findOne(UserRole, { where: { roleId: admin.id } });
        return adminUserRole?.userId ?? null;
      });
    });
  }
}
