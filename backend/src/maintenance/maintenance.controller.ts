import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { MaintenanceService } from './maintenance.service';
import { CreateMaintenanceDto } from './dto/create-maintenance.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';

@UseGuards(RolesGuard)
@Controller('maintenance')
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Get()
  listForEquipment(@Query('equipmentId') equipmentId: string) {
    return this.maintenance.listForEquipment(equipmentId);
  }

  @Get('due')
  due(@Query('withinDays') withinDays?: string) {
    return this.maintenance.due(withinDays ? parseInt(withinDays, 10) : 30);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.maintenance.get(id);
  }

  @Roles('ADMIN', 'LAB_INCHARGE')
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateMaintenanceDto,
  ) {
    return this.maintenance.create(user, dto);
  }
}
