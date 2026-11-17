# Current system architecture

## Scope

RMP monitors pharmaceutical reactor conditions and process state. The device is the trusted acquisition boundary; the backend is the authoritative persistence, access-control and audit boundary; the frontend is an operator and administrator view over backend APIs and realtime events.

## Runtime topology

```text
┌──────────────────────────────┐       mTLS MQTT        ┌──────────────────┐
│ ESP32-P4 control box          │───────────────────────▶│ Mosquitto broker │
│ RTD · motor · HMI · buttons   │                        └────────┬─────────┘
└──────────────┬───────────────┘                                 │
               │ UART/RS-232/DWIN                                │ subscribe
               ▼                                                  ▼
      IKA or Heidolph motor                              ┌──────────────────┐
      DWIN 320×480 HMI                                   │ NestJS backend    │
                                                         │ auth/API/ingest   │
                                                         └───────┬──────────┘
                                                                 │ SQL/WebSocket
                                           ┌─────────────────────┴────────────┐
                                           ▼                                  ▼
                                  PostgreSQL/TimescaleDB                React frontend
```

## Data ownership

- **Firmware:** samples sensors, detects the motor, validates local safety state, displays operator feedback and publishes signed/secured transport payloads.
- **MQTT:** transports device heartbeats, telemetry, events and commands. It is not the system of record.
- **Backend:** authenticates users/devices, applies tenant and role scope, persists telemetry/events, records motor identity history, exposes APIs and broadcasts authorized realtime updates.
- **Database:** stores device configuration, current motor identity, historical identities, measurements, alarms, process records and audit records.
- **Frontend:** renders backend state and sends authorized actions; it must never infer a process outcome from stale local state.

## Motor identity lifecycle

1. Firmware configures the IKA 7E1 profile and probes the documented read-only identification/telemetry commands.
2. If IKA is not identified, firmware configures Heidolph 8N1 and probes its allow-listed read-only commands.
3. A valid identity is attached to the MQTT `state` heartbeat and emitted once as `MOTOR_IDENTIFIED`.
4. The backend normalizes lengths and values, updates the device's current identity, and upserts `device_motor_identity` by `(device, manufacturer, model, protocol, serial)`.
5. Repeated heartbeats increment `observation_count`; replacement creates a new historical row.
6. An explicit `detected:false` state clears current identity fields but never deletes history.

## Trust boundaries

The device-to-broker boundary requires device authentication. The backend-to-database boundary uses the application database role and migrations. The browser is untrusted: all authorization is server-side, DTOs reject unknown fields, and realtime payloads are treated as untrusted input.

## Failure behavior

- Unknown or unresponsive motor: identity `UNKNOWN`, telemetry invalid, no control command issued.
- MQTT outage: firmware buffers according to its durable queue policy and reports connectivity state; backend does not invent telemetry.
- Database outage: API health is degraded and ingestion must retry without duplicating historical identities.
- Stale frontend socket: UI shows disconnected/stale state and refreshes through the API.

See [`firmware.md`](firmware.md), [`backend.md`](backend.md), [`hmi.md`](hmi.md) and [`security.md`](security.md) for component-level contracts.
