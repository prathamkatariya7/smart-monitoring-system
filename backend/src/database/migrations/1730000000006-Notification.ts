import { MigrationInterface, QueryRunner } from 'typeorm';

/** Part 6.6 / 10.2: notification (in-app only, no e-mail). */
export class Notification1730000000006 implements MigrationInterface {
  name = 'Notification1730000000006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE notification (
        id            uuid PRIMARY KEY,
        user_id       uuid NOT NULL REFERENCES app_user(id),
        type          text NOT NULL,
        priority      text NOT NULL CHECK (priority IN ('NORMAL','HIGH')),
        payload_json  jsonb NOT NULL DEFAULT '{}'::jsonb,
        ref_entity    text,
        ref_id        uuid,
        laboratory_id uuid REFERENCES laboratory(id),
        created_at    timestamptz NOT NULL DEFAULT now(),
        delivered_at  timestamptz,
        seen_at       timestamptz,
        acted_at      timestamptz,
        escalated_at  timestamptz,
        escalated_to  uuid REFERENCES app_user(id)
      );
    `);
    await queryRunner.query(
      `CREATE INDEX notification_user_created_idx ON notification (user_id, created_at DESC);`,
    );
    await queryRunner.query(`
      CREATE INDEX notification_unseen_high_idx ON notification (laboratory_id)
        WHERE (priority = 'HIGH' AND seen_at IS NULL);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS notification;`);
  }
}
