import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('app_user')
export class AppUser {
  @PrimaryColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ unique: true })
  username: string;

  @Column({ name: 'password_hash', type: 'text', nullable: true })
  passwordHash: string | null;

  @Column({ default: 'ACTIVE' })
  status: 'ACTIVE' | 'INACTIVE';

  @Column({ name: 'mfa_secret', type: 'text', nullable: true })
  mfaSecret: string | null;

  @Column({ name: 'mfa_enabled', default: false })
  mfaEnabled: boolean;

  @Column({ name: 'pin_hash', type: 'text', nullable: true })
  pinHash: string | null;

  @Column({ name: 'failed_login_count', default: 0 })
  failedLoginCount: number;

  @Column({ name: 'locked_until', type: 'timestamptz', nullable: true })
  lockedUntil: Date | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  /** For an Analyst: the specific Lab In-charge they report to (org-chart
   * metadata only -- RLS/escalation logic still resolves by lab via
   * `user_lab_scope`, not this column). Null for every other role. */
  @Column({ name: 'reports_to_user_id', type: 'uuid', nullable: true })
  reportsToUserId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
