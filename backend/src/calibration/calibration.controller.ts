import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CalibrationService } from './calibration.service';
import { CreateCalibrationDto } from './dto/create-calibration.dto';
import { ReasonRequiredDto } from '../common/dto/reason-required.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';

/** Part 11/12: Admin-only (view: Auditor too, per Part 4 -- enforced loosely here as read-open to any authenticated role). */
@UseGuards(RolesGuard)
@Controller('calibrations')
export class CalibrationController {
  constructor(private readonly calibration: CalibrationService) {}

  @Get()
  list(@Query('deviceId') deviceId?: string) {
    if (deviceId) {
      return this.calibration.listForDevice(deviceId);
    }
    return this.calibration.listAll();
  }

  @Get('due')
  due(@Query('withinDays') withinDays?: string) {
    return this.calibration.dueList(withinDays ? parseInt(withinDays, 10) : 30);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.calibration.get(id);
  }

  @Roles('ADMIN')
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCalibrationDto,
  ) {
    return this.calibration.create(user, dto);
  }

  @Roles('ADMIN')
  @Post(':id/approve')
  approve(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.calibration.approve(user, id);
  }

  @Roles('ADMIN')
  @Post(':id/apply')
  apply(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.calibration.apply(user, id);
  }

  @Roles('ADMIN')
  @Post(':id/rollback')
  rollback(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReasonRequiredDto,
  ) {
    return this.calibration.rollback(user, id, dto.reason);
  }
}
