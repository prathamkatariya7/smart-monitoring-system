import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * A user's single home lab. Originally designed as a multi-row "explicit
 * cross-lab grant" table (Part 4), but nothing ever wrote more than the
 * home-lab assignment in practice, so `user_id` now carries a unique
 * constraint (migration 1730000000013) and this is treated as one row per
 * scoped user -- reassignable by an Admin via `PATCH /auth/users/:id/lab`,
 * not multi-valued.
 */
@Entity('user_lab_scope')
export class UserLabScope {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ name: 'laboratory_id' })
  laboratoryId: string;

  @Column({ name: 'granted_by' })
  grantedBy: string;

  @CreateDateColumn({ name: 'granted_at' })
  grantedAt: Date;
}
