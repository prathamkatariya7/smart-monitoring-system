# Firmware guide

## Target

ESP-IDF firmware for the ESP32-P4 control box. It connects the RTD/MAX31865 temperature path, RS-232 motor interface, DWIN DMG48320C035_03WN 320×480 HMI, four tactile buttons, network provisioning, MQTT/mTLS, time synchronization and durable telemetry/event storage.

## Component boundaries

- `rmp_motor` — read-only IKA/Heidolph detection and polling.
- `rmp_rtd` — temperature acquisition and quality flags.
- `rmp_mqtt` — state, telemetry, event and batch payloads.
- `rmp_dwin` — DGUS frame protocol and atomic navigation-register writes.
- `rmp_buttons` — debounced UP/DOWN/SELECT/MODE events with hold repeat.
- `rmp_net`, `rmp_prov`, `rmp_time` — network, provisioning and clock state.
- `rmp_ring` — durable local storage/buffering.

## Motor rules

The motor manager probes IKA at 9600 7E1 and Heidolph at 9600 8N1. It sends only documented read-only commands. It never sends start, stop, reset, setpoint or `OUT_*` commands. After repeated failures it clears the active identity and safely retries detection. IKA serial numbers are unavailable from the supplied command set; they remain empty unless commissioning metadata supplies one.

See [`firmware/docs/MOTOR_AUTO_DETECTION.md`](../firmware/docs/MOTOR_AUTO_DETECTION.md) for protocol and commissioning details.

## HMI and controls

The current HMI target is portrait 320×480. UP/DOWN moves focus or scrolls, SELECT confirms/toggles and MODE exits without committing an uncommitted workflow change. Buttons use debounce and hold-repeat behavior. The current draft DGUS contract is under `RMP_HMI/DGUS_Assets_320x480_DRAFT/`.

## Build

Use the target team's ESP-IDF environment:

```powershell
cd firmware
. .\activate-esp-idf.ps1
idf.py set-target esp32p4
idf.py build
idf.py flash monitor
```

The sandbox cannot replace physical RS-232 or ESP-IDF hardware qualification. Run [`docs/testing.md`](testing.md) and the target-toolchain validation before release.
