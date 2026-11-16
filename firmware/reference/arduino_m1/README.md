# RMP device firmware: milestone 1 (Arduino IDE, ESP32-P4)

Target: Waveshare **ESP32-P4-Module-DEV-KIT**. Spec: *Reactor Monitoring Platform, Master Technical Design Document* (v1.2, "TDD").

> **Status, read this first.** Nothing here has run on hardware, and the sketch has **not been compiled against the ESP32 Arduino core**
> (the toolchain hosts are not reachable from where it was written). What *was* verified off-target:
> the flash ring buffer logic (18 checks, NOR-flash simulator), the PT100 conversion against the IEC 60751 table (worst error 0.013 °C),
> and the compile-time guards (pin map, Heidolph command allow-list). The Arduino API calls were checked by reading the core's own headers.
> Expect to fix a few small compile errors on the first build, and to work through the bench checklist below.

## 1. Arduino IDE setup

| Setting | Value |
|---|---|
| Board manager | **esp32 by Espressif Systems, 3.3.x or newer** (Waveshare lists 3.2+ for the P4; use the newest 3.3.x, since Wi-Fi through the C6 depends on ESP-Hosted support in the core) |
| Board | **ESP32P4 Dev Module** |
| Flash Size | **16MB** |
| Partition Scheme | **Custom** (the IDE then uses `partitions.csv` from this folder) |
| PSRAM | Enabled (default) |
| USB CDC On Boot | **Disabled** so `Serial` is UART0 on the Type-C UART port (CH343P) |
| Chip Variant | match your silicon: read `chip revision` from the first boot log (pre-v3 vs v3+) |
| Upload | Type-C **UART** port. DTR/RTS auto-reset works through EN and GPIO35 (BOOT) |

Libraries (Library Manager): **PubSubClient** (Nick O'Leary), **ArduinoJson 7.x**. Everything else ships with the core.

Open `RMP_Firmware.ino` (the folder name must stay `RMP_Firmware`). Serial console is 115200; type `help`.

## 2. Pin map (from the schematic)

Header numbers are P6 pins (2x20).

| Signal | GPIO | P6 pin | Notes |
|---|---|---|---|
| DWIN TX / RX (UART1) | 21 / 20 | 12 / 14 | 5 V power for the DWIN from header 1 or 3 |
| Heidolph RS232 TX / RX (UART2) | 23 / 22 | 8 / 11 | through the isolated RS232 transceiver |
| MAX31865 SCK / MOSI / MISO / CS / DRDY | 3 / 2 / 6 / 5 / 4 | 20 / 22 / 16 / 15 / 17 | 3V3 = pin 18 and GND = pin 19 sit beside this block |
| Buttons Menu / Up / Down / Select | 32 / 33 / 26 / 27 | 25 / 30 / 32 / 37 | active-low; 32/33 already have 2.2 kΩ pull-ups on the board |
| Spare | 0, 1 | 24, 21 | |

Board-reserved (never reuse): console 37/38, I2C 7/8, I2S 9–13, PA enable 53, Ethernet 28–31/34/35/49–52, C6 SDIO 14–19 (internal), USB 24/25, strapping 34–38.
`pins.h` enforces this at **compile time**: a duplicate, a reserved pin, or a GPIO39–48 pin stops the build.

## 3. What the schematic told us (TDD `[VERIFY]` items)

- **Ethernet works as the TDD assumes.** IP101GRI on RMII; MDC 31, MDIO 52, reset 51; the PHY drives the 50 MHz reference into **GPIO50**, so the EMAC uses an *external clock input*. These match the core's default P4 pins, and `ETH.begin(..., EMAC_CLK_EXT_IN)` is what the code uses.
- **Wi-Fi is the on-module ESP32-C6**, attached over SDIO on GPIO14–19, which are not on the header. It runs through ESP-Hosted, so the C6 needs its slave firmware flashed (TDD: factory step).
- **There is no 32.768 kHz crystal.** A coin-cell connector feeds VBAT through a Schottky from 3V3. So the RTC survives short power cuts on the cell, but runs from the internal RC oscillator and **will drift**. That is the case the TDD's "RTC as bridge, NTP as truth" design already covers. **Measure the drift on the bench** to size the 24 h trust window (`RTC_MAX_UNSYNCED_H`).
- **GPIO39–48 sit on the VO4 IO domain.** The core's generic P4 variant auto-enables the internal LDO VO4 when you use a pin in that range, and this board ties the VO4 net to 3V3 through R80. I deliberately kept every product signal out of 39–48. If you ever need them, check R80 first.
- **I2S direction trap.** The core's stock P4 variant defines `I2S_DOUT=11 / I2S_DIN=9`; this board is the opposite (ES8311 DSDIN = GPIO9). `pins.h` follows the schematic.
- **GPIO53 does double duty:** it enables the audio amplifier (via R52) *and* appears on header pin 36. Don't drive it from outside.
- **Power:** the header "5V" pins feed the on-board 5 V → 3.3 V buck. Check the buck's maximum input in its datasheet. A 12–24 V industrial supply almost certainly needs an external converter.
- **Audio hardware exists** (ES8311 codec + NS4150B amp). `audio.h` is present but disabled (`ENABLE_AUDIO 0`) until the codec init is verified on the bench.

## 4. TDD coverage

| TDD area | State |
|---|---|
| 1 Hz acquisition, idle stretching (1 in 10 s), timestamp taken at cycle start | done |
| PT100 via MAX31865, Callendar–Van Dusen, calibration `a·T+b`, SUSPECT/BAD quality | done (host-verified math) |
| Heidolph read-only driver, 9600 8N1, ≥120 ms gap, **build fails if a non-allow-listed command is added** | done; reply formats `[VERIFY]` (use `motor` console command) |
| Flash ring: 9 MB, 28 B records, 64 B sector headers, write-ahead, per-boot ack, GAP accounting, reboot-safe tail | done (host-verified) |
| Partition table = TDD 7.6 (0.5 MB / 4 MB app / 1 MB config / 1.5 MB spare / 9 MB ring, no OTA) | done |
| Time: RTC bridge, NTP, `TIME_ANCHOR`, sync-state flags | done (verify RTC retention on hardware) |
| Ethernet + Wi-Fi, ack-based failover (15 s) and failback (60 s), `NET_FAILOVER/FAILBACK` events | done, untested |
| MQTT over mTLS, state/LWT/30 s heartbeat, `tele/batch` and `tele/backlog` (50 rows, ≤20 msg/s), `ack/data`, `cfg/desired`, `event` | done (see deviations) |
| Commands: `set_calibration`, `set_network`, `reboot`, `set_assignment` (bench form: start/stop + attempt id) | partial |
| DWIN: write readings and net status, never show a stale value | partial: VP addresses and baud are `[VERIFY]` |
| Buttons: debounce, short/long/3 s-hold events | done; no UI state machine yet |
| Serial console: provisioning (cert/key/CA paste, broker, NTP, Wi-Fi) + bench commands (`motor`, `rtd`, `time`, `status`) | done |
| **Not started (milestone 2):** alert engine (thresholds, catalog, silence/override with PIN), durable event queue, assignment cache + full run/post-process state machine, `set_thresholds/policy/alert_catalog`, `live_boost`, `override_alert`, DWIN pages/menus, calibration CRC and valid-to check, factory enrolment flow | todo |

## 5. Deviations from the TDD, and what the backend must tolerate

1. **MQTT 3.1.1, not MQTT 5.** PubSubClient is 3.1.1. Consequences: no correlation data (command replies carry the command `id` **in the JSON** of `ack/cmd`; your backend should accept both), and device publishes go out at **QoS 0**.
   Delivery is still guaranteed because the data-ack + replay path is application level (`ack/data` frees the ring; unacked data is resent after 15 s) and the server de-duplicates on `(device_id, boot, seq)` as specified. The subscriptions (`cmd/#`, `ack/data`, `cfg/desired`) are QoS 1 with a persistent session. Switching to the ESP-IDF `esp-mqtt` client (QoS 1, MQTT 5 if the core's build enables it) is a contained change inside `mqtt_link.h`; say if you want it.
2. **Events are RAM-queued in M1.** The TDD says events are sequenced, acked and durable. M1 keeps the last 8 in RAM and sends them on the next connection (`offline_origin: true` when late). A power cut still loses them.
3. **`attempt` is `null`** in a batch when no run is active (idle samples). The TDD example only shows a UUID.
4. **`mono` is a 32-bit uptime in ms** and wraps at 49.7 days; the firmware rotates the sector header at the wrap. Make sure the server's `TIME_ANCHOR` handling copes, or tell me to move to 64-bit.
5. **Flash encryption caveat.** Records are 28 bytes at arbitrary offsets. If you enable P4 flash encryption (TDD Part 2 `[VERIFY]`), writes must be 16-byte aligned and the ring writer needs a 32-byte-padded buffer. Decide this before you freeze the record format.

## 6. Bench checklist (first power-up)

1. Build and flash; open the console, type `status`.
2. `rtd`: expect `cfg=0xD1` (3-wire) or `0xC1` (2/4-wire), a non-zero raw code, fault `0x00`. Raw `0x0000/0xFFFF` means no SPI response (check isolator power and wiring).
3. `motor`: record the **raw replies** to `r`, `m`, `f`, `t`, `T`, `Q`. Then fix `firstNumber()/parseFault()` and `MOTOR_TQ_SCALE_NCM` in `motor_hei.h` / `config.h`.
4. Plug in Ethernet: log should show an IP; confirm the PHY address autodetect and link speed.
5. Provision: `set devid …`, `set broker HOST 8883` (or `auto` for mDNS), `pem ca` / `pem cert` / `pem key` (paste, then `END`), `reboot`. Watch `state` appear on the broker.
6. Pull the Ethernet cable with `set wifi SSID PASS` configured: expect a `NET_FAILOVER` event within about 15 s, and no sample loss on the server.
7. Power-cycle with and without the coin cell: check the `clock` field (`UNSYNCED` / `RTC` / `NTP`) and measure drift over 24 h.
8. DWIN: confirm baud and every VP address in `config.h` against the DGUS project.
9. Disconnect the broker for 10 minutes: `buf_pct` rises, then watch the 50-row `tele/backlog` replay after reconnect.

## 7. Files

| File | Purpose |
|---|---|
| `RMP_Firmware.ino` | tasks: sampler (core 1, 1 Hz), network/MQTT (core 0), UI; serial console |
| `pins.h`, `config.h` | verified pin map with compile-time guard; every tunable and `[VERIFY]` constant |
| `rmp_types.h` | 28 B record and 64 B sector header (size-asserted), CRC-16 |
| `ring_store.h` | flash ring buffer with ack-driven tail |
| `proto_parse.h` | backend-contract parsing (calibration cmd, `cfg/desired` binding, UUID check, NaN-safe numbers); host-tested |
| `time_sync.h`, `net_mgr.h`, `mqtt_link.h`, `prov.h`, `app_state.h` | time, links + failover, protocol, NVS provisioning, calibration/run state |
| `rtd_max31865.h`, `motor_hei.h`, `dwin.h`, `buttons.h`, `audio.h` | device drivers |
| `partitions.csv` | TDD 7.6 flash plan |
| `tests/` | host tests: `test_ring.cpp`, `test_rtd.cpp` (`g++ -std=c++17 -I shim -I ..`), `test_proto.cpp` (needs ArduinoJson 7 sources: `-I <ArduinoJson>/src -I ..`) |

## 8. Conformance with the backend Firmware Integration Guide (2026-11-07)

Found by checking this firmware against the guide, and fixed in this revision:

| Problem | Effect before | Now |
|---|---|---|
| `set_calibration` read `a`/`b` at the top level; the guide nests them in `coefficients` | calibration silently applied as a=1, b=0 and acked `applied` | reads `coefficients.a/b`; missing, non-numeric, wrong channel or out-of-range is **rejected** with a reason |
| A failed PT100 read stored NaN and was printed as `nan` | invalid JSON: the whole batch is rejected, never acked, resent forever, then false failovers | sent as `null` |
| Events used `utc`; the guide's field is `ts` and `TIME_ANCHOR` carries the anchor's own `ts`/`mono` | server could not record the sync time | `ts` (only when the clock is synced), anchor values for `TIME_ANCHOR`, `offline_origin` |
| Unbound/unclaimed device: server drops batches and sends no ack | resend loop, then ack-based failover flapping every 15 s | `cfg/desired` `binding: null` holds publishing (data stays in flash); with no ack ever seen, acks are not used to judge the link; resend back-off; failover at most once per 60 s |
| `state` carried extra fields (`clock`, `buf_pct`, `run`) | risk if the server validates strictly | only the guide's fields; `ts` only when synced |
| `NET_FAILOVER` event was published on the dead link | always lost | queued and sent after reconnect |
| `set_network` and `reboot` accepted over MQTT while the broker has no ACL (Known gap 1) | any CA-signed client could redirect or reboot a device | `set_network` off (`CMD_ALLOW_SET_NETWORK`), `reboot` switchable |
| Calibration and run-attempt shared between tasks without a lock | a torn UUID could reach the server | spinlock-protected copies; UUID format validated |
| TLS handshake timeout was 120 s | net task frozen while the broker is down | 8 s; failure logs the mbedTLS error |

**Still open, needs your backend answer** (the guide is silent or ambiguous):

1. `set_calibration.version`: the guide's example shows a string (`"..."`), the ack wants an integer. Both numeric forms are accepted; a non-numeric string (e.g. a UUID) is rejected as `bad-version`. Tell me the real type.
2. Are `null` values inside `d` rows accepted? A failed PT100 read now sends `t` and `t_raw` as `null`.
3. Dedup key is `(ts, deviceId, boot, seq)`. For `tsync:0` batches the server substitutes receipt time as `ts`, so a **resent unsynced batch is not deduplicated**. Synced batches are safe. Either the key should drop `ts`, or accept the rare duplicate.
4. `ESTIMATED` (RTC-bridged) samples go out as `tsync:0`, so the server stamps them with receipt time; Known gap 5 means they are never corrected. Replays after an outage that started while ESTIMATED lose their real times. Option: send `tsync:1` with the `TIME_ESTIMATED` flag; the guide says not to, so it needs your OK.
5. MQTT 3.1.1 against a "v5 required" backend: Mosquitto accepts both, and the guide says `id` is always in the JSON, so it should work. Test `cmd` and `ack/cmd` end to end first.
6. Broker certificate: connect by a DNS name that is in the server cert's SAN. Do not rely on an IP SAN (mbedTLS support varies). TLS also validates certificate dates, so a device whose clock is still 1970 will fail the handshake; the log prints the reason.
7. `boot` is an NVS counter. A full flash erase resets it to 1, which would collide with an earlier boot 1 on the server. Do not erase NVS on a device that has been in service.
8. The mTLS private key sits in plain NVS. Without NVS/flash encryption, anyone with the board can read it.
