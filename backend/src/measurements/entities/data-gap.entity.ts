import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/** Part 8.3: explicit, derived, reproducible gap record (not inferred at query time). */
@Entity('data_gap')
export class DataGap {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'device_id' })
  deviceId: string;

  @Column({ name: 'attempt_id', type: 'uuid', nullable: true })
  attemptId: string | null;

  @Column({ name: 'from_ts', type: 'timestamptz' })
  fromTs: Date;

  @Column({ name: 'to_ts', type: 'timestamptz' })
  toTs: Date;

  @Column({ name: 'expected_n', type: 'integer', nullable: true })
  expectedN: number | null;

  @Column()
  kind: 'BUFFER_OVERWRITE' | 'OUTAGE' | 'MISSING_SEQ';

  @CreateDateColumn({ name: 'detected_at' })
  detectedAt: Date;
}
