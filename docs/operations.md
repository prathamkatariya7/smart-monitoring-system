# Operations and troubleshooting

## Health

`GET /health` reports database, MQTT, disk, backup and licence checks. `degraded` requires operator review; it is not equivalent to a healthy production release.

## No motor detected

Check RS-232 level shifting, TX/RX direction, cable pinout, motor power, vendor UART profile and raw bench replies. The firmware must remain safe and must not issue control commands while diagnosing. Confirm the HMI shows invalid motor values rather than zero-as-valid.

## Identity not visible in the Devices page

Check MQTT broker connection, the `state` topic device ID, backend logs, migration `1730000000014-MotorIdentity`, and the device's tenant/lab scope. Query current fields and `device_motor_identity`; do not repair records by editing production SQL without an approved change.

## Database or MQTT outage

Preserve logs, confirm backups, restore service dependency first, then inspect ingestion retry and duplicate behavior. Do not delete queued telemetry or audit history to clear an alert.

## Frontend stale state

Check WebSocket connection and API response timestamps, reload the affected route, and inspect browser console/network output. A frontend refresh must not bypass backend authorization.
