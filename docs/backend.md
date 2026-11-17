# Backend guide

## Responsibilities

The NestJS backend owns authentication, authorization, lab/equipment/device scope, MQTT ingestion, telemetry persistence, alarm and process APIs, licensing, backups, migrations and realtime notifications.

## Important modules

- `src/auth/` — login, JWT guards, roles, MFA and user scope.
- `src/database/` — TypeORM data source, migrations, seeds and database context.
- `src/mqtt/` — broker connection, topic parsing, payload validation and ingestion.
- `src/devices/` — device records, claims, current state and motor identity history.
- `src/notifications/` — Socket.IO realtime events.
- `src/alarms/`, `src/processes/`, `src/calibrations/` — regulated workflow domains.

## Motor persistence contract

`DeviceStatePayload.motor` contains `detected`, `manufacturer`, `model`, `protocol` and optional `serial`. The backend validates the required identity fields before persistence. Current fields live on `device`; historical observations live in `device_motor_identity`. The migration is `1730000000014-MotorIdentity`.

Do not update the current identity from browser input. Only authenticated MQTT ingestion or an approved commissioning workflow may establish device motor identity.

## Database rules

- Add schema changes through a timestamped migration; never rely on `synchronize` in production.
- Keep migrations reversible where practical and test them against a disposable database.
- Use tenant/lab scope helpers for every user-facing query.
- Treat audit records as append-only.
- Keep generated SQL and build output out of Git.

## Commands

```bash
npm ci
npm run typecheck
npm run build
npm run lint -- --max-warnings=0
npm test -- --runInBand
npm run migration:run
```

Production secrets, licence files and certificates are environment-specific and must never be committed. See [`security.md`](security.md) and [`testing.md`](testing.md).
