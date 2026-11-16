import { IsString } from 'class-validator';

/** Part 5.2 T4 / various pick-list reasons (free text here; UI supplies the pick-list). */
export class PickListReasonDto {
  @IsString()
  reason: string;
}
