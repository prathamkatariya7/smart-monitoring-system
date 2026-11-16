import { MigrationInterface, QueryRunner } from 'typeorm';

/** Part 8.5 / 10.2: export_job, report, equipment_status_interval. */
export class ExportsReports1730000000009 implements MigrationInterface {
  name = 'ExportsReports1730000000009';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE export_job (
        id           uuid PRIMARY KEY,
        requested_by uuid NOT NULL REFERENCES app_user(id),
        scope_json   jsonb NOT NULL,
        status       text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RUNNING','DONE','FAILED')),
        file_ref     text,
        sha256       text,
        error        text,
        created_at   timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz
      );
    `);

    await queryRunner.query(`
      CREATE TABLE report (
        id           uuid PRIMARY KEY,
        requested_by uuid NOT NULL REFERENCES app_user(id),
        scope_json   jsonb NOT NULL,
        status       text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RUNNING','DONE','FAILED')),
        file_ref     text,
        sha256       text,
        error        text,
        created_at   timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz
      );
    `);

    await queryRunner.query(`
      CREATE TABLE equipment_status_interval (
        id           uuid PRIMARY KEY,
        equipment_id uuid NOT NULL REFERENCES equipment(id),
        state        text NOT NULL CHECK (state IN ('IDLE','SCHEDULED','RUNNING','PAUSED','OFFLINE','FAULT','MAINTENANCE')),
        from_ts      timestamptz NOT NULL,
        to_ts        timestamptz,
        created_at   timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(`CREATE INDEX equipment_status_interval_eq_idx ON equipment_status_interval (equipment_id, from_ts);`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS equipment_status_interval;`);
    await queryRunner.query(`DROP TABLE IF EXISTS report;`);
    await queryRunner.query(`DROP TABLE IF EXISTS export_job;`);
  }
}
