import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('site')
export class Site {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'client_id' })
  clientId: string;

  @Column()
  name: string;

  @Column({ name: 'time_zone', default: 'UTC' })
  timeZone: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
