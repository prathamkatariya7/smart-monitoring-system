# Documentation index

This directory is the source of truth for the current Smart Monitoring System. If a document conflicts with source code, the code and the latest approved change-log entry must be reconciled before release; do not silently revive an archived design.

## Current documents

- [`architecture.md`](architecture.md) — end-to-end system boundaries, data flow and ownership.
- [`backend.md`](backend.md) — API, tenancy, MQTT ingestion, persistence and migration conventions.
- [`frontend.md`](frontend.md) — dashboard structure, API usage, realtime behavior and UI standards.
- [`firmware.md`](firmware.md) — ESP-IDF firmware modules, sampling, motor detection and device behavior.
- [`hmi.md`](hmi.md) — current DWIN 320×480 contract, navigation and release process.
- [`deployment.md`](deployment.md) — local, sandbox and production-like deployment procedure.
- [`testing.md`](testing.md) — required verification commands and acceptance evidence.
- [`security.md`](security.md) — security controls and production configuration.
- [`licence-management-guide.md`](licence-management-guide.md) — licence installation and operational limits.
- [`gxp-validation.md`](gxp-validation.md) — pharmaceutical validation and ALCOA+ release checklist.
- [`operations.md`](operations.md) — troubleshooting, observability and recovery procedures.
- [`change-log/`](change-log/) — chronological project changes and release notes.

## Documentation maintenance rules

Every architecture or behavior change must update the relevant section guide and add a dated entry under `docs/change-log/`. Use exact paths, commands, units and environment assumptions. Mark hardware-dependent facts as `HARDWARE VALIDATION REQUIRED`; do not describe a draft HMI export as release-ready. Historical material belongs under an `archive/` directory with a short note explaining why it is not authoritative.
