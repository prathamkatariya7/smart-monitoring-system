# Smart Monitoring System

## Reactor Monitoring Platform (RMP)

A self-hosted pharmaceutical reactor monitoring platform comprising ESP32-P4 firmware, DWIN DGUS HMI, an MQTT/NestJS backend, PostgreSQL/TimescaleDB persistence and a React operations dashboard.

The active documentation in `docs/`, `firmware/docs/` and `RMP_HMI/` describes the current architecture. Superseded documents and 240×320 HMI material are retained only under explicitly named `archive/` directories and are not release instructions.

## Current architecture

```text
React dashboard ── HTTPS/WebSocket ── NestJS API
                                      │
ESP32-P4 ── mTLS MQTT ── Mosquitto ──┤── PostgreSQL/TimescaleDB
   │                                  │
   ├── RS-232: IKA or Heidolph motor  └── audit, alarms, users, devices, identity history
   ├── RTD/MAX31865
   └── DWIN DMG48320C035_03WN, 320×480, + four tactile buttons
```

The device performs read-only motor auto-detection. IKA uses 9600 7E1 and Heidolph uses 9600 8N1. The detected identity is sent in MQTT state heartbeats and persisted as current device metadata plus auditable motor identity history.

## Repository map

| Path | Responsibility |
|---|---|
| `backend/` | NestJS API, authentication, MQTT ingestion, alarms, licensing, migrations and workers |
| `frontend/` | React/Vite operations dashboard |
| `firmware/` | ESP-IDF application and device drivers |
| `RMP_HMI/` | Current 320×480 DGUS migration contract and assets |
| `infra/` | Mosquitto, PostgreSQL and reverse-proxy deployment configuration |
| `docs/` | Canonical architecture, deployment, testing and validation documentation |
| `docs/change-log/` | Chronological project changes |
| `archive/` directories | Historical material retained for traceability only |

## Start here

Read [`docs/README.md`](docs/README.md), then [`docs/architecture.md`](docs/architecture.md). Use the component guide for the area being changed, follow [`docs/deployment.md`](docs/deployment.md) for environments and run [`docs/testing.md`](docs/testing.md) before committing. Regulated releases must also follow [`docs/gxp-validation.md`](docs/gxp-validation.md).

Backend and frontend typecheck, build, lint and test gates pass in the sandbox. PostgreSQL migration and Mosquitto ingestion were exercised live, including IKA detection, heartbeat coalescing, Heidolph replacement history and no-motor clearing. ESP-IDF compilation and physical RS-232 qualification require the target hardware/toolchain.

Never commit `.env` files, certificates, private keys, customer licence files or generated build output.
