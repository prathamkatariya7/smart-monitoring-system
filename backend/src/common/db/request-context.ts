import { AsyncLocalStorage } from 'async_hooks';
import { EntityManager } from 'typeorm';

/**
 * Part 4 enforcement rule: "Authorisation is checked in the API policy layer
 * AND by PostgreSQL row-level security on laboratory_id." This module is the
 * glue that makes the second half real: every request (HTTP, WebSocket, or
 * MQTT-triggered background work) runs its DB work inside a transaction that
 * has first set two session GUCs (app.is_admin, app.current_laboratory_ids),
 * and all repository access goes through the EntityManager captured here —
 * never through a plain @InjectRepository on the global pool — so RLS always
 * applies to roles other than Admin.
 */
export interface RlsContext {
  manager: EntityManager;
  isAdmin: boolean;
  laboratoryIds: string[];
  userId?: string;
}

export const rlsStorage = new AsyncLocalStorage<RlsContext>();

export function currentRlsContext(): RlsContext {
  const ctx = rlsStorage.getStore();
  if (!ctx) {
    throw new Error(
      'No RLS context on this call stack. Every DB access must happen inside ' +
        'RlsInterceptor (HTTP/WS) or Db.runAsAdmin/runAsUser (background jobs).',
    );
  }
  return ctx;
}

export function currentManager(): EntityManager {
  return currentRlsContext().manager;
}
