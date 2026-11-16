import { Column, Entity, PrimaryColumn } from 'typeorm';

/** Admin, Support, Lab In-charge, Analyst, Auditor (Part 4), plus Borosil Admin
 * (platform-vendor role, seeded identically into every deployment -- see
 * seed.ts and licence.controller.ts). Seeded, not user-editable. */
@Entity('role')
export class Role {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ unique: true })
  code: 'ADMIN' | 'SUPPORT' | 'LAB_INCHARGE' | 'ANALYST' | 'AUDITOR' | 'BOROSIL_ADMIN';

  @Column()
  name: string;
}
