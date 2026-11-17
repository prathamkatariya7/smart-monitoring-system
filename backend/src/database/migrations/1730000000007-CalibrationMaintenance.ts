import { MigrationInterface, QueryRunner } from 'typeorm';

/** Part 12: calibration_version, maintenance_record. */
export class CalibrationMaintenance1730000000007 implements MigrationInterface {
  name = 'CalibrationMaintenance1730000000007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE calibration_version (
        id                 uuid PRIMARY KEY,
        device_id          uuid NOT NULL REFERENCES device(id),
        equipment_id       uuid NOT NULL REFERENCES equipment(id),
        channel            text NOT NULL,
        method             text NOT NULL CHECK (method IN ('single_point','two_point','multi_point')),
        points_json        jsonb NOT NULL,
        coefficients_json  jsonb NOT NULL,
        previous_version_id uuid REFERENCES calibration_version(id),
        error_summary      jsonb,
        reference_instrument text,
        certificate_no     text,
        certificate_file_ref text,
        calibrated_on      date,
        due_on             date,
        valid_from         timestamptz,
        valid_to           timestamptz,
        status             text NOT NULL DEFAULT 'DRAFT'
          CHECK (status IN ('DRAFT','APPROVED','APPLIED','SUPERSEDED','ROLLED_BACK')),
        entered_by         uuid NOT NULL REFERENCES app_user(id),
        approved_by        uuid REFERENCES app_user(id),
        reason             text,
        device_ack_ts      timestamptz,
        config_version     integer,
        created_at         timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(
      `CREATE INDEX calibration_due_idx ON calibration_version (due_on);`,
    );

    await queryRunner.query(`
      CREATE TABLE maintenance_record (
        id                    uuid PRIMARY KEY,
        equipment_id          uuid NOT NULL REFERENCES equipment(id),
        kind                  text NOT NULL CHECK (kind IN
          ('PREVENTIVE','CORRECTIVE','SENSOR_REPLACEMENT','DEVICE_REPLACEMENT','COMMS_FAULT','EQUIPMENT_FAULT','FIRMWARE_SERVICE')),
        performed_on          date NOT NULL,
        performed_by          uuid NOT NULL REFERENCES app_user(id),
        remarks               text,
        next_due_on           date,
        linked_device_binding_id uuid REFERENCES device_binding(id),
        downtime_start        timestamptz,
        downtime_end          timestamptz,
        created_at            timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(
      `CREATE INDEX maintenance_due_idx ON maintenance_record (next_due_on);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS maintenance_record;`);
    await queryRunner.query(`DROP TABLE IF EXISTS calibration_version;`);
  }
}
