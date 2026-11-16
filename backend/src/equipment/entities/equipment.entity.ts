import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/** Part 3.1/10.2: the reactor. Permanent identity; never deleted, only DECOMMISSIONED. */
@Entity('equipment')
export class Equipment {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'laboratory_id' })
  laboratoryId: string;

  @Column({ name: 'equipment_type', default: 'REACTOR' })
  equipmentType: string;

  @Column({ name: 'reactor_number' })
  reactorNumber: string;

  @Column({ name: 'display_name', type: 'text', nullable: true })
  displayName: string | null;

  @Column({ name: 'profile_id', type: 'uuid', nullable: true })
  profileId: string | null;

  @Column({ name: 'maintenance_mode', default: false })
  maintenanceMode: boolean;

  @Column({ default: 'ACTIVE' })
  status: 'ACTIVE' | 'DECOMMISSIONED';

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
