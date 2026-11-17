import { Injectable, Logger } from '@nestjs/common';
import { Db } from '../common/db/db.service';
import { currentManager } from '../common/db/request-context';
import { newId } from '../common/util/id.util';
import { MqttClientService } from './mqtt-client.service';
import { DeviceCommand } from './entities/device-command.entity';

export interface AckCmdPayload {
  id: string;
  status: 'applied' | 'rejected';
  applied_version?: number;
  reason?: string;
  [key: string]: unknown;
}

/**
 * Part 8.2 command dispatcher: server -> device commands on `cmd/{name}`,
 * correlated by command id (carried as MQTT5 correlation data and echoed in
 * the JSON body for brokers/tools that don't surface MQTT5 properties),
 * acknowledged on `ack/cmd`. Named command helpers (setThresholds,
 * setCalibration, overrideAlert, ...) are added by their owning modules;
 * this service only owns the generic publish/track/ack plumbing.
 */
@Injectable()
export class CommandDispatcherService {
  private readonly logger = new Logger(CommandDispatcherService.name);

  constructor(
    private readonly mqtt: MqttClientService,
    private readonly db: Db,
  ) {}

  registerHandlers(): void {
    this.mqtt.subscribe('rmp/v1/+/ack/cmd', (topic, payload) =>
      this.onAck(topic, payload),
    );
  }

  /** Send a command to a device; returns the device_command row id (correlation id). */
  async send(
    deviceId: string,
    cmd: string,
    payload: Record<string, unknown>,
    requestedBy?: string,
  ): Promise<string> {
    const manager = currentManager();
    const id = newId();
    await manager.save(DeviceCommand, {
      id,
      deviceId,
      cmd,
      payloadJson: payload,
      status: 'PENDING',
      requestedBy: requestedBy ?? null,
    });

    this.mqtt.publish(
      `rmp/v1/${deviceId}/cmd/${cmd}`,
      JSON.stringify({ id, cmd, ...payload }),
      { qos: 1, properties: { correlationData: Buffer.from(id) } },
    );
    return id;
  }

  private async onAck(topic: string, payloadBuf: Buffer): Promise<void> {
    let payload: AckCmdPayload;
    try {
      payload = JSON.parse(payloadBuf.toString('utf8'));
    } catch {
      this.logger.warn(`Malformed ack/cmd payload on ${topic}`);
      return;
    }
    if (!payload.id) {
      this.logger.warn(`ack/cmd with no correlation id on ${topic}`);
      return;
    }

    await this.db.runAsAdmin(async (manager) => {
      const existing = await manager.findOne(DeviceCommand, {
        where: { id: payload.id },
      });
      if (!existing) {
        this.logger.warn(`ack/cmd for unknown command id ${payload.id}`);
        return;
      }
      await manager.update(
        DeviceCommand,
        { id: payload.id },
        {
          status: payload.status === 'applied' ? 'ACKED' : 'REJECTED',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          resultJson: { ...payload } as any,
          ackedAt: new Date(),
        },
      );
      this.logger.log(
        `Command ${existing.cmd} (${payload.id}) -> ${payload.status}`,
      );
    });
  }
}
