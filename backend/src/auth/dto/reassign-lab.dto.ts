import { IsOptional, IsUUID } from 'class-validator';

export class ReassignLabDto {
  @IsUUID()
  laboratoryId: string;

  /** Required when the target user is an ANALYST (validated in AuthService). */
  @IsOptional()
  @IsUUID()
  reportsToUserId?: string;
}
