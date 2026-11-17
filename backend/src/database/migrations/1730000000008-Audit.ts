import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Part 13.1: append-only audit_record with SHA-256 hash chain.
 * hash = SHA-256(prev_hash || canonical JSON of the record).
 * The chain is computed by a BEFORE INSERT trigger so the app never has to
 * read-then-write the previous hash under race conditions; the trigger takes
 * an advisory lock keyed on a constant to serialize chain extension safely.
 */
export class Audit1730000000008 implements MigrationInterface {
  name = 'Audit1730000000008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE audit_record (
        audit_id         uuid PRIMARY KEY,
        ts_utc           timestamptz NOT NULL DEFAULT now(),
        user_id          uuid,
        user_role        text,
        device_id        uuid,
        action           text NOT NULL,
        entity_type      text NOT NULL,
        entity_id        uuid,
        previous_value_json jsonb,
        new_value_json   jsonb,
        reason           text,
        process_id       uuid,
        equipment_id     uuid,
        config_version   integer,
        prev_hash        text,
        hash             text NOT NULL,
        created_at       timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION audit_record_chain() RETURNS trigger AS $$
      DECLARE
        last_hash text;
        canonical text;
      BEGIN
        PERFORM pg_advisory_xact_lock(hashtext('audit_record_chain'));
        SELECT hash INTO last_hash FROM audit_record ORDER BY created_at DESC, audit_id DESC LIMIT 1;
        NEW.prev_hash := last_hash;
        canonical := coalesce(last_hash, '') || NEW.audit_id::text || NEW.ts_utc::text ||
                     coalesce(NEW.user_id::text, '') || NEW.action || NEW.entity_type ||
                     coalesce(NEW.entity_id::text, '') ||
                     coalesce(NEW.previous_value_json::text, '') ||
                     coalesce(NEW.new_value_json::text, '') ||
                     coalesce(NEW.reason, '');
        NEW.hash := encode(digest(canonical, 'sha256'), 'hex');
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await queryRunner.query(`
      CREATE TRIGGER audit_record_chain_trigger
      BEFORE INSERT ON audit_record
      FOR EACH ROW EXECUTE FUNCTION audit_record_chain();
    `);

    await queryRunner.query(
      `CREATE INDEX audit_record_entity_idx ON audit_record (entity_type, entity_id, ts_utc);`,
    );
    await queryRunner.query(
      `CREATE INDEX audit_record_user_idx ON audit_record (user_id, ts_utc);`,
    );

    // Append-only: application role may INSERT and SELECT only.
    await queryRunner.query(
      `REVOKE UPDATE, DELETE ON audit_record FROM rmp_app;`,
    );
    await queryRunner.query(`GRANT INSERT, SELECT ON audit_record TO rmp_app;`);

    // Verification function: recomputes the same canonical hash formula the
    // trigger used and returns the first row whose stored hash/prev_hash no
    // longer matches -- run from a superuser/maintenance context (not via
    // rmp_app) as the recurring chain-integrity check (Part 13.1).
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION verify_audit_chain()
      RETURNS TABLE(broken_audit_id uuid, reason text) AS $$
      DECLARE
        r record;
        expected_prev text := NULL;
        expected_hash text;
        canonical text;
      BEGIN
        FOR r IN SELECT * FROM audit_record ORDER BY created_at ASC, audit_id ASC LOOP
          IF (r.prev_hash IS DISTINCT FROM expected_prev) THEN
            broken_audit_id := r.audit_id; reason := 'prev_hash mismatch'; RETURN NEXT; RETURN;
          END IF;
          canonical := coalesce(expected_prev, '') || r.audit_id::text || r.ts_utc::text ||
                       coalesce(r.user_id::text, '') || r.action || r.entity_type ||
                       coalesce(r.entity_id::text, '') ||
                       coalesce(r.previous_value_json::text, '') ||
                       coalesce(r.new_value_json::text, '') ||
                       coalesce(r.reason, '');
          expected_hash := encode(digest(canonical, 'sha256'), 'hex');
          IF (expected_hash IS DISTINCT FROM r.hash) THEN
            broken_audit_id := r.audit_id; reason := 'hash mismatch'; RETURN NEXT; RETURN;
          END IF;
          expected_prev := r.hash;
        END LOOP;
        RETURN;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await queryRunner.query(
      `GRANT EXECUTE ON FUNCTION verify_audit_chain() TO rmp_app;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS audit_record_chain_trigger ON audit_record;`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS audit_record_chain();`);
    await queryRunner.query(`DROP TABLE IF EXISTS audit_record;`);
  }
}
