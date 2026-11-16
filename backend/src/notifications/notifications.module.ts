import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { RealtimeGateway } from './realtime.gateway';
import { NotificationsSchedulerService } from './notifications-scheduler.service';

/** Global: AlarmsModule and others need NotificationsService without a direct import cycle. */
@Global()
@Module({
  imports: [JwtModule.register({})],
  controllers: [NotificationsController],
  providers: [NotificationsService, RealtimeGateway, NotificationsSchedulerService],
  exports: [NotificationsService, RealtimeGateway],
})
export class NotificationsModule {}
