import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/** Part 10.2: device<->reactor binding history. One open binding per device/equipment (DB-enforced). */
@Entity('device_binding')
export class DeviceBinding {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'device_id' })
  deviceId: string;

  @Column({ name: 'equipment_id' })
  equipmentId: string;

  @Column({ name: 'laboratory_id' })
  laboratoryId: string;

  @Column({ name: 'bound_from', type: 'timestamptz' })
  boundFrom: Date;

  @Column({ name: 'bound_to', type: 'timestamptz', nullable: true })
  boundTo: Date | null;

  @Column({ name: 'bound_by' })
  boundBy: string;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Column({ name: 'replaces_binding_id', type: 'uuid', nullable: true })
  replacesBindingId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
