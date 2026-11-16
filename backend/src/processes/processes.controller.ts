import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ProcessesService } from './processes.service';
import { CreateProcessDto } from './dto/create-process.dto';
import { RescheduleProcessDto } from './dto/reschedule-process.dto';
import { PickListReasonDto } from './dto/pick-list-reason.dto';
import { ExtendProcessDto } from './dto/extend-process.dto';
import { RequestHandoverDto } from './dto/request-handover.dto';
import { SetThresholdsDto } from './dto/set-thresholds.dto';
import { ReasonRequiredDto } from '../common/dto/reason-required.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';

/** Part 11/5: process lifecycle (T1-T14). */
@UseGuards(RolesGuard)
@Controller()
export class ProcessesController {
  constructor(private readonly processes: ProcessesService) {}

  @Get('processes')
  list() {
    return this.processes.list();
  }

  @Get('processes/:id')
  get(@Param('id') id: string) {
    return this.processes.get(id);
  }

  @Get('processes/:id/attempts')
  attempts(@Param('id') id: string) {
    return this.processes.getAttempts(id);
  }

  @Roles('ADMIN', 'LAB_INCHARGE')
  @Post('processes')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateProcessDto) {
    return this.processes.create(user, dto);
  }

  @Roles('ADMIN', 'LAB_INCHARGE')
  @Post('processes/:id/reschedule')
  reschedule(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: RescheduleProcessDto) {
    return this.processes.reschedule(user, id, dto, dto.reason);
  }

  @Post('processes/:id/assign/accept')
  acceptAssignment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body('onBehalfOfUserId') onBehalfOfUserId?: string,
  ) {
    return this.processes.acceptAssignment(user, id, onBehalfOfUserId);
  }

  @Post('processes/:id/assign/reject')
  rejectAssignment(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: PickListReasonDto) {
    return this.processes.rejectAssignment(user, id, dto.reason);
  }

  @Post('processes/:id/start')
  start(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.processes.start(user, id);
  }

  @Post('processes/:id/pause')
  pause(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: PickListReasonDto) {
    return this.processes.pause(user, id, dto.reason);
  }

  @Post('processes/:id/resume')
  resume(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.processes.resume(user, id);
  }

  @Post('processes/:id/complete')
  complete(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body('onBehalf') onBehalf?: boolean) {
    return this.processes.complete(user, id, !!onBehalf);
  }

  @Roles('ADMIN', 'LAB_INCHARGE')
  @Post('processes/:id/extend')
  extend(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: ExtendProcessDto) {
    return this.processes.extend(user, id, dto.newPlannedDurationS, dto.reason);
  }

  @Roles('ADMIN', 'LAB_INCHARGE')
  @Post('processes/:id/cancel')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: ReasonRequiredDto) {
    return this.processes.cancel(user, id, dto.reason);
  }

  @Post('processes/:id/abort')
  abort(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: ReasonRequiredDto) {
    return this.processes.abort(user, id, dto.reason);
  }

  @Roles('ADMIN', 'LAB_INCHARGE')
  @Post('processes/:id/restart')
  restart(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: ReasonRequiredDto) {
    return this.processes.restart(user, id, dto.reason);
  }

  @Roles('ADMIN', 'LAB_INCHARGE')
  @Post('processes/:id/handover')
  requestHandover(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: RequestHandoverDto) {
    return this.processes.requestHandover(user, id, dto.toUserId, dto.reason);
  }

  @Post('handovers/:id/ack')
  ackHandover(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.processes.acknowledgeHandover(user, id);
  }

  @Roles('ADMIN', 'LAB_INCHARGE')
  @Post('handovers/:id/override')
  overrideHandover(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: ReasonRequiredDto) {
    return this.processes.overrideHandover(user, id, dto.reason);
  }

  @Get('processes/:id/thresholds')
  getThresholds(@Param('id') id: string) {
    return this.processes.getThresholds(id);
  }

  @Post('processes/:id/thresholds')
  setThresholds(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: SetThresholdsDto) {
    return this.processes.setThresholds(user, id, dto.params, dto.reason);
  }

  @Roles('ADMIN', 'LAB_INCHARGE')
  @Post('thresholds/:versionId/approve')
  approveThreshold(@CurrentUser() user: AuthenticatedUser, @Param('versionId') versionId: string) {
    return this.processes.approveThreshold(user, versionId);
  }

  @Roles('ADMIN', 'LAB_INCHARGE')
  @Post('thresholds/:versionId/reject')
  rejectThreshold(
    @CurrentUser() user: AuthenticatedUser,
    @Param('versionId') versionId: string,
    @Body() dto: ReasonRequiredDto,
  ) {
    return this.processes.rejectThreshold(user, versionId, dto.reason);
  }
}
