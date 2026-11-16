import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Part 9.2 "In-process cache + device_state table" for live device state
 * (last boot/seq high-water mark, link type, online/offline), and a small
 * device-level event log for events that are not tied to a process attempt
 * (TIME_ANCHOR, DEVICE_REBOOT, NET_FAILOVER/FAILBACK -- Part 7.5/8.4). Alarm
 * and process events continue to use process_event (Part 5) once a process
 * context exists (task 8/9); this table covers device lifecycle events that
 * can happen with no process running at all (e.g. an idle device rebooting).
 */
export class DeviceState1730000000011 implements MigrationInterface {
  name = 'DeviceState1730000000011';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE device_state (
        device_id   uuid PRIMARY KEY REFERENCES device(id),
        boot_id     integer,
        last_seq    integer,
        last_ts     timestamptz,
        last_mono_ms bigint,
        link        text,
        online      boolean NOT NULL DEFAULT false,
        updated_at  timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE device_event (
        id          uuid PRIMARY KEY,
        device_id   uuid NOT NULL REFERENCES device(id),
        boot_id     integer,
        ts          timestamptz NOT NULL DEFAULT now(),
        type        text NOT NULL,
        detail_json jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at  timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(`CREATE INDEX device_event_device_ts_idx ON device_event (device_id, ts DESC);`);

    // migration 010's GRANT ALL ON ALL TABLES ran before these tables existed.
    await queryRunner.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON device_state, device_event TO rmp_app;`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS device_event;`);
    await queryRunner.query(`DROP TABLE IF EXISTS device_state;`);
  }
}
