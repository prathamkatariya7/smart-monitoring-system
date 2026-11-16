import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('device_state')
export class DeviceState {
  @PrimaryColumn('uuid', { name: 'device_id' })
  deviceId: string;

  @Column({ name: 'boot_id', type: 'integer', nullable: true })
  bootId: number | null;

  @Column({ name: 'last_seq', type: 'integer', nullable: true })
  lastSeq: number | null;

  @Column({ name: 'last_ts', type: 'timestamptz', nullable: true })
  lastTs: Date | null;

  @Column({ name: 'last_mono_ms', type: 'bigint', nullable: true })
  lastMonoMs: string | null;

  @Column({ type: 'text', nullable: true })
  link: string | null;

  @Column({ default: false })
  online: boolean;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
