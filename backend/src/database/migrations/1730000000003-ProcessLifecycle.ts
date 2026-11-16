import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Part 5 / 10.2 process lifecycle tables. RLS key is laboratory_id; process
 * carries it directly (stamped from equipment at creation). Dependent tables
 * (process_attempt, process_assignment, ownership_history, handover,
 * threshold_version, process_event) are scoped via an EXISTS subquery against
 * process, since they do not duplicate laboratory_id in the TDD's model.
 */
export class ProcessLifecycle1730000000003 implements MigrationInterface {
  name = 'ProcessLifecycle1730000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS btree_gist;`);

    await queryRunner.query(`
      CREATE TABLE process (
        id                   uuid PRIMARY KEY,
        equipment_id         uuid NOT NULL REFERENCES equipment(id),
        laboratory_id        uuid NOT NULL REFERENCES laboratory(id),
        name                 text NOT NULL,
        description          text,
        planned_start_utc    timestamptz NOT NULL,
        planned_duration_s   integer NOT NULL,
        duration_unit_display text NOT NULL DEFAULT 'hours',
        planned_end_utc      timestamptz NOT NULL,
        status               text NOT NULL DEFAULT 'SCHEDULED'
          CHECK (status IN ('SCHEDULED','ACCEPTED','RUNNING','PAUSED','AWAITING_COMPLETION','COMPLETED','CANCELLED','ABORTED')),
        quick_run            boolean NOT NULL DEFAULT false,
        created_by           uuid NOT NULL REFERENCES app_user(id),
        remarks              text,
        created_at           timestamptz NOT NULL DEFAULT now()
      );
    `);
    // C-19/5.3: reject overlapping non-terminal processes on the same reactor
    await queryRunner.query(`
      ALTER TABLE process ADD COLUMN planned_range tstzrange
        GENERATED ALWAYS AS (tstzrange(planned_start_utc, planned_end_utc, '[)')) STORED;
    `);
    await queryRunner.query(`
      ALTER TABLE process ADD CONSTRAINT process_no_overlap
        EXCLUDE USING gist (
          equipment_id WITH =,
          planned_range WITH &&
        ) WHERE (status NOT IN ('CANCELLED','ABORTED','COMPLETED'));
    `);
    await queryRunner.query(`ALTER TABLE process ENABLE ROW LEVEL SECURITY;`);
    await queryRunner.query(`
      CREATE POLICY process_lab_isolation ON process
      USING (
        current_setting('app.is_admin', true) = 'true'
        OR laboratory_id::text = ANY (string_to_array(current_setting('app.current_laboratory_ids', true), ','))
      );
    `);

    await queryRunner.query(`
      CREATE TABLE process_attempt (
        id              uuid PRIMARY KEY,
        process_id      uuid NOT NULL REFERENCES process(id),
        attempt_no      integer NOT NULL,
        previous_attempt_id uuid REFERENCES process_attempt(id),
        start_ts        timestamptz,
        end_ts          timestamptz,
        planned_end_ts  timestamptz,
        active_elapsed_s integer NOT NULL DEFAULT 0,
        end_reason      text,
        status          text NOT NULL DEFAULT 'PENDING',
        created_at      timestamptz NOT NULL DEFAULT now(),
        UNIQUE (process_id, attempt_no)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE process_assignment (
        id            uuid PRIMARY KEY,
        process_id    uuid NOT NULL REFERENCES process(id),
        user_id       uuid NOT NULL REFERENCES app_user(id),
        role          text NOT NULL CHECK (role IN ('PLANNED_OPERATOR','OWNER')),
        status        text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACCEPTED','REJECTED','RELEASED')),
        responded_at  timestamptz,
        reject_reason text,
        created_at    timestamptz NOT NULL DEFAULT now()
      );
    `);
    // C-02 / Part 5.1: exactly one active OWNER per process at a time
    await queryRunner.query(`
      CREATE UNIQUE INDEX process_assignment_one_owner_uq
        ON process_assignment (process_id) WHERE (role = 'OWNER' AND status = 'ACCEPTED');
    `);

    await queryRunner.query(`
      CREATE TABLE ownership_history (
        id            uuid PRIMARY KEY,
        attempt_id    uuid NOT NULL REFERENCES process_attempt(id),
        owner_user_id uuid NOT NULL REFERENCES app_user(id),
        from_ts       timestamptz NOT NULL DEFAULT now(),
        to_ts         timestamptz,
        reason        text,
        handover_id   uuid,
        created_at    timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE handover (
        id             uuid PRIMARY KEY,
        attempt_id     uuid NOT NULL REFERENCES process_attempt(id),
        from_user      uuid NOT NULL REFERENCES app_user(id),
        to_user        uuid NOT NULL REFERENCES app_user(id),
        requested_by   uuid NOT NULL REFERENCES app_user(id),
        requested_at   timestamptz NOT NULL DEFAULT now(),
        acknowledged_at timestamptz,
        mode           text CHECK (mode IN ('ACK','OVERRIDE')),
        reason         text NOT NULL,
        process_state  text,
        remaining_s    integer,
        snapshot_json  jsonb,
        created_at     timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE threshold_version (
        id           uuid PRIMARY KEY,
        process_id   uuid NOT NULL REFERENCES process(id),
        version_no   integer NOT NULL,
        status       text NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('APPROVED','PROPOSED','SUPERSEDED','REJECTED')),
        params_json  jsonb NOT NULL,
        proposed_by  uuid NOT NULL REFERENCES app_user(id),
        approved_by  uuid REFERENCES app_user(id),
        reason       text,
        created_at   timestamptz NOT NULL DEFAULT now(),
        UNIQUE (process_id, version_no)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE process_event (
        id             uuid PRIMARY KEY,
        attempt_id     uuid NOT NULL REFERENCES process_attempt(id),
        ts             timestamptz NOT NULL DEFAULT now(),
        type           text NOT NULL,
        actor_user_id  uuid REFERENCES app_user(id),
        actor_device_id uuid REFERENCES device(id),
        detail_json    jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at     timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(`CREATE INDEX process_event_attempt_ts_idx ON process_event (attempt_id, ts);`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS process_event;`);
    await queryRunner.query(`DROP TABLE IF EXISTS threshold_version;`);
    await queryRunner.query(`DROP TABLE IF EXISTS handover;`);
    await queryRunner.query(`DROP TABLE IF EXISTS ownership_history;`);
    await queryRunner.query(`DROP TABLE IF EXISTS process_assignment;`);
    await queryRunner.query(`DROP TABLE IF EXISTS process_attempt;`);
    await queryRunner.query(`DROP TABLE IF EXISTS process;`);
  }
}
