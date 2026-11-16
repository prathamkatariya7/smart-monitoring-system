import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { TenancyService } from './tenancy.service';
import { CreateSiteDto } from './dto/create-site.dto';
import { CreateLaboratoryDto } from './dto/create-laboratory.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { ReasonRequiredDto } from '../common/dto/reason-required.dto';

@UseGuards(RolesGuard)
@Controller()
export class TenancyController {
  constructor(private readonly tenancy: TenancyService) {}

  @Get('client')
  getClient() {
    return this.tenancy.getClient();
  }

  @Roles('ADMIN')
  @Put('settings/terminology')
  updateTerminology(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: Record<string, string>,
  ) {
    return this.tenancy.updateTerminology(user, body);
  }

  @Roles('ADMIN')
  @Put('settings/policy')
  updatePolicyPack(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ReasonRequiredDto & { policyPack: string },
  ) {
    return this.tenancy.updatePolicyPack(user, body.policyPack, body.reason);
  }

  @Get('settings/features')
  listFeatureSwitches() {
    return this.tenancy.listFeatureSwitches();
  }

  @Roles('ADMIN')
  @Put('settings/features/:key')
  setFeatureSwitch(
    @CurrentUser() user: AuthenticatedUser,
    @Param('key') key: string,
    @Body() body: ReasonRequiredDto & { value: boolean },
  ) {
    return this.tenancy.setFeatureSwitch(user, key, body.value, body.reason);
  }

  @Get('sites')
  listSites() {
    return this.tenancy.listSites();
  }

  @Roles('ADMIN')
  @Post('sites')
  createSite(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSiteDto) {
    return this.tenancy.createSite(user, dto.name, dto.timeZone);
  }

  @Get('laboratories')
  listLaboratories() {
    return this.tenancy.listLaboratories();
  }

  @Roles('ADMIN')
  @Post('laboratories')
  createLaboratory(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateLaboratoryDto) {
    return this.tenancy.createLaboratory(user, dto.siteId, dto.name, dto.code);
  }
}
