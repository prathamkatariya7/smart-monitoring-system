import { IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateReactorDto {
  @IsUUID()
  laboratoryId: string;

  @IsString()
  reactorNumber: string;

  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsUUID()
  profileId?: string;
}
