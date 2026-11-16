import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('laboratory')
export class Laboratory {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'site_id' })
  siteId: string;

  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  code: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
