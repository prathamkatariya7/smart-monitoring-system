import { v7 as uuidv7 } from 'uuid';

/** All primary keys are UUIDv7 (Part 10.2) for roughly-sortable, time-ordered ids. */
export function newId(): string {
  return uuidv7();
}
