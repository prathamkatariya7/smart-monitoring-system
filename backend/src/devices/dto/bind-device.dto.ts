import { IsUUID } from 'class-validator';
import { ReasonRequiredDto } from '../../common/dto/reason-required.dto';

export class BindDeviceDto extends ReasonRequiredDto {
  @IsUUID()
  equipmentId: string;
}
