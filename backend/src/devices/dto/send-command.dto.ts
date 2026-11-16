import { IsObject, IsString } from 'class-validator';

export class SendCommandDto {
  @IsString()
  cmd: string;

  @IsObject()
  payload: Record<string, unknown>;
}
