import { MigrationInterface, QueryRunner } from 'typeorm';

export class MotorIdentity1730000000014 implements MigrationInterface {
  name = 'MotorIdentity1730000000014';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE device
        ADD COLUMN motor_manufacturer text,
        ADD COLUMN motor_model text,
        ADD COLUMN motor_protocol text,
        ADD COLUMN motor_serial_no text,
        ADD COLUMN motor_detected_at timestamptz;
    `);
    await queryRunner.query(`
      CREATE TABLE device_motor_identity (
        id uuid PRIMARY KEY,
        device_id uuid NOT NULL REFERENCES device(id),
        manufacturer text NOT NULL,
        model text NOT NULL,
        protocol text NOT NULL,
        serial_no text NOT NULL DEFAULT '',
        first_seen timestamptz NOT NULL,
        last_seen timestamptz NOT NULL,
        observation_count integer NOT NULL DEFAULT 1 CHECK (observation_count > 0),
        raw_identity jsonb NOT NULL DEFAULT '{}'::jsonb,
        UNIQUE (device_id, manufacturer, model, protocol, serial_no)
      );
    `);
    await queryRunner.query(`
      CREATE INDEX device_motor_identity_device_idx
        ON device_motor_identity (device_id, last_seen DESC);
    `);
    await queryRunner.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON device_motor_identity TO rmp_app;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS device_motor_identity;`);
    await queryRunner.query(`ALTER TABLE device
      DROP COLUMN IF EXISTS motor_detected_at,
      DROP COLUMN IF EXISTS motor_serial_no,
      DROP COLUMN IF EXISTS motor_protocol,
      DROP COLUMN IF EXISTS motor_model,
      DROP COLUMN IF EXISTS motor_manufacturer;`);
  }
}
