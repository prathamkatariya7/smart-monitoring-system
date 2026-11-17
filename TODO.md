# Production-readiness implementation outcomes

## Release hygiene and configuration

- [ ] The source release excludes `.env` files, private keys, real credentials, licence data, `node_modules`, generated `dist`/build output, caches and temporary debug artifacts.
- [ ] Production configuration fails closed when JWT, database, MQTT TLS, signing or backup secrets are missing or still use development placeholders.
- [ ] Container images and Node runtime assumptions are pinned and documented; clean lockfile installs work without archived dependencies.

## Backend security and sessions

- [ ] CORS, security headers, body limits, request correlation IDs, redacted errors and rate limits are enforced in production.
- [ ] Refresh tokens rotate with server-side reuse detection/revocation; logout and password reset revoke sessions; browser storage is not used for long-lived refresh secrets.
- [ ] Failed-login lockout updates are atomic and MFA/login/reset endpoints have abuse limits.

## Tenant isolation and auditability

- [ ] Every laboratory-owned table has a documented ownership path and enforced RLS or an equivalent explicit authorization check.
- [ ] Direct-ID reads, mutations, downloads, exports, notifications, device history, calibration, maintenance and realtime events are tested across two laboratories.
- [ ] State-changing actions record actor, laboratory, reason, correlation ID, before/after data and timestamp with immutable audit semantics.

## MQTT, devices and firmware

- [ ] Production broker ACLs bind certificate identity to device topic identity; unknown, mismatched and decommissioned devices are rejected.
- [ ] Production cannot auto-register arbitrary devices; provisioning requires an explicit trusted flow.
- [ ] MQTT payloads, batches, event detail, replay windows and command responses are bounded and validated.
- [ ] Firmware release builds contain no bench credentials, use unique device identity/certificates, validate broker identity and support safe OTA/rollback behavior.

## Domain workflows

- [ ] Process transitions are explicit, authorized, transactionally guarded and idempotent under concurrent requests.
- [ ] Calibration validates point counts/numerical values/device scope and protects approve/apply/rollback transitions.
- [ ] Exports validate time windows, enforce scope/ownership, stream or quota large outputs and safely manage generated files.
- [ ] Backups are encrypted, retained off-host, integrity-checked, monitored and restore-tested.

## Frontend and operator UX

- [ ] Frontend clean build, typecheck and lint pass with zero errors.
- [ ] Online/offline state uses a stable timer/query model rather than impure render-time clocks.
- [ ] Realtime events use runtime-validated types and cannot leak events across laboratories.
- [ ] Login expiry, reconnect, API errors, loading/empty states, duplicate submits and destructive actions are safe and clear for regulated operators.

## Verification and delivery

- [ ] Backend build/lint/tests, frontend build/lint, migrations, two-lab authorization tests and MQTT negative tests pass in a clean environment.
- [ ] The deployment hostname/TLS endpoint is reachable and the live smoke flow passes login, MFA, telemetry, alarms, exports, backups and recovery paths.
- [ ] Remaining limitations are documented and explicitly accepted before release.
