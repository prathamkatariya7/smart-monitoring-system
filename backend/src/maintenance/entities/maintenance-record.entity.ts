import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('maintenance_record')
export class MaintenanceRecord {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'equipment_id' })
  equipmentId: string;

  @Column()
  kind:
    | 'PREVENTIVE'
    | 'CORRECTIVE'
    | 'SENSOR_REPLACEMENT'
    | 'DEVICE_REPLACEMENT'
    | 'COMMS_FAULT'
    | 'EQUIPMENT_FAULT'
    | 'FIRMWARE_SERVICE';

  @Column({ name: 'performed_on', type: 'date' })
  performedOn: string;

  @Column({ name: 'performed_by' })
  performedBy: string;

  @Column({ type: 'text', nullable: true })
  remarks: string | null;

  @Column({ name: 'next_due_on', type: 'date', nullable: true })
  nextDueOn: string | null;

  @Column({ name: 'linked_device_binding_id', type: 'uuid', nullable: true })
  linkedDeviceBindingId: string | null;

  @Column({ name: 'downtime_start', type: 'timestamptz', nullable: true })
  downtimeStart: Date | null;

  @Column({ name: 'downtime_end', type: 'timestamptz', nullable: true })
  downtimeEnd: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
