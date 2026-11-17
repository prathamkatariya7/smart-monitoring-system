import {
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ArrayMinSize,
} from 'class-validator';

export class CreateProcessDto {
  @IsUUID()
  equipmentId: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsDateString()
  plannedStartUtc: string;

  @IsInt()
  @Min(1)
  plannedDurationS: number;

  @IsOptional()
  @IsString()
  durationUnitDisplay?: string;

  /** First analyst in the array becomes the initial OWNER-designate (Part 5.1/14.4). */
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('all', { each: true })
  analystUserIds: string[];

  /** Initial threshold set (Part 6.1/6.2) -- becomes version 1, APPROVED. */
  @IsOptional()
  thresholds?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  remarks?: string;
}
