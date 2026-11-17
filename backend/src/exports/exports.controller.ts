import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ExportsService } from './exports.service';
import { CreateExportDto } from './dto/create-export.dto';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';

@UseGuards(RolesGuard)
@Controller('exports')
export class ExportsController {
  constructor(private readonly exports: ExportsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.exports.listForUser(user.userId);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.exports.get(id);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateExportDto) {
    return this.exports.create(user, dto);
  }

  @Get(':id/download')
  async download(@Param('id') id: string, @Res() res: Response) {
    const job = await this.exports.get(id);
    const filePath = this.exports.getFilePath(job);
    res.download(filePath, `export_${id}.csv`);
  }
}
