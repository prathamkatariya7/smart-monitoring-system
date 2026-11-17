# Testing and release gates

## Backend gate

```bash
cd backend
npm ci
npm run typecheck
npm run build
npm run lint -- --max-warnings=0
npm test -- --runInBand
```

## Frontend gate

```bash
cd frontend
npm ci
npm run typecheck
npm run lint -- --max-warnings=0
npm run build
```

## Live integration gate

Use disposable PostgreSQL/TimescaleDB and Mosquitto services. Verify health, login, protected-route redirect, lab/device scope, device claim, telemetry ingestion, alarm paths, realtime reconnect, migrations and backup status. Publish test MQTT state for both IKA and Heidolph identities and verify current identity, history coalescing, replacement history and explicit no-motor clearing.

## Firmware gate

In the target ESP-IDF environment, compile with warnings treated as errors where supported, run host/unit tests, flash a test device, and exercise: boot, provisioning, certificate failure, MQTT reconnect, offline buffering, RTD quality, motor absent/IKA/Heidolph, hot swap, DWIN frame parsing, all four buttons, alarm lockout, safe MODE exit and watchdog recovery.

## Pharmaceutical release gate

Complete traceability from requirement to test evidence, reviewer approval, validated time source, immutable audit behavior, role segregation, electronic signatures, backup restore, retention, access review and change control. A passing TypeScript build is not a substitute for GxP validation or hardware qualification.
