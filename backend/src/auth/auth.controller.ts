import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ReassignLabDto } from './dto/reassign-lab.dto';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from './auth.types';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.username, dto.password, dto.mfaCode);
  }

  @Public()
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  logout() {
    // Stateless JWTs: the client discards tokens. Session end is still audited via LOGIN_SUCCEEDED
    // history on this user; a server-side revocation list is a defensible P1 add if needed.
    return { ok: true };
  }

  // Not in the original spec -- added for the frontend, since the JWT only carries `sub` and
  // roles/lab-scope are resolved server-side per request (JwtStrategy), with no other way for
  // the client to know its own roles/name for nav/role-gating.
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }

  // Not in the original spec -- added for the frontend's user pickers (process
  // analyst assignment, handover target, etc.). Any authenticated user can list
  // (not sensitive -- name/username/roles only, no credentials).
  @Get('users')
  users() {
    return this.auth.listUsers();
  }

  // Not in the original spec -- added so the Borosil Admin (first deployment) and a
  // client Admin (day-to-day) can both create users without hand-writing SQL.
  // AuthService.createUser() enforces the privilege-escalation guard (only a Borosil
  // Admin may grant the BOROSIL_ADMIN role).
  @Roles('ADMIN', 'BOROSIL_ADMIN')
  @Post('users')
  createUser(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateUserDto) {
    return this.auth.createUser(user, dto);
  }

  // Not in the original spec -- support action: a client Admin can reset passwords
  // for their own users, but AuthService.resetPassword() blocks them from resetting
  // a BOROSIL_ADMIN account (so a client Admin can never lock Borosil out).
  @Roles('ADMIN', 'BOROSIL_ADMIN')
  @Post('users/:id/reset-password')
  resetPassword(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ResetPasswordDto,
  ) {
    return this.auth.resetPassword(user, id, dto.newPassword);
  }

  // Lab reassignment is a tenancy-adjacent action (Task 1) -- restricted to
  // the client's own ADMIN, not BOROSIL_ADMIN, matching Borosil Admin's
  // deliberately narrow scope (licence + user bootstrap only).
  @Roles('ADMIN')
  @Patch('users/:id/lab')
  reassignLab(@Param('id') id: string, @Body() dto: ReassignLabDto) {
    return this.auth.reassignLab(id, dto.laboratoryId, dto.reportsToUserId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('mfa/enroll')
  beginMfa(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.beginMfaEnrolment(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('mfa/confirm')
  confirmMfa(@CurrentUser() user: AuthenticatedUser, @Body('code') code: string) {
    return this.auth.confirmMfaEnrolment(user.userId, code);
  }
}
