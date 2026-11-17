import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Baseline privilege grants for the least-privilege `rmp_app` role used by
 * the running application (Part 9.11 security baseline). Measurement and
 * audit_record already have their own restricted grants (append-only /
 * insert-only) from earlier migrations; this covers every other table with
 * normal CRUD as enforced by the API/service layer and RLS policies.
 */
export class Grants1730000000010 implements MigrationInterface {
  name = 'Grants1730000000010';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`GRANT USAGE ON SCHEMA public TO rmp_app;`);
    await queryRunner.query(`
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rmp_app;
    `);
    // re-apply the stricter grants (table-level GRANT ALL above would otherwise widen them back)
    await queryRunner.query(
      `REVOKE UPDATE, DELETE ON measurement FROM rmp_app;`,
    );
    await queryRunner.query(
      `REVOKE UPDATE, DELETE ON audit_record FROM rmp_app;`,
    );
    await queryRunner.query(`
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO rmp_app;
    `);
  }

  public async down(): Promise<void> {
    // intentionally left as a no-op: narrowing a running role's grants on down()
    // is out of scope for a destructive rollback of this migration.
  }
}
