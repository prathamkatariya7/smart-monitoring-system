import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/** Part 10.2: physical hardware record. Admin-only; permanent id, never reused. */
@Entity('device')
export class Device {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'serial_no', unique: true })
  serialNo: string;

  @Column({ name: 'hw_revision', type: 'text', nullable: true })
  hwRevision: string | null;

  @Column({ name: 'cert_serial', type: 'text', nullable: true })
  certSerial: string | null;

  @Column({ name: 'claim_code', type: 'text', nullable: true })
  claimCode: string | null;

  @Column({ name: 'claim_state', default: 'UNBOUND' })
  claimState: 'UNBOUND' | 'CLAIMED';

  @Column({ default: 'UNBOUND' })
  status: 'UNBOUND' | 'ACTIVE' | 'DECOMMISSIONED';

  @Column({ name: 'fw_p4', type: 'text', nullable: true })
  fwP4: string | null;

  @Column({ name: 'fw_c6', type: 'text', nullable: true })
  fwC6: string | null;

  @Column({ name: 'dwin_project_ver', type: 'text', nullable: true })
  dwinProjectVer: string | null;

  @Column({ name: 'last_seen', type: 'timestamptz', nullable: true })
  lastSeen: Date | null;

  @Column({ name: 'clock_source', type: 'text', nullable: true })
  clockSource: string | null;

  @Column({ name: 'last_ntp_sync', type: 'timestamptz', nullable: true })
  lastNtpSync: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
