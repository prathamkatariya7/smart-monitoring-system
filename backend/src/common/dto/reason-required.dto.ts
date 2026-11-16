import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Part 11: "State-changing calls on process, threshold, calibration, device,
 * alert and configuration records require a `reason` field." Extend this in
 * every DTO for such an endpoint instead of redefining the field each time.
 */
export class ReasonRequiredDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
