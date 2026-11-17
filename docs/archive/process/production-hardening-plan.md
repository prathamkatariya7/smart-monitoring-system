# Smart Monitoring System — Production Hardening and Completion Plan

## Objective

Bring the existing Reactor Monitoring Platform to a production-ready baseline for pharmaceutical laboratory clients, without silently removing existing capabilities. Preserve the current domain model while making security boundaries, auditability, validation, observability, build reproducibility and operational controls explicit.

## Delivery strategy

Work in small, verifiable phases on a separate working copy. The uploaded archive remains unchanged. Each phase must leave the system compiling and must add or update tests for changed security or domain behavior.

1. **Release hygiene and toolchain:** remove generated/secrets from the deliverable path, make clean installs reproducible, pin runtime assumptions, add strict CI gates.
2. **Backend security foundation:** strict configuration validation, secure headers/CORS, body limits, rate limiting, session/refresh hardening, safe error handling and audit correlation.
3. **Tenant isolation:** define a table-by-table laboratory ownership matrix, complete database RLS policies/migrations and add explicit service authorization for direct-ID/download endpoints.
4. **MQTT and device trust:** production-only certificate/topic binding, ACL enforcement, no unknown-device auto-registration, bounded payloads and replay/idempotency controls.
5. **Domain correctness:** process lifecycle concurrency/idempotency, calibration validation and transitions, device provisioning/binding rules, export quotas/streaming and backup integrity.
6. **Frontend correctness:** fix build/lint/type errors, stable realtime/online state, typed event payloads, auth expiry behavior, resilient loading/error/empty states and pharmaceutical-appropriate operator UX.
7. **Firmware hardening:** remove bench secrets from release defaults, secure provisioning, unique identity/certificate checks, OTA/replay protections and production-vs-bench profiles.
8. **Verification:** clean backend/frontend builds, lint, unit/integration/e2e tests, two-laboratory authorization tests, MQTT negative tests, migration checks, backup restore verification and a reachable live smoke test.

## Pharmaceutical-client design principles

- **ALCOA+ auditability:** attributable, legible, contemporaneous, original, accurate, complete, consistent, enduring and available records.
- **Least privilege and segregation of duties:** analysts operate processes; lab in-charge manages laboratory work; admins manage installation; licence/support administration stays separate.
- **Traceability:** every state-changing action records actor, reason, before/after values, object, laboratory, request/correlation ID and timestamp.
- **Data integrity:** immutable/raw telemetry, versioned calibration/thresholds, explicit corrections, no silent destructive updates and deterministic exports.
- **Operational resilience:** no single local file as the only copy of regulated data; backup/restore evidence; clear degraded-mode behavior and alerts.
- **Safe defaults:** production fails closed when secrets, certificates, ACLs or tenant scope are absent.

## Project structure and responsibilities

- `backend/src/auth`, `common`: authentication, session, roles, request context, security middleware and shared validation.
- `backend/src/database`: migrations, RLS/policies, seed/bootstrap and data-source configuration.
- `backend/src/mqtt`: broker client, ingestion, commands, device state and scheduler workers.
- `backend/src/processes`, `alarms`, `calibration`, `maintenance`, `exports`: regulated laboratory domain workflows.
- `frontend/src`: operator/admin UI, typed API boundary, realtime provider and route-level UX.
- `firmware`: ESP32 device firmware, provisioning, telemetry, command handling and OTA.
- `infra`: Caddy, Mosquitto, PostgreSQL/Timescale and container deployment.
- `tools`: simulator, smoke tests, licence/certificate tooling; development-only unless explicitly hardened.

## Acceptance gates

- No source package contains `.env`, private keys, real passwords, generated dependency trees or build output.
- Clean dependency install from lockfiles succeeds on the supported Node version.
- Backend and frontend build and lint pass with zero errors.
- Automated tests exist and pass; `npm test` must not fail because no tests exist.
- Two-lab tests prove no cross-laboratory read, update, export, notification or realtime leakage.
- Production MQTT rejects unknown devices, wrong topic identities, invalid certificates, oversized/replayed messages and decommissioned devices.
- Production startup rejects placeholder secrets, missing TLS/ACL configuration and development-only auto-registration.
- Backup restore is demonstrated and monitored; retention and off-host handling are documented.
- Live deployment is reachable through the intended hostname/TLS endpoint and passes login, MFA, telemetry, alarm, export and recovery smoke tests.
