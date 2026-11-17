import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { MeasurementsService } from './measurements.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';

@UseGuards(RolesGuard)
@Controller()
export class MeasurementsController {
  constructor(private readonly measurements: MeasurementsService) {}

  @Get('reactors/:id/live')
  live(@Param('id') id: string) {
    return this.measurements.latestForEquipment(id);
  }

  @Get('reactors/:id/measurements')
  recent(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.measurements.recentForEquipment(
      id,
      limit ? parseInt(limit, 10) : 50,
    );
  }

  @Roles('ADMIN')
  @Get('devices/:id/gaps')
  gaps(@Param('id') id: string) {
    return this.measurements.gapsForDevice(id);
  }
}
