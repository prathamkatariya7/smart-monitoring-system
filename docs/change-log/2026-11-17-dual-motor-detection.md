# 2026-11-17 — IKA/Heidolph motor auto-detection

The Heidolph-only motor path was replaced with a read-only motor manager supporting IKA EUROSTAR at 9600 7E1 and Heidolph at 9600 8N1. Detection never sends start, stop, reset, setpoint or `OUT_*` commands. Repeated communication failures safely clear identity and trigger re-detection.

Motor identity is now published in MQTT state heartbeats and `MOTOR_IDENTIFIED` events. Migration `1730000000014-MotorIdentity` adds current identity fields to `device` and an auditable, coalesced `device_motor_identity` history table. The Devices page exposes the current manufacturer, model and protocol.

Live sandbox verification covered IKA persistence, repeated heartbeat coalescing, Heidolph replacement history and explicit no-motor clearing. Physical RS-232 and ESP-IDF qualification remain mandatory hardware gates.

Implementation commit: `7430e62`.
