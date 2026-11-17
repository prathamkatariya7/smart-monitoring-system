import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Part 8.2 command dispatcher: cmd/{name} + ack/cmd correlation tracking, and
 * cfg/desired bundle versioning. Specific command producers (set_thresholds,
 * set_calibration, set_alert_catalog, override_alert...) are added by their
 * owning modules (process lifecycle, calibration, alarms) as those land;
 * this migration only creates the generic tracking tables both will share.
 */
export class CommandDispatcher1730000000012 implements MigrationInterface {
  name = 'CommandDispatcher1730000000012';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE device_command (
        id              uuid PRIMARY KEY,
        device_id       uuid NOT NULL REFERENCES device(id),
        cmd             text NOT NULL,
        payload_json    jsonb NOT NULL DEFAULT '{}'::jsonb,
        status          text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACKED','REJECTED','TIMED_OUT')),
        result_json     jsonb,
        requested_by    uuid REFERENCES app_user(id),
        created_at      timestamptz NOT NULL DEFAULT now(),
        acked_at        timestamptz
      );
    `);
    await queryRunner.query(
      `CREATE INDEX device_command_device_idx ON device_command (device_id, created_at DESC);`,
    );
    await queryRunner.query(`
      CREATE INDEX device_command_pending_idx ON device_command (created_at) WHERE (status = 'PENDING');
    `);

    await queryRunner.query(`
      CREATE TABLE device_config_version (
        id          uuid PRIMARY KEY,
        device_id   uuid NOT NULL REFERENCES device(id),
        version     integer NOT NULL,
        bundle_json jsonb NOT NULL,
        created_at  timestamptz NOT NULL DEFAULT now(),
        UNIQUE (device_id, version)
      );
    `);

    await queryRunner.query(`
      GRANT SELECT, INSERT, UPDATE, DELETE ON device_command, device_config_version TO rmp_app;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS device_config_version;`);
    await queryRunner.query(`DROP TABLE IF EXISTS device_command;`);
  }
}
