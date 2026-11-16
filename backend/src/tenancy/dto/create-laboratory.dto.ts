import { IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateLaboratoryDto {
  @IsUUID()
  siteId: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  code?: string;
}
