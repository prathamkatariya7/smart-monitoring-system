import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Repurposes `user_lab_scope` from "multi-lab explicit grant" (designed in
 * the original Part 4 spec but never actually written to by any code path)
 * into "single home lab per user" -- a Lab In-charge/Analyst is assigned to
 * exactly one lab at creation time, reassignable later by an Admin. Also
 * adds `app_user.reports_to_user_id` so an Analyst's specific Lab In-charge
 * can be captured (org-chart metadata; does not change RLS/escalation
 * logic, which already resolves by lab via `user_lab_scope`).
 */
export class UserLabHierarchy1730000000013 implements MigrationInterface {
  name = 'UserLabHierarchy1730000000013';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE user_lab_scope ADD CONSTRAINT user_lab_scope_user_id_key UNIQUE (user_id);
    `);
    await queryRunner.query(`
      ALTER TABLE app_user ADD COLUMN reports_to_user_id uuid NULL REFERENCES app_user(id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE app_user DROP COLUMN IF EXISTS reports_to_user_id;`);
    await queryRunner.query(
      `ALTER TABLE user_lab_scope DROP CONSTRAINT IF EXISTS user_lab_scope_user_id_key;`,
    );
  }
}
