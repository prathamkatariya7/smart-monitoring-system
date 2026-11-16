import { IsInt, Min } from 'class-validator';
import { ReasonRequiredDto } from '../../common/dto/reason-required.dto';

/** Part 5.2 T10: extend from AWAITING_COMPLETION back to RUNNING with a new planned duration. */
export class ExtendProcessDto extends ReasonRequiredDto {
  @IsInt()
  @Min(1)
  newPlannedDurationS: number;
}
