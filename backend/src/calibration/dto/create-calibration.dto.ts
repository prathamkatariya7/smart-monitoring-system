import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

class CalibrationPointDto {
  @IsNumber()
  reference: number;

  @IsNumber()
  indicated: number;
}

export class CreateCalibrationDto {
  @IsUUID()
  deviceId: string;

  @IsUUID()
  equipmentId: string;

  @IsString()
  channel: string;

  @IsIn(['single_point', 'two_point', 'multi_point'])
  method: 'single_point' | 'two_point' | 'multi_point';

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CalibrationPointDto)
  points: CalibrationPointDto[];

  @IsOptional()
  @IsString()
  referenceInstrument?: string;

  @IsOptional()
  @IsString()
  certificateNo?: string;

  @IsOptional()
  @IsString()
  certificateFileRef?: string;

  @IsOptional()
  @IsDateString()
  calibratedOn?: string;

  @IsOptional()
  @IsDateString()
  dueOn?: string;

  @IsString()
  reason: string;
}
