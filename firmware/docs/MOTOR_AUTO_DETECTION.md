# Motor auto-detection and identity traceability

## Supported hardware

The ESP32 motor port supports two read-only RS-232 profiles:

| Vendor | UART profile | Detection commands | Telemetry commands | Identity limits |
|---|---|---|---|---|
| IKA EUROSTAR control | 9600 baud, 7 data bits, even parity, 1 stop bit, no flow control | `IN_NAME`, then numeric `IN_PV_4` and `IN_PV_5` | `IN_PV_4` speed, `IN_PV_5` torque | The supplied IKA command table does not expose the type-plate serial number; the database records it as unavailable unless commissioning metadata supplies it. |
| Heidolph Hei-TORQUE | 9600 baud, 8 data bits, no parity, 1 stop bit, no flow control | `T` and `Q` | Existing read-only `r`, `m`, `f` commands | Model and serial are captured from the read-only replies when the motor returns them. |

The IKA values are normalized to RPM and Ncm. The IKA datasheet identifies the torque unit as Ncm in the technical data/torque graphs. Heidolph torque scaling remains the existing configured calibration and must be bench-confirmed against the installed model before GMP release.

## Detection safety

Detection and polling never send `START_4`, `STOP_4`, `RESET`, `OUT_*`, or any other write/setpoint command. Unknown or unresponsive hardware remains `UNKNOWN`; the firmware does not guess a vendor and reports invalid motor telemetry rather than publishing zeros as valid measurements. After three failed polls, the manager clears the active identity and safely retries both profiles, allowing a controlled hot swap to be detected.

The identity is published in the MQTT `state` heartbeat and as a `MOTOR_IDENTIFIED` event. The server updates the device's current identity fields and coalesces observations into `device_motor_identity`, retaining first-seen, last-seen, observation count, protocol, model and serial where available. This makes the record recoverable after missed events and auditable across motor replacement.

## Commissioning requirements

1. Use a correctly level-shifted, isolated RS-232 electrical interface. ESP32 UART pins are not directly RS-232 voltage tolerant.
2. Verify the motor model's cable pinout and signal direction before connecting power.
3. Confirm the IKA/Heidolph reply strings and torque units on the actual installed model using a current-limited bench setup.
4. Confirm that a no-motor boot stays `UNKNOWN`, does not issue a motor-control command, and keeps the HMI motor values invalid (`---`).
5. Confirm both vendors independently with the motor stopped, then test live RPM/torque against an independent reference.
6. Only after validation should a pharmaceutical production release approve the motor identity and torque calibration for the reactor's equipment profile.
