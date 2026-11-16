import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/** Part 8.2: cfg/desired bundle, retained, versioned. */
@Entity('device_config_version')
export class DeviceConfigVersion {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'device_id' })
  deviceId: string;

  @Column()
  version: number;

  @Column({ name: 'bundle_json', type: 'jsonb' })
  bundleJson: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
