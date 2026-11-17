import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as mqtt from 'mqtt';

export type MqttMessageHandler = (
  topic: string,
  payload: Buffer,
) => void | Promise<void>;

/**
 * Backend's own MQTT client (Part 9.1 ingestion worker / command dispatcher).
 * Connects with its own mTLS client certificate (CN=rmp-backend, signed by
 * the same dev CA as devices) -- the broker's `require_certificate true`
 * applies to every client, not just devices.
 */
@Injectable()
export class MqttClientService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MqttClientService.name);
  private client?: mqtt.MqttClient;
  private readonly handlers: Array<{
    topicFilter: string;
    handler: MqttMessageHandler;
  }> = [];

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const url = this.config.get<string>('mqtt.url')!;
    const caPath = this.config.get<string>('mqtt.caPath');
    const certPath = this.config.get<string>('mqtt.certPath');
    const keyPath = this.config.get<string>('mqtt.keyPath');

    const options: mqtt.IClientOptions = {
      clientId: this.config.get<string>('mqtt.clientId'),
      protocolVersion: 5,
      reconnectPeriod: 2000,
      rejectUnauthorized: true,
    };
    if (caPath && fs.existsSync(caPath)) options.ca = fs.readFileSync(caPath);
    if (certPath && fs.existsSync(certPath))
      options.cert = fs.readFileSync(certPath);
    if (keyPath && fs.existsSync(keyPath))
      options.key = fs.readFileSync(keyPath);

    this.client = mqtt.connect(url, options);
    this.client.on('connect', () => {
      this.logger.log(`Connected to MQTT broker at ${url}`);
      for (const { topicFilter } of this.handlers) {
        this.client!.subscribe(topicFilter, { qos: 1 });
      }
    });
    this.client.on('error', (err) =>
      this.logger.error(`MQTT error: ${err.message}`),
    );
    this.client.on('message', (topic, payload) => {
      for (const { topicFilter, handler } of this.handlers) {
        if (this.topicMatches(topicFilter, topic)) {
          try {
            const res = handler(topic, payload);
            if (res && typeof (res as Promise<void>).catch === 'function') {
              (res as Promise<void>).catch((err: any) => {
                this.logger.error(
                  `Async handler for ${topicFilter} failed on topic ${topic}: ${err?.message ?? err}`,
                );
              });
            }
          } catch (err: any) {
            this.logger.error(
              `Handler for ${topicFilter} threw on topic ${topic}: ${err.message}`,
            );
          }
        }
      }
    });
  }

  onModuleDestroy() {
    this.client?.end(true);
  }

  /** Register a handler for a topic filter (supports single-level `+` and multi-level `#` wildcards). */
  subscribe(topicFilter: string, handler: MqttMessageHandler): void {
    this.handlers.push({ topicFilter, handler });
    if (this.client?.connected) {
      this.client.subscribe(topicFilter, { qos: 1 });
    }
  }

  publish(
    topic: string,
    payload: string | Buffer,
    opts: mqtt.IClientPublishOptions = { qos: 1 },
  ): void {
    this.client?.publish(topic, payload, opts, (err) => {
      if (err) this.logger.error(`Publish to ${topic} failed: ${err.message}`);
    });
  }

  /** Part 9.10 health check: is the backend's MQTT client currently connected to the broker. */
  isConnected(): boolean {
    return this.client?.connected ?? false;
  }

  private topicMatches(filter: string, topic: string): boolean {
    const filterParts = filter.split('/');
    const topicParts = topic.split('/');
    for (let i = 0; i < filterParts.length; i++) {
      if (filterParts[i] === '#') return true;
      if (filterParts[i] === '+') continue;
      if (filterParts[i] !== topicParts[i]) return false;
    }
    return filterParts.length === topicParts.length;
  }
}
