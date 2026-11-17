import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { EquipmentService } from './equipment.service';
import { CreateReactorDto } from './dto/create-reactor.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import { ReasonRequiredDto } from '../common/dto/reason-required.dto';

/** Part 11: GET/POST/PATCH /reactors. */
@UseGuards(RolesGuard)
@Controller('reactors')
export class EquipmentController {
  constructor(private readonly equipment: EquipmentService) {}

  @Get()
  list() {
    return this.equipment.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.equipment.get(id);
  }

  @Roles('ADMIN')
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateReactorDto,
  ) {
    return this.equipment.create(
      user,
      dto.laboratoryId,
      dto.reactorNumber,
      dto.displayName,
      dto.profileId,
    );
  }

  @Roles('ADMIN', 'LAB_INCHARGE')
  @Patch(':id/maintenance-mode')
  setMaintenanceMode(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: ReasonRequiredDto & { maintenanceMode: boolean },
  ) {
    return this.equipment.setMaintenanceMode(
      user,
      id,
      body.maintenanceMode,
      body.reason,
    );
  }

  @Roles('ADMIN')
  @Patch(':id/decommission')
  decommission(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: ReasonRequiredDto,
  ) {
    return this.equipment.decommission(user, id, body.reason);
  }
}
