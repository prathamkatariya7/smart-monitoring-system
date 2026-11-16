import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Part 10.3: measurement hypertable (TimescaleDB) + data_gap (Part 8.3).
 * RLS on laboratory_id, stamped at ingest from the device_binding (10.3 note).
 * No UPDATE/DELETE grant for the app role on measurement (10.3 rule) — enforced
 * by REVOKE below; inserts only, idempotent via the composite primary key.
 */
export class Measurement1730000000004 implements MigrationInterface {
  name = 'Measurement1730000000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS timescaledb;`);

    await queryRunner.query(`
      CREATE TABLE measurement (
        ts                  timestamptz NOT NULL,
        received_at         timestamptz NOT NULL,
        device_id           uuid NOT NULL,
        equipment_id        uuid NOT NULL,
        laboratory_id       uuid NOT NULL,
        process_id          uuid,
        attempt_id          uuid,
        boot_id             integer NOT NULL,
        seq                 integer NOT NULL,
        mono_ms             bigint,
        ts_original         timestamptz,
        temperature_c       real,
        temperature_raw_c   real,
        rpm                 real,
        torque_ncm          real,
        quality             smallint,
        fault_code          smallint,
        flags               integer NOT NULL DEFAULT 0,
        calibration_version integer,
        fw_version          text,
        batch_id            uuid,
        PRIMARY KEY (device_id, boot_id, seq, ts)
      );
    `);
    await queryRunner.query(`
      SELECT create_hypertable('measurement', 'ts', chunk_time_interval => INTERVAL '1 day');
    `);
    await queryRunner.query(`CREATE INDEX measurement_attempt_ts_idx ON measurement (attempt_id, ts);`);
    await queryRunner.query(`CREATE INDEX measurement_equipment_ts_idx ON measurement (equipment_id, ts DESC);`);

    // RLS must be enabled before compression is turned on -- TimescaleDB
    // refuses ALTER TABLE ... ENABLE ROW LEVEL SECURITY on a hypertable that
    // already has a columnstore/compression policy attached.
    await queryRunner.query(`ALTER TABLE measurement ENABLE ROW LEVEL SECURITY;`);
    await queryRunner.query(`
      CREATE POLICY measurement_lab_isolation ON measurement
      USING (
        current_setting('app.is_admin', true) = 'true'
        OR laboratory_id::text = ANY (string_to_array(current_setting('app.current_laboratory_ids', true), ','))
      );
    `);

    // KNOWN LIMITATION (flagged, not silently dropped): this TimescaleDB
    // version refuses to combine native columnstore compression with
    // row-level security on the same hypertable ("columnstore cannot be
    // used on table with row security"). RLS is the documented enforcement
    // mechanism for laboratory isolation (Part 4), so it wins; compression
    // is deferred. Revisit via either (a) a compressed continuous aggregate
    // behind an RLS-protected view, or (b) moving laboratory isolation to a
    // SECURITY_BARRIER view over an uncompressed-but-RLS-free raw table, once
    // ingest volume actually needs it (Part 10.4 capacity estimate: ~26M
    // rows/day at 300 devices is well within an uncompressed hypertable for
    // the MVP's retention windows).
    //
    // await queryRunner.query(`
    //   ALTER TABLE measurement SET (
    //     timescaledb.compress,
    //     timescaledb.compress_segmentby = 'device_id'
    //   );
    // `);
    // await queryRunner.query(`
    //   SELECT add_compression_policy('measurement', INTERVAL '24 hours');
    // `);

    // 10.3: application role gets INSERT and SELECT only, never UPDATE/DELETE
    await queryRunner.query(`REVOKE UPDATE, DELETE ON measurement FROM rmp_app;`);
    await queryRunner.query(`GRANT INSERT, SELECT ON measurement TO rmp_app;`);

    await queryRunner.query(`
      CREATE TABLE data_gap (
        id          uuid PRIMARY KEY,
        device_id   uuid NOT NULL,
        attempt_id  uuid,
        from_ts     timestamptz NOT NULL,
        to_ts       timestamptz NOT NULL,
        expected_n  integer,
        kind        text NOT NULL CHECK (kind IN ('BUFFER_OVERWRITE','OUTAGE','MISSING_SEQ')),
        detected_at timestamptz NOT NULL DEFAULT now()
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS data_gap;`);
    await queryRunner.query(`DROP TABLE IF EXISTS measurement;`);
  }
}
