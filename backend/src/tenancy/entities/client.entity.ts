import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/** Part 10.2: single row per install (single-tenant, Part 3.1). */
@Entity('client')
export class Client {
  @PrimaryColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column()
  edition: 'solo' | 'team' | 'enterprise';

  @Column({ name: 'policy_pack' })
  policyPack: 'flexible' | 'standard' | 'regulated';

  @Column({ name: 'terminology_json', type: 'jsonb', default: {} })
  terminologyJson: Record<string, string>;

  @Column({ default: 'ACTIVE' })
  status: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
