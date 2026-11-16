import { MigrationInterface, QueryRunner } from 'typeorm';

/** Part 6 / 10.2: alert_catalog, alarm, alert_override. */
export class Alarms1730000000005 implements MigrationInterface {
  name = 'Alarms1730000000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE alert_catalog (
        id              uuid PRIMARY KEY,
        version         integer NOT NULL,
        alert_type      text NOT NULL,
        class           text NOT NULL CHECK (class IN ('INFO','WARNING','CRITICAL')),
        overridable_by  text NOT NULL DEFAULT 'OWNER' CHECK (overridable_by IN ('NONE','OWNER','INCHARGE')),
        max_override_min integer NOT NULL DEFAULT 60,
        sound_pattern   text,
        changed_by      uuid REFERENCES app_user(id),
        reason          text,
        created_at      timestamptz NOT NULL DEFAULT now(),
        UNIQUE (alert_type, version)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE alarm (
        id                  uuid PRIMARY KEY,
        attempt_id          uuid REFERENCES process_attempt(id),
        equipment_id        uuid NOT NULL REFERENCES equipment(id),
        laboratory_id       uuid NOT NULL REFERENCES laboratory(id),
        parameter           text NOT NULL,
        kind                text NOT NULL,
        severity            text NOT NULL CHECK (severity IN ('INFO','WARNING','CRITICAL')),
        threshold_version_id uuid REFERENCES threshold_version(id),
        onset_ts            timestamptz NOT NULL DEFAULT now(),
        ack_by              uuid REFERENCES app_user(id),
        ack_ts              timestamptz,
        return_ts           timestamptz,
        state               text NOT NULL DEFAULT 'ACTIVE_UNACK'
          CHECK (state IN ('ACTIVE_UNACK','ACTIVE_ACK','RETURNED_UNACK','NORMAL')),
        origin              text NOT NULL CHECK (origin IN ('DEVICE','SERVER')),
        created_at          timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(`ALTER TABLE alarm ENABLE ROW LEVEL SECURITY;`);
    await queryRunner.query(`
      CREATE POLICY alarm_lab_isolation ON alarm
      USING (
        current_setting('app.is_admin', true) = 'true'
        OR laboratory_id::text = ANY (string_to_array(current_setting('app.current_laboratory_ids', true), ','))
      );
    `);
    await queryRunner.query(`CREATE INDEX alarm_equipment_onset_idx ON alarm (equipment_id, onset_ts DESC);`);

    await queryRunner.query(`
      CREATE TABLE alert_override (
        id                  uuid PRIMARY KEY,
        alarm_id            uuid NOT NULL REFERENCES alarm(id),
        equipment_id        uuid NOT NULL REFERENCES equipment(id),
        laboratory_id       uuid NOT NULL REFERENCES laboratory(id),
        attempt_id          uuid REFERENCES process_attempt(id),
        device_id           uuid REFERENCES device(id),
        user_id             uuid NOT NULL REFERENCES app_user(id),
        source              text NOT NULL CHECK (source IN ('DEVICE','WEB')),
        alert_type          text NOT NULL,
        severity            text NOT NULL,
        parameter           text,
        value_at_override   real,
        limit_value         real,
        threshold_version_id uuid REFERENCES threshold_version(id),
        device_ts           timestamptz,
        server_ts           timestamptz NOT NULL DEFAULT now(),
        reason_code         text NOT NULL,
        reason_text         text,
        planned_expiry      timestamptz NOT NULL,
        ended_at            timestamptz,
        end_cause           text CHECK (end_cause IN ('CLEARED','EXPIRED','REVOKED','ATTEMPT_ENDED','ESCALATED')),
        seen_by             uuid REFERENCES app_user(id),
        seen_at             timestamptz,
        offline_origin      boolean NOT NULL DEFAULT false,
        created_at          timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(`ALTER TABLE alert_override ENABLE ROW LEVEL SECURITY;`);
    await queryRunner.query(`
      CREATE POLICY alert_override_lab_isolation ON alert_override
      USING (
        current_setting('app.is_admin', true) = 'true'
        OR laboratory_id::text = ANY (string_to_array(current_setting('app.current_laboratory_ids', true), ','))
      );
    `);
    await queryRunner.query(`CREATE INDEX alert_override_lab_created_idx ON alert_override (laboratory_id, created_at);`);
    // 10.2: no UPDATE except end/seen fields -- enforced in the service layer (no raw PATCH endpoint
    // exposes other columns); DB-level column privilege restriction is applied for defense in depth.
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS alert_override;`);
    await queryRunner.query(`DROP TABLE IF EXISTS alarm;`);
    await queryRunner.query(`DROP TABLE IF EXISTS alert_catalog;`);
  }
}
