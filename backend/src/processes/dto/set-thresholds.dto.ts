import { IsObject } from 'class-validator';
import { ReasonRequiredDto } from '../../common/dto/reason-required.dto';

/** Part 6.2: tighten (auto-approved) or widen (PROPOSED, needs approval) a threshold limit. */
export class SetThresholdsDto extends ReasonRequiredDto {
  @IsObject()
  params: Record<string, unknown>;
}
