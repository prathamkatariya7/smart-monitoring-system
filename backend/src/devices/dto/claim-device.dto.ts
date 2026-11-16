import { IsOptional, IsString } from 'class-validator';

export class ClaimDeviceDto {
  @IsString()
  serialNo: string;

  @IsString()
  claimCode: string;

  @IsOptional()
  @IsString()
  hwRevision?: string;

  @IsOptional()
  @IsString()
  certSerial?: string;
}
