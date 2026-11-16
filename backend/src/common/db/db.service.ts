import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { RlsContext, rlsStorage } from './request-context';

/**
 * Opens a transaction, sets the RLS GUCs, runs `fn` inside it with the
 * AsyncLocalStorage populated, and commits/rolls back. Used by:
 *  - RlsInterceptor for every HTTP/WS request (role-scoped)
 *  - background workers (MQTT ingestion, schedulers) that need an admin-level
 *    context because they are not acting on behalf of a single lab-scoped user
 */
@Injectable()
export class Db {
  constructor(private readonly dataSource: DataSource) {}

  async runInContext<T>(
    ctx: { isAdmin: boolean; laboratoryIds: string[]; userId?: string },
    fn: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      // SET LOCAL does not accept bind parameters, so values are validated and
      // inlined here rather than passed as $1/$2 (Postgres syntax restriction,
      // not a workaround for injection -- both values are strictly validated).
      const isAdminLiteral = ctx.isAdmin ? 'true' : 'false';
      const uuidPattern = /^[0-9a-fA-F-]{36}$/;
      const safeLabIds = ctx.laboratoryIds.filter((id) => uuidPattern.test(id));
      if (safeLabIds.length !== ctx.laboratoryIds.length) {
        throw new Error('Invalid laboratory id encountered while building RLS context');
      }
      await queryRunner.query(`SET LOCAL app.is_admin = '${isAdminLiteral}'`);
      await queryRunner.query(`SET LOCAL app.current_laboratory_ids = '${safeLabIds.join(',')}'`);
      const rlsCtx: RlsContext = {
        manager: queryRunner.manager,
        isAdmin: ctx.isAdmin,
        laboratoryIds: ctx.laboratoryIds,
        userId: ctx.userId,
      };
      const result = await rlsStorage.run(rlsCtx, () => fn(queryRunner.manager));
      await queryRunner.commitTransaction();
      return result;
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  /** For system/background jobs with no single acting user (ingestion worker, schedulers). */
  runAsAdmin<T>(fn: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.runInContext({ isAdmin: true, laboratoryIds: [] }, fn);
  }
}
