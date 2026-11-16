import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/** Part 8.2: cmd/{name} + ack/cmd correlation (MQTT5 correlation data = this row's id). */
@Entity('device_command')
export class DeviceCommand {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'device_id' })
  deviceId: string;

  @Column()
  cmd: string;

  @Column({ name: 'payload_json', type: 'jsonb', default: {} })
  payloadJson: Record<string, unknown>;

  @Column({ default: 'PENDING' })
  status: 'PENDING' | 'ACKED' | 'REJECTED' | 'TIMED_OUT';

  @Column({ name: 'result_json', type: 'jsonb', nullable: true })
  resultJson: Record<string, unknown> | null;

  @Column({ name: 'requested_by', type: 'uuid', nullable: true })
  requestedBy: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'acked_at', type: 'timestamptz', nullable: true })
  ackedAt: Date | null;
}
