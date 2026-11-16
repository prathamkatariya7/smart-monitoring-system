import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('permission')
export class Permission {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ unique: true })
  code: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;
}
