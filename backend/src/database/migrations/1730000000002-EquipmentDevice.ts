import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Part 10.2: device_profile, equipment (reactor), device, device_binding.
 * RLS applied on equipment.laboratory_id (Part 4). device/device_profile are
 * Admin-only globally (claim/bind/replace/decommission, Part 4) so no RLS;
 * device_binding carries a denormalized laboratory_id (stamped from the
 * bound equipment) so lab-scoped roles can see binding history for their
 * reactors without joining through equipment under RLS.
 */
export class EquipmentDevice1730000000002 implements MigrationInterface {
  name = 'EquipmentDevice1730000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE device_profile (
        id                    uuid PRIMARY KEY,
        name                  text NOT NULL,
        channel_definitions_json jsonb NOT NULL DEFAULT '{}'::jsonb,
        policy_defaults_json  jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at            timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE equipment (
        id             uuid PRIMARY KEY,
        laboratory_id  uuid NOT NULL REFERENCES laboratory(id),
        equipment_type text NOT NULL DEFAULT 'REACTOR',
        reactor_number text NOT NULL,
        display_name   text,
        profile_id     uuid REFERENCES device_profile(id),
        maintenance_mode boolean NOT NULL DEFAULT false,
        status         text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DECOMMISSIONED')),
        created_at     timestamptz NOT NULL DEFAULT now(),
        UNIQUE (laboratory_id, reactor_number)
      );
    `);
    await queryRunner.query(`ALTER TABLE equipment ENABLE ROW LEVEL SECURITY;`);
    await queryRunner.query(`
      CREATE POLICY equipment_lab_isolation ON equipment
      USING (
        current_setting('app.is_admin', true) = 'true'
        OR laboratory_id::text = ANY (string_to_array(current_setting('app.current_laboratory_ids', true), ','))
      );
    `);

    await queryRunner.query(`
      CREATE TABLE device (
        id               uuid PRIMARY KEY,
        serial_no        text NOT NULL UNIQUE,
        hw_revision      text,
        cert_serial      text,
        claim_code       text,
        claim_state      text NOT NULL DEFAULT 'UNBOUND' CHECK (claim_state IN ('UNBOUND','CLAIMED')),
        status           text NOT NULL DEFAULT 'UNBOUND' CHECK (status IN ('UNBOUND','ACTIVE','DECOMMISSIONED')),
        fw_p4            text,
        fw_c6            text,
        dwin_project_ver text,
        last_seen        timestamptz,
        clock_source     text,
        last_ntp_sync    timestamptz,
        created_at       timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE device_binding (
        id                 uuid PRIMARY KEY,
        device_id          uuid NOT NULL REFERENCES device(id),
        equipment_id       uuid NOT NULL REFERENCES equipment(id),
        laboratory_id      uuid NOT NULL REFERENCES laboratory(id),
        bound_from         timestamptz NOT NULL DEFAULT now(),
        bound_to           timestamptz,
        bound_by           uuid NOT NULL REFERENCES app_user(id),
        reason             text,
        replaces_binding_id uuid REFERENCES device_binding(id),
        created_at         timestamptz NOT NULL DEFAULT now()
      );
    `);
    // one open binding per device, and one open binding per equipment (10.2 exclusion rule)
    await queryRunner.query(`
      CREATE UNIQUE INDEX device_binding_open_device_uq
        ON device_binding (device_id) WHERE (bound_to IS NULL);
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX device_binding_open_equipment_uq
        ON device_binding (equipment_id) WHERE (bound_to IS NULL);
    `);
    await queryRunner.query(
      `ALTER TABLE device_binding ENABLE ROW LEVEL SECURITY;`,
    );
    await queryRunner.query(`
      CREATE POLICY device_binding_lab_isolation ON device_binding
      USING (
        current_setting('app.is_admin', true) = 'true'
        OR laboratory_id::text = ANY (string_to_array(current_setting('app.current_laboratory_ids', true), ','))
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS device_binding;`);
    await queryRunner.query(`DROP TABLE IF EXISTS device;`);
    await queryRunner.query(`DROP TABLE IF EXISTS equipment;`);
    await queryRunner.query(`DROP TABLE IF EXISTS device_profile;`);
  }
}
