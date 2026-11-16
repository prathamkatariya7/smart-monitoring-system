import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/** Part 6.2: versioned, only APPROVED is pushed to the device and evaluated. */
@Entity('threshold_version')
export class ThresholdVersion {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'process_id' })
  processId: string;

  @Column({ name: 'version_no' })
  versionNo: number;

  @Column({ default: 'PROPOSED' })
  status: 'APPROVED' | 'PROPOSED' | 'SUPERSEDED' | 'REJECTED';

  @Column({ name: 'params_json', type: 'jsonb' })
  paramsJson: Record<string, unknown>;

  @Column({ name: 'proposed_by' })
  proposedBy: string;

  @Column({ name: 'approved_by', type: 'uuid', nullable: true })
  approvedBy: string | null;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
