import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('device_profile')
export class DeviceProfile {
  @PrimaryColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ name: 'channel_definitions_json', type: 'jsonb', default: {} })
  channelDefinitionsJson: Record<string, unknown>;

  @Column({ name: 'policy_defaults_json', type: 'jsonb', default: {} })
  policyDefaultsJson: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
