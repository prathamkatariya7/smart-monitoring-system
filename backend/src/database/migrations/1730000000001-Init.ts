import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Part 10.2 foundation tables: client, feature_switch, site, laboratory,
 * app_user, role/permission/user_role, user_lab_scope.
 * Row-level security key is laboratory_id (Part 4 enforcement rule, Part 10.2).
 * RLS model: a Postgres role `rmp_app` runs all app queries. Each request sets
 * two session GUCs via `SET LOCAL` inside the request transaction:
 *   app.is_admin               ('true' | 'false')
 *   app.current_laboratory_ids (comma-separated laboratory UUIDs the caller may read)
 * Tables below laboratory in the hierarchy carry laboratory_id and get a
 * policy; client/site/app_user/role tables are global and are protected at
 * the application layer only (Admin-gated), consistent with Part 3.1.
 */
export class Init1730000000001 implements MigrationInterface {
  name = 'Init1730000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

    // ---- client (single row per install, Part 10.2) ----
    await queryRunner.query(`
      CREATE TABLE client (
        id            uuid PRIMARY KEY,
        name          text NOT NULL,
        edition       text NOT NULL CHECK (edition IN ('solo','team','enterprise')),
        policy_pack   text NOT NULL CHECK (policy_pack IN ('flexible','standard','regulated')),
        terminology_json jsonb NOT NULL DEFAULT '{}'::jsonb,
        status        text NOT NULL DEFAULT 'ACTIVE',
        created_at    timestamptz NOT NULL DEFAULT now()
      );
    `);

    // ---- feature_switch (3.6, audited) ----
    await queryRunner.query(`
      CREATE TABLE feature_switch (
        key          text PRIMARY KEY,
        value        boolean NOT NULL,
        changed_by   uuid,
        changed_at   timestamptz NOT NULL DEFAULT now(),
        reason       text,
        created_at   timestamptz NOT NULL DEFAULT now()
      );
    `);

    // ---- site ----
    await queryRunner.query(`
      CREATE TABLE site (
        id          uuid PRIMARY KEY,
        client_id   uuid NOT NULL REFERENCES client(id),
        name        text NOT NULL,
        time_zone   text NOT NULL DEFAULT 'UTC',
        created_at  timestamptz NOT NULL DEFAULT now()
      );
    `);

    // ---- laboratory ----
    await queryRunner.query(`
      CREATE TABLE laboratory (
        id          uuid PRIMARY KEY,
        site_id     uuid NOT NULL REFERENCES site(id),
        name        text NOT NULL,
        code        text,
        created_at  timestamptz NOT NULL DEFAULT now(),
        UNIQUE (site_id, name)
      );
    `);
    await queryRunner.query(
      `ALTER TABLE laboratory ENABLE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(`
      CREATE POLICY laboratory_scope_isolation ON laboratory
      USING (
        current_setting('app.is_admin', true) = 'true'
        OR id::text = ANY (string_to_array(current_setting('app.current_laboratory_ids', true), ','))
      );
    `);

    // ---- app_user ----
    await queryRunner.query(`
      CREATE TABLE app_user (
        id          uuid PRIMARY KEY,
        name        text NOT NULL,
        username    text NOT NULL UNIQUE,
        password_hash text,
        status      text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
        mfa_secret  text,
        mfa_enabled boolean NOT NULL DEFAULT false,
        pin_hash    text,
        failed_login_count smallint NOT NULL DEFAULT 0,
        locked_until timestamptz,
        created_by  uuid,
        created_at  timestamptz NOT NULL DEFAULT now()
      );
    `);

    // ---- role / permission (seeded, not user-editable) ----
    await queryRunner.query(`
      CREATE TABLE role (
        id    uuid PRIMARY KEY,
        code  text NOT NULL UNIQUE,
        name  text NOT NULL
      );
    `);
    await queryRunner.query(`
      CREATE TABLE permission (
        id    uuid PRIMARY KEY,
        code  text NOT NULL UNIQUE,
        description text
      );
    `);
    await queryRunner.query(`
      CREATE TABLE role_permission (
        role_id       uuid NOT NULL REFERENCES role(id) ON DELETE CASCADE,
        permission_id uuid NOT NULL REFERENCES permission(id) ON DELETE CASCADE,
        PRIMARY KEY (role_id, permission_id)
      );
    `);
    await queryRunner.query(`
      CREATE TABLE user_role (
        user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
        role_id uuid NOT NULL REFERENCES role(id) ON DELETE CASCADE,
        PRIMARY KEY (user_id, role_id)
      );
    `);

    // ---- user_lab_scope (explicit, audited cross-lab grant; Part 4 enforcement) ----
    await queryRunner.query(`
      CREATE TABLE user_lab_scope (
        id             uuid PRIMARY KEY,
        user_id        uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
        laboratory_id  uuid NOT NULL REFERENCES laboratory(id) ON DELETE CASCADE,
        granted_by     uuid NOT NULL REFERENCES app_user(id),
        granted_at     timestamptz NOT NULL DEFAULT now(),
        UNIQUE (user_id, laboratory_id)
      );
    `);

    // ---- app DB role used by the running application (least privilege) ----
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rmp_app') THEN
          CREATE ROLE rmp_app LOGIN;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS user_lab_scope;`);
    await queryRunner.query(`DROP TABLE IF EXISTS user_role;`);
    await queryRunner.query(`DROP TABLE IF EXISTS role_permission;`);
    await queryRunner.query(`DROP TABLE IF EXISTS permission;`);
    await queryRunner.query(`DROP TABLE IF EXISTS role;`);
    await queryRunner.query(`DROP TABLE IF EXISTS app_user;`);
    await queryRunner.query(`DROP TABLE IF EXISTS laboratory;`);
    await queryRunner.query(`DROP TABLE IF EXISTS site;`);
    await queryRunner.query(`DROP TABLE IF EXISTS feature_switch;`);
    await queryRunner.query(`DROP TABLE IF EXISTS client;`);
  }
}
