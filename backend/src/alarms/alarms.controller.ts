import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AlarmsService } from './alarms.service';
import { AlertOverrideService } from './alert-override.service';
import { AlertCatalogService } from './alert-catalog.service';
import { CreateOverrideDto } from './dto/create-override.dto';
import { ReasonRequiredDto } from '../common/dto/reason-required.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';

@UseGuards(RolesGuard)
@Controller()
export class AlarmsController {
  constructor(
    private readonly alarms: AlarmsService,
    private readonly overrides: AlertOverrideService,
    private readonly catalog: AlertCatalogService,
  ) {}

  @Get('alarms')
  list() {
    return this.alarms.list();
  }

  @Get('reactors/:id/alarms')
  listForReactor(@Param('id') id: string) {
    return this.alarms.listActiveForEquipment(id);
  }

  @Post('alarms/:id/ack')
  ack(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.alarms.ack(user, id);
  }

  @Post('alarms/:id/override')
  override(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: CreateOverrideDto) {
    return this.overrides.create(user, id, dto.reasonCode, dto.reasonText, dto.durationMin);
  }

  @Post('overrides/:id/revoke')
  revoke(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: ReasonRequiredDto) {
    return this.overrides.revoke(user, id, dto.reason);
  }

  @Post('overrides/:id/seen')
  markSeen(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.overrides.markSeen(user, id);
  }

  @Get('overrides')
  listOverrides(@Query('equipmentId') equipmentId?: string) {
    return this.overrides.list({ equipmentId });
  }

  @Get('settings/alert-catalog')
  getCatalog() {
    return this.catalog.list();
  }

  @Roles('ADMIN')
  @Post('settings/alert-catalog/:alertType')
  updateCatalog(
    @CurrentUser() user: AuthenticatedUser,
    @Param('alertType') alertType: string,
    @Body() body: ReasonRequiredDto & { class?: string; overridableBy?: string; maxOverrideMin?: number },
  ) {
    return this.catalog.update(
      user,
      alertType,
      {
        class: body.class as any,
        overridableBy: body.overridableBy as any,
        maxOverrideMin: body.maxOverrideMin,
      },
      body.reason,
    );
  }
}
