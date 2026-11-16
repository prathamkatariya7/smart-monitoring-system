import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('export_job')
export class ExportJob {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'requested_by' })
  requestedBy: string;

  @Column({ name: 'scope_json', type: 'jsonb' })
  scopeJson: Record<string, unknown>;

  @Column({ default: 'PENDING' })
  status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';

  @Column({ name: 'file_ref', type: 'text', nullable: true })
  fileRef: string | null;

  @Column({ type: 'text', nullable: true })
  sha256: string | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;
}
