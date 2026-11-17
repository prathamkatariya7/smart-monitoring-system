import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { DevicesService } from './devices.service';
import { ClaimDeviceDto } from './dto/claim-device.dto';
import { BindDeviceDto } from './dto/bind-device.dto';
import { ReplaceDeviceDto } from './dto/replace-device.dto';
import { SendCommandDto } from './dto/send-command.dto';
import { ReasonRequiredDto } from '../common/dto/reason-required.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { CommandDispatcherService } from '../mqtt/command-dispatcher.service';
import { CfgDesiredService } from '../mqtt/cfg-desired.service';

/** Part 11: device registry & claim flow -- Admin only (Part 4). */
@UseGuards(RolesGuard)
@Roles('ADMIN')
@Controller('devices')
export class DevicesController {
  constructor(
    private readonly devices: DevicesService,
    private readonly commandDispatcher: CommandDispatcherService,
    private readonly cfgDesired: CfgDesiredService,
  ) {}

  @Get()
  list() {
    return this.devices.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.devices.get(id);
  }

  @Get(':id/history')
  history(@Param('id') id: string) {
    return this.devices.history(id);
  }

  @Post('claim')
  claim(@CurrentUser() user: AuthenticatedUser, @Body() dto: ClaimDeviceDto) {
    return this.devices.claim(
      user,
      dto.serialNo,
      dto.claimCode,
      dto.hwRevision,
      dto.certSerial,
    );
  }

  @Post('claim/bulk')
  claimBulk(@CurrentUser() user: AuthenticatedUser, @Body('csv') csv: string) {
    return this.devices.claimBulk(user, csv);
  }

  @Post(':id/bind')
  bind(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: BindDeviceDto,
  ) {
    return this.devices.bind(user, id, dto.equipmentId, dto.reason);
  }

  @Post(':id/unbind')
  unbind(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReasonRequiredDto,
  ) {
    return this.devices.unbind(user, id, dto.reason).then(() => ({ ok: true }));
  }

  @Post(':id/replace')
  replace(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReplaceDeviceDto,
  ) {
    return this.devices.replace(
      user,
      id,
      dto.newDeviceId,
      dto.mapToEquipmentId,
      dto.reason,
    );
  }

  @Post(':id/decommission')
  decommission(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReasonRequiredDto,
  ) {
    return this.devices.decommission(user, id, dto.reason);
  }

  @Post(':id/reactivate')
  reactivate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReasonRequiredDto,
  ) {
    return this.devices.reactivate(
      user,
      id,
      dto?.reason || 'Reactivated by admin',
    );
  }

  /** Part 8.2 cmd/{name} + ack/cmd: generic command send (set_calibration, set_policy, etc. land via their modules). */
  @Post(':id/commands')
  async sendCommand(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SendCommandDto,
  ) {
    const commandId = await this.commandDispatcher.send(
      id,
      dto.cmd,
      dto.payload,
      user.userId,
    );
    return { commandId };
  }

  /** Part 8.2 cfg/desired: push the current config/assignment bundle (retained, versioned). */
  @Post(':id/cfg/push')
  pushCfg(@Param('id') id: string) {
    return this.cfgDesired.pushToDevice(id);
  }
}
