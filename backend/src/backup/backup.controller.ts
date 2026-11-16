import { Controller, Get, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { BackupService } from './backup.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuditService } from '../audit/audit.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';

/** Part 9.8: list/trigger/download backups. Admin-only -- backups may contain sensitive data. */
@UseGuards(RolesGuard)
@Roles('ADMIN')
@Controller('system/backups')
export class BackupController {
  constructor(
    private readonly backup: BackupService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  list() {
    return this.backup.list();
  }

  @Post()
  async trigger(@CurrentUser() user: AuthenticatedUser) {
    const result = await this.backup.runBackup();
    await this.audit.record({
      userId: user.userId,
      action: 'BACKUP_TRIGGERED',
      entityType: 'backup',
      newValue: result,
    });
    return result;
  }

  @Get(':file/download')
  download(@Param('file') file: string, @Res() res: Response) {
    const dir = this.config.get<string>('backup.dir')!;
    const safeName = path.basename(file); // prevent path traversal
    res.download(path.join(dir, safeName));
  }
}
