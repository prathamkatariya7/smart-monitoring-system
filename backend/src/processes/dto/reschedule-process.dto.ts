import { IsDateString, IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { ReasonRequiredDto } from '../../common/dto/reason-required.dto';

export class RescheduleProcessDto extends ReasonRequiredDto {
  @IsOptional()
  @IsDateString()
  plannedStartUtc?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  plannedDurationS?: number;

  @IsOptional()
  @IsUUID()
  equipmentId?: string;
}
