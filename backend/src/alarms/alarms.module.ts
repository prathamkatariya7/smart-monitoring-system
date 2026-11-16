import { Module, OnModuleInit } from '@nestjs/common';
import { AlarmsController } from './alarms.controller';
import { AlarmsService } from './alarms.service';
import { AlertOverrideService } from './alert-override.service';
import { AlertCatalogService } from './alert-catalog.service';
import { Db } from '../common/db/db.service';

@Module({
  controllers: [AlarmsController],
  providers: [AlarmsService, AlertOverrideService, AlertCatalogService],
  exports: [AlarmsService, AlertOverrideService, AlertCatalogService],
})
export class AlarmsModule implements OnModuleInit {
  constructor(
    private readonly db: Db,
    private readonly alertCatalog: AlertCatalogService,
  ) {}

  async onModuleInit() {
    // Part 6.5: seed the default alert catalog on first boot so override
    // rules exist before any alarm can fire.
    await this.db.runAsAdmin(async () => {
      await this.alertCatalog.ensureSeeded();
    });
  }
}
