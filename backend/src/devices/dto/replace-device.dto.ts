import { IsOptional, IsUUID } from 'class-validator';
import { ReasonRequiredDto } from '../../common/dto/reason-required.dto';

/** Part 12.5: replace a failed device, mapping the new one to the same reactor (or a new one). */
export class ReplaceDeviceDto extends ReasonRequiredDto {
  @IsUUID()
  newDeviceId: string;

  @IsOptional()
  @IsUUID()
  mapToEquipmentId?: string;
}
