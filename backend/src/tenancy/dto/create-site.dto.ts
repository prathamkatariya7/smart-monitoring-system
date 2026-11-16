import { IsOptional, IsString } from 'class-validator';

export class CreateSiteDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  timeZone?: string;
}
