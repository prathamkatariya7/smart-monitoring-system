import { IsUUID } from 'class-validator';
import { ReasonRequiredDto } from '../../common/dto/reason-required.dto';

export class RequestHandoverDto extends ReasonRequiredDto {
  @IsUUID()
  toUserId: string;
}
