import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/** Device-level events not tied to a process attempt (TIME_ANCHOR, DEVICE_REBOOT, NET_FAILOVER). */
@Entity('device_event')
export class DeviceEvent {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'device_id' })
  deviceId: string;

  @Column({ name: 'boot_id', type: 'integer', nullable: true })
  bootId: number | null;

  @Column({ type: 'timestamptz' })
  ts: Date;

  @Column()
  type: string;

  @Column({ name: 'detail_json', type: 'jsonb', default: {} })
  detailJson: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
