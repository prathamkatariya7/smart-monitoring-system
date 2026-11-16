import { IsDateString, IsInt, IsOptional, IsUUID, Min } from 'class-validator';

export class CreateExportDto {
  @IsUUID()
  equipmentId: string;

  @IsDateString()
  from: string;

  @IsDateString()
  to: string;

  /** Part 8.5: 1, 5, 10, 30 or 60 s; omit or 1 for raw (every sample). */
  @IsOptional()
  @IsInt()
  @Min(1)
  intervalS?: number;
}
