import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateMaintenanceDto {
  @IsUUID()
  equipmentId: string;

  @IsIn([
    'PREVENTIVE',
    'CORRECTIVE',
    'SENSOR_REPLACEMENT',
    'DEVICE_REPLACEMENT',
    'COMMS_FAULT',
    'EQUIPMENT_FAULT',
    'FIRMWARE_SERVICE',
  ])
  kind: string;

  @IsDateString()
  performedOn: string;

  @IsOptional()
  @IsString()
  remarks?: string;

  @IsOptional()
  @IsDateString()
  nextDueOn?: string;
}
