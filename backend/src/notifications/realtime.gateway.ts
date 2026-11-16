import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Injectable, Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { UserRole } from '../auth/entities/user-role.entity';
import { UserLabScope } from '../auth/entities/user-lab-scope.entity';
import { Role } from '../auth/entities/role.entity';

/**
 * Part 9.2/14: realtime WebSocket push for notifications and live data.
 * Clients authenticate with their existing access token (query param or
 * `Authorization` header on the handshake) and are placed in a room per
 * user id and per laboratory id, so NotificationsService/AlarmsService can
 * target "this user" or "everyone watching this lab" without re-deriving
 * RLS scope per socket.
 */
@Injectable()
@WebSocketGateway({ cors: { origin: '*' }, namespace: '/ws' })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token =
        (client.handshake.auth?.token as string) ||
        (client.handshake.query?.token as string) ||
        client.handshake.headers.authorization?.replace('Bearer ', '');
      if (!token) throw new Error('No token supplied');

      const payload = await this.jwt.verifyAsync<{ sub: string }>(token, {
        secret: this.config.get<string>('auth.accessSecret'),
      });

      const manager = this.dataSource.manager;
      const roles = await manager.find(UserRole, { where: { userId: payload.sub } });
      const isAdmin = roles.length > 0 && (await this.isAdminRole(roles.map((r) => r.roleId)));
      const scopes = await manager.find(UserLabScope, { where: { userId: payload.sub } });

      client.data.userId = payload.sub;
      client.data.isAdmin = isAdmin;
      client.data.laboratoryIds = scopes.map((s) => s.laboratoryId);
      client.join(`user:${payload.sub}`);
      this.logger.log(`Socket ${client.id} authenticated as user ${payload.sub}`);
    } catch (err: any) {
      this.logger.warn(`Socket ${client.id} failed auth: ${err.message}`);
      client.disconnect(true);
    }
  }

  private async isAdminRole(roleIds: string[]): Promise<boolean> {
    if (roleIds.length === 0) return false;
    const rows = await this.dataSource
      .getRepository(Role)
      .createQueryBuilder('r')
      .where('r.id IN (:...ids)', { ids: roleIds })
      .andWhere("r.code = 'ADMIN'")
      .getCount();
    return rows > 0;
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`Socket ${client.id} disconnected`);
  }

  /** Client emits `join_lab` with a laboratory id after connecting (for live reactor views, Part 14.5). */
  @SubscribeMessage('join_lab')
  joinLaboratory(client: Socket, laboratoryId: string): void {
    const isAdmin = !!client.data.isAdmin;
    const laboratoryIds: string[] = client.data.laboratoryIds ?? [];
    if (!isAdmin && !laboratoryIds.includes(laboratoryId)) {
      this.logger.warn(`Socket ${client.id} denied join_lab ${laboratoryId} (out of scope)`);
      return;
    }
    client.join(`lab:${laboratoryId}`);
  }

  pushToUser(userId: string, event: string, payload: unknown): void {
    this.server?.to(`user:${userId}`).emit(event, payload);
  }

  pushToLaboratory(laboratoryId: string, event: string, payload: unknown): void {
    this.server?.to(`lab:${laboratoryId}`).emit(event, payload);
  }
}
