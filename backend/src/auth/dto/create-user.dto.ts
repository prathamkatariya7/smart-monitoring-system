import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

const ROLE_CODES = [
  'ADMIN',
  'BOROSIL_ADMIN',
  'SUPPORT',
  'LAB_INCHARGE',
  'ANALYST',
  'AUDITOR',
];

export class CreateUserDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsString()
  @MinLength(1)
  username: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsIn(ROLE_CODES, { each: true })
  roles: string[];

  /** Required when `roles` includes LAB_INCHARGE or ANALYST (enforced in
   * AuthService.createUser, not here, since it's conditional on `roles`). */
  @IsOptional()
  @IsUUID()
  laboratoryId?: string;

  /** Required when `roles` includes ANALYST -- the specific Lab In-charge
   * this analyst reports to (must be a LAB_INCHARGE scoped to the same lab). */
  @IsOptional()
  @IsUUID()
  reportsToUserId?: string;
}
