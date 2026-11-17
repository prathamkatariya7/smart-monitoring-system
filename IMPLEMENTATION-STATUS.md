# Smart Monitoring System — Implementation Status

Date: 2026-11-16

## Scope completed in this pass

This pass hardened the extracted working copy at `/home/ubuntu/work/Smart Monitoring System`. The uploaded ZIP was preserved unchanged.

### Backend hardening

- Added strict JSON and URL-encoded request body limits, configurable through `REQUEST_BODY_LIMIT`, defaulting to `1mb`.

- Made HTTP CORS production-safe: production requires explicit `CORS_ORIGIN`; development retains permissive behavior for local development.

- Made Socket.IO `/ws` origins follow the same production-safe allow-list behavior and enabled credential-aware CORS.

- Enabled global request throttling at 120 requests per 60 seconds.

- Changed validation to reject unknown DTO fields (`forbidNonWhitelisted`) instead of silently accepting or discarding unexpected input.

- Disabled unauthenticated MQTT state/event auto-registration by default. It can only be enabled explicitly in non-production through `ALLOW_DEV_DEVICE_AUTO_REGISTER=true`.

- Added configuration-level production checks for JWT secrets and a security regression test for those checks.

- Removed unused imports and dead login-time queries that caused lint failures.

### Frontend hardening

- Added a stable timer-backed `useNow` hook so connectivity indicators do not depend on impure `Date.now()` calls during render.

- Added typed realtime telemetry and alarm event contracts and removed unsafe `any` payload handling from the realtime provider.

- Removed unsafe calibration and process table casts.

- Added a real `typecheck` npm script and made the production build call it automatically.

- Removed the stale ESLint suppression from the error boundary.

- Replaced the deprecated Ant Design `Alert message` prop on the login page with `Alert title` after browser smoke testing exposed the warning.

- Added an explicit development-only `ALLOW_PLAIN_POSTGRES=true` migration fallback for sandbox smoke testing when TimescaleDB is unavailable. Production still fails closed unless TimescaleDB is present.

### Repository hygiene

- Removed local `.env` files, private key/certificate artifacts, generated `dist`/coverage output, logs, and installed dependency directories from the working copy before clean installation.

- Regenerated the frontend lockfile after adding the typecheck script.

## Verification evidence

All of the following passed in the working copy:

- Frontend `npm run typecheck`

- Frontend `npm run lint -- --max-warnings=0`

- Frontend `npm run build`

- Backend `npm test -- --runInBand` — 1 suite, 2 tests passed

- Backend `npm run build`

- Backend `npm run lint`

- Clean `npm ci` installs for backend and frontend

### Live sandbox verification

The stack was run directly in the sandbox without Docker:

- PostgreSQL 15 was installed and running on `127.0.0.1:5432`.

- Mosquitto 2.0.18 was installed and running on `127.0.0.1:1883`.

- All 13 project migrations completed successfully.

- Baseline and demo seed data completed successfully.

- Backend started on `127.0.0.1:3000` and connected to both PostgreSQL and Mosquitto.

- `GET /health` returned HTTP 200 with `database: ok` and `mqttBroker: ok`.

- Health status was correctly `degraded` because this isolated environment has no installed customer license, no backup artifact yet, and no disk check integration.

- The supplied `admin` / `ChangeMe123!` credentials authenticated successfully after creating the requested `admin` seed account through the official seed path.

- A scoped client-admin test account was created through the live API and authenticated successfully.

- Playwright verified the client-admin laboratory overview, laboratory selection, reactor list, Devices page and Processes page.

- The scoped client-admin saw four laboratories and two reactors in the selected laboratory.

- Browser console errors/warnings were absent after the login Alert compatibility fix.

### Browser smoke-test evidence

Using the supplied test credentials (`admin` / `ChangeMe123!`) against the locally started Vite frontend through Playwright:

- `/login` rendered with accessible username, password, and sign-in controls.

- `/dashboard` correctly redirected to `/login` while unauthenticated.

- Login submission reached the real `/api/v1/auth/login` request path.

- Because the backend could not start without PostgreSQL, the expected response was a proxy `502`; the UI displayed the controlled `Login failed` alert instead of crashing.

- After the Alert compatibility fix, the browser console reported no errors or warnings during the protected-route smoke test.

The frontend build still emits a non-failing bundle-size warning: the main minified JavaScript chunk is approximately 1.9 MB. This should be addressed with route-level code splitting before a large pharmaceutical deployment.

## Important remaining blockers before calling this fully production-ready

1. **Customer-infrastructure validation is still required.** The core backend/frontend was tested against live sandbox PostgreSQL and Mosquitto, but TimescaleDB, customer licensing, backups, real MQTT device certificates and firmware hardware were not present. The production deployment must be tested with those components, including login success, role navigation, API failures, WebSocket reconnects, alarms, exports and device workflows.

1. **Backend production dependency audit remains non-zero.** `npm audit --omit=dev` reports 5 high and 12 moderate transitive vulnerabilities, mostly tied to the current NestJS 10 / platform-express / multer / body-parser / lodash / TypeORM dependency graph. `npm audit fix --force` proposes breaking upgrades, so this requires a controlled framework upgrade branch and regression cycle rather than an unsafe automatic force-fix.

1. **Refresh-token rotation/revocation is still not implemented.** Refresh tokens remain stateless and are stored in browser local storage. A regulated deployment should use server-side refresh-session records, rotation, reuse detection, revocation on logout/password reset, and preferably secure HttpOnly cookies.

1. **Automated coverage is still minimal.** The repository previously had no tests; this pass added two configuration-security tests only. Authentication, tenancy/RLS, MQTT ingestion, alarm escalation, calibration approval, exports, backups, and firmware protocol behavior still need unit/integration/acceptance tests.

1. **Firmware toolchain and hardware-in-the-loop behavior were not executable in this sandbox.** Firmware requires its ESP-IDF/PlatformIO environment and a broker/device test setup. It still needs a real compile, static analysis, protocol fuzzing, reconnect/offline tests, clock-anchor tests, buffer-overwrite tests, and device certificate/claim tests.

1. **Pharmaceutical compliance controls need a dedicated validation pass.** Audit immutability, electronic signatures, approval segregation, time synchronization, backup restore evidence, retention, access review, change control, and validation documentation should be tested and documented against the client’s applicable GxP/ALCOA+ requirements.

## Recommended next execution order

1. Run the frontend and backend against a disposable PostgreSQL/MQTT environment with seeded demo data.

1. Run browser E2E tests from the environment that can resolve the deployed hostname.

1. Implement server-side refresh sessions and secure cookie transport.

1. Add database/RLS/auth/MQTT/alarm/calibration/backup integration tests.

1. Upgrade vulnerable production dependencies in a controlled branch, starting with framework-compatible patch releases and then a tested NestJS major upgrade.

1. Compile and test firmware with the actual target toolchain and a broker/device simulator.

1. Perform pharmaceutical validation review and produce release evidence before customer deployment.

## DWIN 320x480 HMI upgrade

- Updated the firmware target to the DWIN DMG48320C035_03WN native portrait panel: 320x480, rotation 0, TTL/CMOS UART 8N1 at the existing 115200 baud.
- Replaced the old page-specific button shortcuts with the requested global roles: MODE backs out without publishing an uncommitted workflow action, UP/DOWN moves focus or scrolls, and SELECT confirms the focused block.
- Added 25 ms debounce, one edge per press, 500 ms hold-to-repeat with a 150 ms repeat interval, stop-at-edge behavior, and a bounded event queue that does not discard SELECT/MODE safety events behind repeat traffic.
- Added firmware-owned navigation VPs `0x1320` through `0x1323`. They synchronize focus, the three-row diagnostics window, and assignment state under one UART critical section.
- Diagnostics now implements nine rows with a three-row sliding window. UP/DOWN moves within the window first, then shifts the window while keeping the edge row focused.
- MODE is intentionally ignored while a critical alarm or running process is active so a pharmaceutical operator cannot hide a safety state or make an active process appear idle.
- Added `RMP_HMI/DGUS_Assets_320x480_DRAFT/`, a generated 320x480 coordinate map, project metadata and draft backgrounds. Superseded 240x320 assets are segregated under `RMP_HMI/archive/legacy-240x320/`; the legacy binary `DWIN_SET` was not overwritten because the final DGUS export must be rebuilt and bench-tested by the UI/UX team on the exact panel.

### HMI verification

- Generated and validated 10 draft backgrounds at exactly 320x480.
- Validated all scaled VP rectangles stay inside the 320x480 panel bounds.
- `git diff --check` reports only the pre-existing user-edited trailing blank line in this status file.
- ESP-IDF compilation could not be executed in this sandbox because `idf.py`, CMake and Ninja are unavailable. No firmware was flashed. The existing Windows `.exe` host-test binaries are not executable on this Linux sandbox; they must be rebuilt and run in the target toolchain.

## Dual Heidolph / IKA motor detection

- Replaced the Heidolph-only firmware driver with a read-only `MotorManager` that detects IKA EUROSTAR using the documented 9600 7E1 profile and `IN_NAME`/`IN_PV_4`/`IN_PV_5`, or Heidolph using the existing 9600 8N1 profile and read-only `T`/`Q`/`r`/`m`/`f` commands.
- Detection is fail-safe: no `START_4`, `STOP_4`, `RESET`, `OUT_*`, setpoint or control command is sent. Unknown hardware remains unknown and invalid motor telemetry is not presented as valid zero data. Three consecutive poll failures trigger safe re-detection, supporting a controlled motor replacement.
- Connected the motor driver to the real sampler and startup path; the previous implementation had `g_motor` declared but never initialized or polled, so RPM/torque were always zero.
- Added MQTT motor identity metadata to state heartbeats and `MOTOR_IDENTIFIED` events. Added current identity fields to `device` and an auditable/coalesced `device_motor_identity` history table, retaining model, protocol, serial where available, first/last seen and observation count.
- Added a detected-motor column to the Devices page. IKA type-plate serial is explicitly left unavailable because it is not exposed by the supplied IKA command table.
- Added the detailed protocol and commissioning document at `firmware/docs/MOTOR_AUTO_DETECTION.md`.

### Motor verification evidence

- Backend strict typecheck, build, zero-warning lint and tests passed.
- Frontend strict typecheck, zero-warning lint and production build passed; the existing approximately 1.9 MB bundle warning remains non-failing.
- Migration `MotorIdentity1730000000014` ran successfully on the live sandbox PostgreSQL database; all five current motor columns and `device_motor_identity` were verified.
- Live Mosquitto smoke test published an IKA heartbeat, confirmed current-device persistence and history creation, repeated it to confirm observation coalescing, then published a Heidolph heartbeat and confirmed current identity replacement plus two retained historical identities.
- ESP-IDF firmware compilation and physical RS-232 tests remain required on the target hardware/toolchain; they were not possible in this sandbox.


## Documentation and repository cleanup

- Added the canonical documentation set under `docs/` for architecture, backend, frontend, firmware, HMI, deployment, testing, security, operations and pharmaceutical validation.
- Added `docs/change-log/` with dated records of production hardening, HMI migration, dual-motor detection and this cleanup.
- Moved superseded architecture and 240x320 HMI material into explicit archive directories; archived documents are retained for traceability but are not current release instructions.
- Removed dependency trees, ESP-IDF build output, downloaded managed components, frontend build output and internal planning artifacts from the working tree. They are reproducible from lockfiles and toolchain instructions.
