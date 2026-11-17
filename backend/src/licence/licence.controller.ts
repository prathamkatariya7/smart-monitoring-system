import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';
import { LicenceService } from './licence.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuditService } from '../audit/audit.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/auth.types';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';
import { IsObject, IsString } from 'class-validator';

class UploadLicenceDto {
  @IsObject()
  payload!: Record<string, unknown>;

  @IsString()
  signature!: string;
}

/** Part 9.9: offline licence status (visible to Admin + Borosil Admin) + licence
 * activation/deactivation/change (Borosil-Admin-only -- a client Admin can see
 * their current licence but never manage it, see docs/licence-management-guide.md). */
@UseGuards(RolesGuard)
@Controller('system/licence')
export class LicenceController {
  constructor(
    private readonly licence: LicenceService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  @Roles('ADMIN', 'BOROSIL_ADMIN')
  @Get()
  status() {
    return this.licence.status();
  }

  @Roles('BOROSIL_ADMIN')
  @Post()
  async upload(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UploadLicenceDto,
  ) {
    const publicKeyPath = this.config.get<string>('licence.publicKeyPath')!;
    const filePath = this.config.get<string>('licence.filePath')!;
    if (!fs.existsSync(publicKeyPath)) {
      throw new BadRequestException('Public key not found on server');
    }
    const publicKey = fs.readFileSync(publicKeyPath, 'utf8');
    const canonical = JSON.stringify(dto.payload);
    const valid = crypto.verify(
      'sha256',
      Buffer.from(canonical),
      { key: publicKey, padding: crypto.constants.RSA_PKCS1_PSS_PADDING },
      Buffer.from(dto.signature, 'base64'),
    );
    if (!valid) {
      throw new BadRequestException(
        'Licence signature verification failed -- rejected',
      );
    }

    fs.writeFileSync(filePath, JSON.stringify(dto, null, 2));
    this.licence.reload();
    const status = this.licence.status();

    await this.audit.record({
      userId: user.userId,
      action: 'LICENCE_UPDATED',
      entityType: 'licence',
      newValue: dto.payload,
    });

    return status;
  }

  /**
   * Deactivates the currently installed licence (removes the file). Borosil-
   * Admin-only, reversible by uploading a licence again. Never affects
   * already-collected data, viewing, or export -- only blocks new device
   * claims, same as an expired term (Part 9.9).
   */
  @Roles('BOROSIL_ADMIN')
  @Delete()
  async deactivate(@CurrentUser() user: AuthenticatedUser) {
    const before = this.licence.status();
    this.licence.deactivate();
    const status = this.licence.status();

    await this.audit.record({
      userId: user.userId,
      action: 'LICENCE_DEACTIVATED',
      entityType: 'licence',
      previousValue: before.payload ?? undefined,
    });

    return status;
  }
}
