# Reactor Monitoring Platform — System Architecture

**Audience:** anyone picking up this project — new backend/frontend
contributors, the firmware team, the DWIN HMI team, and future maintainers.
**Status:** describes the system as actually built and verified, as of
2026-11-08. This is the single reference to cross-check any new work
(firmware, HMI, frontend, backend) against.

This document is the "big picture" — component map, data flow, deployment
topology, and security model. It deliberately does **not** repeat the wire
protocol detail already covered elsewhere:
- Device ⇄ server MQTT contract → [`firmware-integration-guide.md`](./firmware-integration-guide.md)
- On-device HMI data/interaction mapping → [`dwin-hmi-ui-guide.md`](./dwin-hmi-ui-guide.md)
- Licence lifecycle (issue/activate/deactivate/change) → [`licence-management-guide.md`](./licence-management-guide.md)
- Manual frontend QA script → [`frontend-manual-test-guide.md`](./frontend-manual-test-guide.md)

---

## 1. What this system is

Borosil Scientific's **Reactor Monitoring Platform (RMP)**: each physical
reactor has an ESP32-P4 + ESP32-C6 control box with a DWIN touch display,
reporting live process telemetry (temperature, RPM, torque, quality flags)
to a **locally-hosted, no-cloud** server. A web app lets lab staff monitor
reactors in real time, run process "attempts" (recipe runs) with
assignment/approval workflows, manage alarms and overrides, and administer
sites/labs/devices/licensing.

**Zero-cost constraint:** every component is free/open-source and
self-hosted via Docker Desktop — no SaaS, no cloud spend, ever.

---

## 2. Component map

```
┌─────────────┐        mTLS/MQTT5         ┌──────────────────┐
│  ESP32-P4/C6│ ───────────────────────── │   Mosquitto 2.x   │
│  + DWIN HMI │  rmp/v1/{deviceId}/...    │  (MQTT broker)    │
└─────────────┘                            └─────────┬────────┘
                                                      │ TCP (internal, app
                                                      │ is also an MQTT client)
                                                      ▼
┌─────────────┐   HTTPS (reverse proxy)   ┌──────────────────┐
│   Browser   │ ───────────────────────── │      Caddy        │
│ (React SPA) │   /, /api/v1/*, /health,  │ (TLS + reverse    │
└─────────────┘   /socket.io/*            │  proxy)           │
                                            └─────────┬────────┘
                                                      ▼
                                            ┌──────────────────┐
                                            │   NestJS "app"    │
                                            │  (backend, :3000) │
                                            └─────────┬────────┘
                                                      │ SQL (RLS-scoped)
                                                      ▼
                                            ┌──────────────────┐
                                            │ PostgreSQL 16 +   │
                                            │   TimescaleDB     │
                                            └──────────────────┘
```

All four services run as Docker Compose containers on one host
(`docker-compose.yml` at the repo root): `postgres`, `mosquitto`, `app`,
`caddy`. Nothing leaves the host network except whatever a user's browser
or a device on the LAN connects in on.

### 2.1 Backend (`backend/`, NestJS + TypeScript, strict mode)

One module per domain, each following the same pattern (service +
controller + TypeORM entities):

| Module | Responsibility |
|---|---|
| `auth/` | Argon2id password hashing, TOTP MFA (otplib), JWT access/refresh, roles + per-user lab scopes, user creation + password reset (with Borosil-Admin privilege-escalation guards) |
| `tenancy/` | Sites, laboratories, feature switches |
| `devices/` | Device registry, claim/bind/unbind/decommission, command dispatch, `cfg/desired` push |
| `equipment/` | Reactor ("equipment") records, device↔reactor binding |
| `mqtt/` | `MqttClientService` (mTLS client), `IngestionService` (batch ingest + gap detection), command dispatcher, `cfg/desired` builder |
| `measurements/` | Live/recent measurement reads for the frontend |
| `processes/` | Process attempt state machine (create → assign → start → pause/resume → complete/abort/restart → handover) |
| `alarms/` | Threshold evaluation on every ingested sample, alarm ack, alert catalog |
| `notifications/` | In-app notification centre, Socket.IO realtime push, 15-minute unseen-HIGH escalation to Admin |
| `calibration/` | Two-point/offset calibration workflow with dual-approval for the Regulated policy pack |
| `maintenance/` | Maintenance record CRUD + due list |
| `exports/` | CSV export with downsampling + SHA-256 |
| `audit/` | Hash-chained audit trail (every state-changing action) |
| `backup/` | Nightly `pg_dump` + manual trigger + download |
| `health/` | `/health` — db, broker, disk, backup staleness, licence status |
| `licence/` | Offline signed licence file: status, upload (activate/change), deactivate |
| `common/db/` | RLS request-context plumbing (`currentManager()`, `runAsAdmin()`) — **every** feature service must go through this, not `@InjectRepository`, or Postgres row-level security is silently bypassed |

### 2.2 Frontend (`frontend/`, React 18 + TypeScript + Vite)

React SPA, Ant Design v6 component library, TanStack Query v5 for server
state, Zustand for client state (auth tokens, notifications), Socket.IO
client for realtime push, Recharts for telemetry charts.

```
frontend/src/
  api/        typed axios client, one file per backend domain
  store/      auth.store.ts, notifications.store.ts (Zustand)
  auth/       ProtectedRoute (session guard), RoleGate (role-based rendering)
  realtime/   socket.ts (Socket.IO connection), RealtimeProvider.tsx (joins
              lab rooms, bridges server push into stores + toasts)
  layout/     AppLayout.tsx (responsive nav shell: collapsible sider,
              hamburger menu under the `lg` breakpoint)
  pages/      dashboard, reactors, devices, processes, alarms,
              notifications, admin — one folder per domain
```

Served via `npm run dev` (Vite dev server, port 5173) today; production
static-file serving through Caddy is the one deployment piece **not yet
built** (see §7).

### 2.3 Data layer

PostgreSQL 16 + TimescaleDB extension (`measurement` is a hypertable).
**Row-Level Security (RLS)** is the primary multi-tenancy/authorization
mechanism: the app connects as a least-privilege `rmp_app` role, and every
HTTP request is wrapped in a transaction that sets `app.is_admin` /
`app.current_laboratory_ids` session GUCs (`RlsInterceptor` +
`AsyncLocalStorage`) before any query runs. Migrations run as a separate
superuser (`MIGRATION_DB_USERNAME`) so RLS policies can actually be created.

Every state-changing action is also written to an **audit_record** table
with a database-trigger-computed hash chain (`verify_audit_chain()` SQL
function — returns zero rows when the chain is intact).

### 2.4 MQTT broker

Eclipse Mosquitto 2.x, MQTT **v5**, mTLS mandatory (`require_certificate
true`, `use_identity_as_username true`, `allow_anonymous false` — no
username/password fallback). The backend itself is also just an MQTT
client (`MqttClientService`) connecting with its own server-side
certificate; it is not special-cased by the broker.

### 2.5 Reverse proxy

Caddy 2, terminates TLS for the browser-facing side and reverse-proxies:
`/` → frontend static files (once built, §7), `/api/v1/*` → backend,
`/health` → backend (outside the `/api/v1` prefix, proxied separately),
`/socket.io/*` → backend's Socket.IO transport (**not** `/ws*` — `/ws` is
only the gateway's logical Socket.IO *namespace* name, the real HTTP
transport path is always `/socket.io/*`; this was a real bug found and
fixed during this build).

---

## 3. Data flow (device → browser)

1. **Admin claims + binds a device** (one-time, via REST): `serialNo` →
   `deviceId` (UUID), then `deviceId` → `equipmentId` (reactor). A claimed
   but unbound device's telemetry is **silently dropped** server-side —
   this is intentional (Part 7 of the original design).
2. **Device connects** to the broker over mTLS, publishes `state` (birth
   message, ideally with a Last-Will `online:false`), subscribes to its
   retained `cfg/desired` topic, then streams `tele/batch`.
3. **`IngestionService`** inserts each sample into the `measurement`
   hypertable, detects sequence gaps (writes a `data_gap` row), and calls
   `AlarmsService.evaluateSample()` against the process's approved
   threshold version (static min/max only today — rate-of-change limits
   are a documented, not-yet-implemented follow-up).
4. **On a threshold breach**, an `Alarm` row is raised `ACTIVE_UNACK`, an
   audit record is written, and `NotificationsService.notifyLabIncharges()`
   creates a notification for every Lab In-charge scoped to that
   laboratory (falling back to Admin if none are scoped) — pushed instantly
   over the Socket.IO `/ws` namespace **and** persisted for the in-app
   Notifications page.
5. **A 15-minute scheduler** (`NotificationsSchedulerService`,
   `@Cron(EVERY_MINUTE)`) escalates any HIGH-priority notification that is
   still unseen after 15 minutes to Admin — exactly once per original
   notification (fixed 2026-11-08; see §6 for the bug this replaced).
6. **The browser** polls REST endpoints for live/recent measurements (there
   is currently no push-per-sample event — only notifications and
   `ALARM_ACTIVE` are pushed) and receives notifications/alarms over the
   Socket.IO connection in real time.
7. **Commands flow the other way**: the backend can push `cmd/{name}` to a
   device (e.g. `set_calibration`) via the generic command dispatcher; the
   device must `ack/cmd` with a matching correlation ID.

---

## 4. Security model

- **Transport**: mTLS for every device↔broker connection (client certs
  signed by the platform CA, verified against it); HTTPS for every
  browser↔Caddy connection.
- **Authentication**: Argon2id-hashed passwords + optional TOTP MFA, JWT
  access/refresh tokens (`auth/jwt.strategy.ts` resolves roles + lab scopes
  on every request).
- **Authorization**: role-based (`RolesGuard`, `@Roles('ADMIN')` decorators
  on Admin-only endpoints) **and** row-level via Postgres RLS — a Lab
  In-charge with no `user_lab_scope` row genuinely cannot see labs/reactors
  at the database level, not just a hidden UI element.
- **Borosil Admin role (`BOROSIL_ADMIN`)**: one fixed role, seeded
  identically into every deployment (same pattern regardless of client
  size), exclusively controlling licence activate/deactivate/change and
  able to reset any user's password for support. `isAdmin`
  (`jwt.strategy.ts`) is computed purely from `roles.includes('ADMIN')`,
  so `BOROSIL_ADMIN` deliberately gets **no RLS bypass and no laboratory
  scope** — it structurally cannot read tenant data (sites/labs/reactors/
  devices/processes/alarms/measurements) regardless of what the UI shows.
  There is no cross-deployment connectivity: each client's install is
  fully independent, and Borosil's access is always per-instance and
  manual (remote-session support, not a standing connection). See
  `licence-management-guide.md` for the full role boundary and onboarding
  flow.
- **Audit**: every state-changing action recorded with a tamper-evident
  hash chain, independent of RLS (service/superuser-verifiable).
- **Licensing**: offline, RSA-PSS signed licence file, public key baked
  into the app, no phone-home. Never blocks already-collected data,
  viewing, or export — only blocks claiming new devices beyond a 10% grace
  margin once expired or deactivated. See `licence-management-guide.md`.

---

## 5. Deployment topology (current — single-host Docker Compose)

```
docker-compose.yml (repo root)
  postgres   timescale/timescaledb:latest-pg16   :5432 (host-mapped)
  mosquitto  eclipse-mosquitto:2                 :18883 → container :8883
  app        built from backend/Dockerfile       :3000
  caddy      caddy:2-alpine                      :80, :443
```
Volumes: `backend/licence` (licence file + public key, **not** read-only —
the upload/deactivate endpoints must be able to write), `backups_data`
(nightly `pg_dump` output), `exports_data` (CSV export files),
`infra/mosquitto/certs` (mTLS material, gitignored).

Run: `docker compose up -d` from the repo root (after
`./tools/gen-dev-certs.ps1` once, to generate dev mTLS certificates).

## 6. Notable fixed issues (don't reintroduce these)

- **Borosil Admin role split (architectural decision, 2026-11-09, not a
  bug fix).** Licence management and account-recovery support used to be
  bundled into the same `ADMIN` role as everything else, meaning a
  client's own Admin could activate/deactivate/change their own licence.
  Split into `BOROSIL_ADMIN` (licence + password-reset support only, zero
  data-plane access) and `ADMIN` (everything else, read-only licence
  visibility) — see §4 and `licence-management-guide.md`. Applies
  uniformly to every client regardless of size/edition.
- **Notification escalation infinite loop (fixed 2026-11-08).** The
  escalation scheduler used to create a brand-new notification for the
  escalation target without marking *that* notification as already
  escalated — so it became eligible for the same 15-minute scan and
  re-escalated itself forever (~113 chained rows observed over 28h
  uptime). Fixed in `notifications.service.ts::escalateUnseen()`: the type
  string is no longer mutated (the relationship is carried via
  `payload.escalatedFrom` instead), and the newly-created escalation
  notification immediately gets its own `escalatedAt` stamped so it can
  never be picked up again.
- **`/ws*` vs `/socket.io/*` proxy mismatch** (Caddyfile + Vite dev
  proxy) — `/ws` is a Socket.IO *namespace* name, not an HTTP path; the
  real transport path is always `/socket.io/*`. Both proxies now target
  the correct path.
- **Licence volume mounted `:ro`** — blocked the upload/deactivate
  endpoints from ever writing. Removed the read-only flag.
- **`UploadLicenceDto` missing class-validator decorators** — the global
  `ValidationPipe({ whitelist: true })` silently stripped the payload,
  causing a 500. Fixed with `@IsObject()`/`@IsString()`.
- **`canClaimDevice()` didn't check expiry** — an expired-but-signature-
  valid licence could still claim new devices if under the device-count
  limit, contradicting the documented policy. Fixed to check
  `isExpired()` unconditionally.

## 7. What's not built yet

- **ESP32-P4/C6 firmware** — in progress, not "deferred." As of 2026-11-10:
  PT100 temperature, the onboard speaker's 3-level alert tones, Wi-Fi
  connect, mTLS MQTT5 telemetry to this backend, and Wi-Fi captive-portal
  provisioning are all **confirmed working on real hardware**. The Heidolph
  motor and DWIN display drivers are built but not yet wired/bench-tested.
  Full Ethernet fallback (dual-interface failover) is not built — Ethernet
  hardware itself is still unwired. See
  [`PROJECT-OVERVIEW.md`](./PROJECT-OVERVIEW.md) §3 for the live status
  table and `firmware/docs/SPEC.md` for the build spec.
- **DWIN HMI on-device UI** — no screen design exists yet; `dwin-hmi-ui-guide.md`
  is a *proposed* reference spec for that team to build from, not an
  already-implemented design.
- **PDF process reports** (needs a headless-Chromium render worker),
  **rate-of-change alarm thresholds** (only static min/max exist today),
  **ack-confirmed calibration apply** (currently optimistic on command
  send, not on device ack) — all flagged in code comments, not silently
  skipped.

## 8. Deployment: frontend is now containerized

`frontend/Dockerfile` (multi-stage: `vite build` → nginx, SPA fallback via
`nginx.conf`) is wired into the root `docker-compose.yml` as a `frontend`
service, with `infra/caddy/Caddyfile`'s catch-all route sending every
non-API/health/socket.io path to it. `docker compose up -d --build` now
brings up the full stack — postgres, mosquitto, the backend, the frontend,
and Caddy — reachable at `http://localhost` (port 80). See
[`PROJECT-OVERVIEW.md`](./PROJECT-OVERVIEW.md) §5 for the exact commands.
Active development still uses `npm run dev` (`:5173`) for hot-reload.

## 9. Known open bug (not yet fixed)

- **Nightly backup cron intermittently doesn't fire.** `/health`'s
  `backup.stale` flag caught this on 2026-11-11 — backups existed for
  three consecutive nights, then two nights were silently missed despite
  the app process running continuously through both scheduled windows.
  The backup mechanism itself works fine (manual trigger via
  `POST /api/v1/system/backups` succeeds immediately); only the
  `@Cron(CronExpression.EVERY_DAY_AT_2AM)` schedule itself is unreliable,
  root cause not yet confirmed (leading theory: `nest start --watch`'s
  dev-mode child-process respawns not always cleanly re-registering cron
  jobs). Not a data-loss risk — it's visible via `/health` whenever it
  happens — but the automatic schedule shouldn't be blindly trusted yet.

Fixed this session (kept here for history, not currently open):
- ~~`device_state` update deadlock crashing the backend container~~ —
  fixed 2026-11-10 by making `ingestion.service.ts`'s `onState()` and
  `onBatch()` lock `Device` then `DeviceState` in the same order in both
  methods; verified stable under continuous live device traffic since.
