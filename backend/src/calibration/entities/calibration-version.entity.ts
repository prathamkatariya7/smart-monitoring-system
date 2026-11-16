import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/** Part 12: calibration workflow -- DRAFT -> APPROVED -> APPLIED, or ROLLED_BACK/SUPERSEDED. */
@Entity('calibration_version')
export class CalibrationVersion {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'device_id' })
  deviceId: string;

  @Column({ name: 'equipment_id' })
  equipmentId: string;

  @Column()
  channel: string;

  @Column()
  method: 'single_point' | 'two_point' | 'multi_point';

  @Column({ name: 'points_json', type: 'jsonb' })
  pointsJson: Record<string, unknown>;

  @Column({ name: 'coefficients_json', type: 'jsonb' })
  coefficientsJson: Record<string, unknown>;

  @Column({ name: 'previous_version_id', type: 'uuid', nullable: true })
  previousVersionId: string | null;

  @Column({ name: 'error_summary', type: 'jsonb', nullable: true })
  errorSummary: Record<string, unknown> | null;

  @Column({ name: 'reference_instrument', type: 'text', nullable: true })
  referenceInstrument: string | null;

  @Column({ name: 'certificate_no', type: 'text', nullable: true })
  certificateNo: string | null;

  @Column({ name: 'certificate_file_ref', type: 'text', nullable: true })
  certificateFileRef: string | null;

  @Column({ name: 'calibrated_on', type: 'date', nullable: true })
  calibratedOn: string | null;

  @Column({ name: 'due_on', type: 'date', nullable: true })
  dueOn: string | null;

  @Column({ name: 'valid_from', type: 'timestamptz', nullable: true })
  validFrom: Date | null;

  @Column({ name: 'valid_to', type: 'timestamptz', nullable: true })
  validTo: Date | null;

  @Column({ default: 'DRAFT' })
  status: 'DRAFT' | 'APPROVED' | 'APPLIED' | 'SUPERSEDED' | 'ROLLED_BACK';

  @Column({ name: 'entered_by' })
  enteredBy: string;

  @Column({ name: 'approved_by', type: 'uuid', nullable: true })
  approvedBy: string | null;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Column({ name: 'device_ack_ts', type: 'timestamptz', nullable: true })
  deviceAckTs: Date | null;

  @Column({ name: 'config_version', type: 'integer', nullable: true })
  configVersion: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
