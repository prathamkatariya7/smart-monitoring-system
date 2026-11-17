import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateOverrideDto {
  @IsString()
  reasonCode: string;

  @IsOptional()
  @IsString()
  reasonText?: string;

  @IsInt()
  @Min(1)
  @Max(1440)
  durationMin: number;
}
