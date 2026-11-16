# RMP ESP-IDF Build Spec for the Antigravity Agent

This is the instruction document for an AI coding agent that builds the production firmware of the Reactor Monitoring Platform device in **ESP-IDF** (ESP32-P4 on the Waveshare ESP32-P4-Module-DEV-KIT), replacing the Arduino prototype. One decision here differs from the original design document: **Wi-Fi is the primary link and Ethernet is the fallback**. Everything marked **\[VERIFY\]** is unconfirmed and the agent must ask the owner instead of guessing.

## 0. How to use this with the agent

1. Create a project folder, for example `rmp-fw/`, with these inputs and open it in Antigravity:

| Path | Content |
| --- | --- |
| `docs/SPEC.md` | this document, exported as Markdown |
| `docs/integration-guide.md` | the backend's Firmware Integration Guide (wire contract) |
| `docs/TDD.pdf` | Reactor Monitoring Platform Master Technical Design Document |
| `docs/schematic.pdf` | ESP32-P4-Module-DEV-KIT schematic |
| `reference/arduino_m1/` | the Arduino prototype sources and host tests (revision 5) |

2. Paste the starting prompt below as the first message.
3. The agent works one milestone at a time (section 9). It must stop after each milestone and report. Review and merge before the next one.
4. Never let the agent flash, erase or write to the ESP32-C6, or run `erase-flash`, without your explicit approval for that single command.

### Starting prompt (copy and paste)

```text
You are building production firmware for the Reactor Monitoring Platform device in ESP-IDF (target esp32p4, Waveshare ESP32-P4-Module-DEV-KIT).
Read in this order: docs/SPEC.md, docs/integration-guide.md, docs/schematic.pdf, docs/TDD.pdf, then reference/arduino_m1/.
Rules:
- docs/integration-guide.md is the wire contract and wins over everything else about MQTT topics and JSON.
- The schematic wins for pins. Never invent a pin, register value, command reply format or protocol detail. Where SPEC.md says [VERIFY], ask me.
- Wi-Fi is the PRIMARY link and Ethernet the FALLBACK (SPEC.md section 5). This overrides the TDD default.
- Work one milestone at a time (M0 to M6). After each milestone: clean build, host tests pass, run the listed acceptance tests, summarise results, then stop and wait for me.
- Do not flash, erase or write the ESP32-C6, and do not run erase-flash, without asking me for that exact command.
- Never print or log certificates, private keys or Wi-Fi passwords.
Start with M0.
```

## 1. Source of truth and decisions

When two sources disagree, the higher one wins:

1. `integration-guide.md`: MQTT topics, payload shapes, identity, server behaviour.
2. The schematic: every pin and board fact.
3. This spec: decisions below.
4. The TDD: device behaviour not covered above (alerts, UI, run states).
5. `reference/arduino_m1/`: working, host-tested algorithms to port. It also contains known bugs (listed below), so never copy from it blindly.

| Decision | Value |
| --- | --- |
| Framework | ESP-IDF v5.5.x, not Arduino. The backend needs MQTT 5 and QoS 1, which only the ESP-IDF client (`esp-mqtt`) provides. Waveshare also recommends ESP-IDF over Arduino. |
| Network priority | **Wi-Fi primary, Ethernet fallback.** Setting `network_priority` = `wifi_then_eth` (default) or `eth_then_wifi`. The TDD default was the opposite. |
| MQTT | `esp-mqtt`, MQTT 5, mutual TLS, QoS 1, persistent session, last-will on `state`. |
| Flash | 16 MB, single app slot, **no OTA** (TDD 7.6). Partition table in section 7. |
| Time | SNTP is the truth; internal RTC bridges short power cuts. No 32 kHz crystal is fitted, so the RTC drifts. |
| Heidolph motor | read-only. Allow-listed queries only, enforced at compile time. |
| Secrets | CA, client certificate, private key and Wi-Fi password live in NVS, entered over the serial console, never logged. |

### Bugs in the Arduino prototype that must not be ported

- `set_calibration` coefficients are nested: `coefficients.a` and `coefficients.b`, not top-level `a` and `b`. Missing or invalid values must be **rejected**, never applied as a=1, b=0.
- A failed PT100 read must be sent as JSON `null`, never as `nan` (invalid JSON makes the server reject the whole batch).
- Event timestamp field is `ts` (epoch ms, only when the clock is synced), not `utc`.
- When `cfg/desired` says `binding: null`, hold publishing (data stays in flash). Do not let missing acks drive a link failover.
- Reply `ack/cmd` with the MQTT 5 correlation data **and** the `id` in the JSON.
- Do not send extra fields in `state` beyond those the guide defines.

### What to port from the prototype

The 28-byte record and 64-byte sector header layout, the flash ring algorithm (`ring_store.h`, with its 18 host tests), the Callendar-Van Dusen conversion with its IEC 60751 test table, the DWIN frame formats, and the columnar batch JSON. Keep the same host tests passing in the ESP-IDF project (`test_host/`).

## 2. Toolchain and project setup (Windows, Antigravity)

1. **Editor extension.** Antigravity installs extensions from the Open VSX registry. Install Espressif's ESP-IDF extension (the owner confirms it is available). If a build needs a different route, install ESP-IDF with Espressif's installer and run `idf.py` in the integrated terminal. **\[VERIFY\]** how the extension installs in Antigravity.
2. **ESP-IDF version: v5.5.x.** Waveshare's factory demo was built with v5.5.2. Do not use v6.x yet: Waveshare's example selects different Wi-Fi coprocessor packages for IDF below and above 6.0.
3. **Windows pitfall.** After activating ESP-IDF v5.5.x, `ESP_IDF_VERSION` must be `5.5`, not `5.5.4`. A wrong value silently breaks the `esp_wifi_remote` Kconfig and ends in the confusing build error `Unknown Slave Target`. Check with `echo $env:ESP_IDF_VERSION` in PowerShell. If it shows the full version, set `$env:ESP_IDF_VERSION="5.5"` before building. Reported in [espressif/idf-im-ui issue 868](https://github.com/espressif/idf-im-ui/issues/868).
4. **Target and chip revision.** Run `idf.py set-target esp32p4`. The owner's silicon reports `Chip rev: v1.3`. Keep Waveshare's revision range (minimum v0.1, maximum v1.99 in their demo) and confirm in the first boot log. **\[VERIFY\]**
5. **Serial.** Flash and monitor through the Type-C **UART** port (CH343P). The console is UART0 on GPIO37/38 at 115200. The native USB port is not used.

### Wi-Fi coprocessor packages (copy from Waveshare)

`main/idf_component.yml`, pinned exactly as in Waveshare's `10_wifistation` example for IDF below 6.0:

```yaml
dependencies:
  espressif/esp_wifi_remote: "0.14.*"
  espressif/esp_hosted: "1.4.*"
  idf:
    version: ">=5.5.0"
```

The Arduino prototype used the 2.12.x host, which is a different protocol generation and got no reply from the board's C6. The 1.4.x pairing is the one Waveshare ships examples for, so it is the first thing to try.

### `sdkconfig.defaults`

Start from Waveshare's example values, then add the RMP lines:

```text
CONFIG_IDF_TARGET="esp32p4"
CONFIG_BOOTLOADER_LOG_LEVEL_WARN=y
CONFIG_ESPTOOLPY_FLASHMODE_QIO=y
CONFIG_ESPTOOLPY_FLASHSIZE_16MB=y
CONFIG_COMPILER_OPTIMIZATION_PERF=y
CONFIG_SPIRAM=y
CONFIG_SPIRAM_SPEED_200M=y
CONFIG_SPIRAM_XIP_FROM_PSRAM=y
CONFIG_CACHE_L2_CACHE_256KB=y
CONFIG_CACHE_L2_CACHE_LINE_128B=y
CONFIG_ESP_MAIN_TASK_STACK_SIZE=10240
CONFIG_FREERTOS_HZ=1000
CONFIG_ESP_WIFI_SOFTAP_SUPPORT=n
# RMP additions (confirm each name in menuconfig)
CONFIG_PARTITION_TABLE_CUSTOM=y
CONFIG_PARTITION_TABLE_CUSTOM_FILENAME="partitions.csv"
CONFIG_MQTT_PROTOCOL_5=y
```

### Gate before any RMP code (milestone M0)

Build and run Waveshare's `examples/esp-idf/10_wifistation` **unchanged** with the real SSID and password in `menuconfig`:

- It connects and prints an IP address: the C6 firmware matches. Keep these package versions. No C6 flashing is needed.
- It reports no response from the coprocessor or a version of `0.0.0`: the C6 firmware does not match. **Stop and ask the owner.** The owner may then flash the C6 through connector P2 with a 3.3 V USB-UART adapter. The agent must not do this itself.

## 3. Hardware and pin map

All pins come from the schematic. All GPIOs are 3.3 V and not 5 V tolerant. Put them in one header, `rmp_pins.h`, with a compile-time check (the prototype's `pins.h` has one) that rejects duplicates, reserved pins and GPIO39 to 48.

| Function | Signal | GPIO | P6 pin |
| --- | --- | --- | --- |
| MAX31865 (SPI) | SCK / MOSI / MISO / CS / DRDY | 3 / 2 / 6 / 5 / 4 | 20 / 22 / 16 / 15 / 17 |
| Heidolph RS232 (UART2) | TX / RX | 23 / 22 | 8 / 11 |
| DWIN display (UART1) | TX / RX | 21 / 20 | 12 / 14 |
| Buttons, active low | Menu / Up / Down / Select | 32 / 33 / 26 / 27 | 25 / 30 / 32 / 37 |
| Spare |  | 0, 1 | 24, 21 |

**Reserved by the board, never reuse:**

| Group | GPIOs |
| --- | --- |
| Console (UART0, CH343P) | 37 TX, 38 RX (strapping pins) |
| I2C (audio codec) | 7 SDA, 8 SCL |
| I2S (audio codec) | 9 DOUT, 10 WS, 11 DIN, 12 BCLK, 13 MCLK |
| Audio amplifier enable | 53 |
| Ethernet PHY (IP101) | MDC 31, MDIO 52, reset 51, RMII 49, 34, 35, 29, 30, 28, reference clock input 50 |
| Wi-Fi coprocessor (ESP32-C6) | SDIO 14 to 19, plus GPIO54 (C6 reset in the Arduino variant) |
| USB, boot | 24, 25 (USB), 35 (BOOT), 34 to 38 (strapping) |
| Do not use | 39 to 48 (VO4 IO domain, tied to 3V3 through R80) |

### Ethernet in ESP-IDF

IP101GRI over RMII. The PHY supplies the 50 MHz reference to GPIO50, so the EMAC must take an **external clock input**. Settings: MDC 31, MDIO 52, PHY reset 51, PHY address auto-detect, RMII data pins at the P4 defaults. **\[VERIFY\]** the exact EMAC configuration field names in ESP-IDF v5.5 by copying the Ethernet example in `waveshareteam/ESP32-P4-Platform` and checking it against these pin values.

### Wi-Fi coprocessor

Wi-Fi is on the on-module ESP32-C6, reached over SDIO with ESP-Hosted. In the Arduino core variant the SDIO pins are CLK 18, CMD 19, D0 to D3 on 14 to 17 and reset 54. Use Waveshare's example defaults and do not override them. The C6 programming pins are on connector **P2** (pin 1 U0TXD, 2 U0RXD, 3 GND, 4 IO9) and are used only for flashing the C6, by the owner.

### Power

Power from the Type-C UART port for development. The on-board 5 V to 3.3 V converter's maximum input voltage is unchecked **\[VERIFY\]**, so never feed 12 V or 24 V into the header 5 V pins.

## 4. Architecture and tasks

```text
rmp-fw/
  CMakeLists.txt  partitions.csv  sdkconfig.defaults
  main/               app_main, wiring of components
  components/
    rmp_types/        Rec (28 B), SectorHdr (64 B), flags, crc16
    rmp_ring/         flash ring on the "ring" partition
    rmp_time/         SNTP, RTC bridge, TIME_ANCHOR
    rmp_rtd/          MAX31865 over spi_master, Callendar-Van Dusen
    rmp_motor/        Heidolph read-only driver (UART2)
    rmp_dwin/         DWIN frames (UART1)
    rmp_buttons/      debounce, short / long / 3 s hold
    rmp_net/          Wi-Fi + Ethernet manager (section 5)
    rmp_mqtt/         esp-mqtt MQTT 5 client, batches, acks, commands (section 6)
    rmp_prov/         NVS provisioning + serial console
  test_host/          ring, RTD and JSON tests that run on the PC
```

| Task | Core | Priority | Job |
| --- | --- | --- | --- |
| `sampler` | 1 | 10 | 1 Hz acquisition, timestamp taken at cycle start, write-ahead append to the ring |
| `net_mgr` | 0 | 6 | link state machine (section 5) |
| `uplink` | 0 | 5 | build batches from the ring, handle `ack/data` and commands |
| `ui` | 1 | 4 | DWIN output and buttons |
| `console` | 0 | 3 | serial provisioning and bench commands |

The ESP-Hosted driver runs its own high-priority tasks (priority 23 in Waveshare's log), so the sampler must tolerate preemption: take `esp_timer_get_time()` at the **start** of each cycle and never use time measured after the slow RS232 poll. Flash erase stalls the whole chip for tens of milliseconds. Task watchdog stays enabled, no task busy-waits.

## 5. Network manager: Wi-Fi primary, Ethernet fallback

The prototype and the TDD defaulted to Ethernet first. This section is the new, required behaviour. Implement it in `components/rmp_net`.

### 5.1 Requirements

1. **Hot standby.** Both interfaces start at boot and stay up, so a switch takes seconds. Ethernet starts DHCP as soon as its link is up. Wi-Fi association happens through the C6 without blocking.
2. **One active link.** Policy decides which interface is active. On every switch call `esp_netif_set_default_netif()` explicitly and log it. Do not rely on route priority alone.
3. **Policy setting.** `network_priority` is `wifi_then_eth` (default) or `eth_then_wifi`. Store it in NVS key `net_prio`, set with the console command `set netprio wifi|eth`. The backend's `cfg/desired.network` is always `null` today, so do not depend on it.
4. **Boot never waits for Wi-Fi.** If the C6 does not answer within 15 s, log it once, mark Wi-Fi `unavailable`, retry in the background every 60 s and run on Ethernet. Sampling and flash storage never stop.
5. **Reconnect after every switch.** TCP sessions die when the route changes. The MQTT client reconnects with its persistent session. Flush any cached DNS result.
6. **No reboot for a link problem.** A dropped ESP-Hosted link counts as Wi-Fi lost. It never restarts the P4.

### 5.2 State machine

States: `NONE`, `WIFI` (Wi-Fi is active), `ETH` (Ethernet is active). The table is for the default policy `wifi_then_eth`.

| Current | Trigger | New state and action | Event sent |
| --- | --- | --- | --- |
| NONE | Wi-Fi has an IP | WIFI | none |
| NONE | only Ethernet has an IP | ETH | none |
| WIFI | Wi-Fi lost its IP or disassociated | ETH if Ethernet has an IP, else NONE | `NET_FAILOVER`, reason `link_lost` |
| WIFI | link not delivering (5.3), Ethernet has an IP | ETH; block further health switches for 60 s; block failback for 5 min | `NET_FAILOVER`, reason `no_ack` or `broker_unreachable` |
| ETH | Ethernet lost its link or IP | WIFI if it has an IP, else NONE | `NET_FAILOVER`, reason `link_lost` |
| ETH | Wi-Fi has an IP and RSSI is at least -75 dBm, continuously for 60 s, and no failback block is active | WIFI | `NET_FAILBACK` |
| WIFI after a failback | no ack within 15 s | back to ETH; double the failback block (5 min up to 30 min) | `NET_FAILOVER`, reason `failback_rejected` |
| any | both interfaces down | NONE; keep sampling and buffering | none |

Events go through the event queue of section 6 and carry `from`, `to` and `reason` in the event body. They are queued while the active link is down and sent after the next connection, with `offline_origin: true`.

### 5.3 What counts as "delivering"

- The server is **known to ack** when `cfg/desired.binding` is an object, or when at least one `ack/data` arrived on this connection.
- If the server is known to ack and data is outstanding, the link is delivering when an `ack/data` arrived in the last 15 s.
- If the server is not known to ack (device unbound or unknown), never use missing acks. The link is delivering as long as MQTT is connected.
- If MQTT cannot connect for 15 s on the active link while the other link has an IP, the broker is unreachable on this link: fail over.
- A health-based switch is allowed at most once per 60 s, so a dead backend cannot make the device flap.

### 5.4 Parameters (all constants in one header)

| Constant | Value |
| --- | --- |
| `FAILOVER_NO_ACK_MS` | 15000 |
| `FAILBACK_HEALTHY_MS` | 60000 |
| `FAILBACK_BLOCK_MS` | 300000, doubling on rejected failback, maximum 1800000 |
| `FAILOVER_MIN_SPACING_MS` | 60000 |
| `WIFI_RSSI_MIN_DBM` | -75 |
| `HOSTED_START_TIMEOUT_MS` | 15000 |
| Wi-Fi reconnect back-off | 1 s, doubling, maximum 60 s |

### 5.5 Wi-Fi settings

Station mode only (SoftAP is compiled out). Credentials from NVS keys `wifi_ssid` and `wifi_pass`. 2.4 GHz. Power save off (`WIFI_PS_NONE`) for steady latency. Automatic reconnect with the back-off above. Never log the password.

### 5.6 Hazards the agent must handle and test

- **Both interfaces on the same subnet (the normal lab case).** lwIP chooses the outgoing interface by matching the destination's subnet first, and uses the default interface only when no subnet matches. With both interfaces on the broker's LAN, traffic can leave on the wrong interface even after `esp_netif_set_default_netif()`. Test this (N5 below). If it fails, try in this order and ask the owner before choosing: use ESP-IDF's per-interface route priority (`route_prio`; the defaults put the Wi-Fi station above Ethernet, but confirm how v5.5 applies it); bind the MQTT socket to the active interface's address; stop and restart the standby interface's IP. **\[VERIFY\]**
- **Certificates need a valid clock.** After a switch the TLS handshake checks certificate dates, so SNTP must work on the active link.
- **Broker name.** Connect by a DNS name that appears in the server certificate's SAN list, not by IP.

### 5.7 Acceptance tests

| # | Setup | Pass criteria |
| --- | --- | --- |
| N1 | Boot with Wi-Fi and Ethernet both available | active link is Wi-Fi; `status` shows `link wifi`; no event |
| N2 | Switch the access point off | Ethernet active within 15 s; exactly one `NET_FAILOVER`, delivered after reconnect; no sample gap on the server |
| N3 | Switch the access point back on | after at least 60 s of stable Wi-Fi, one `NET_FAILBACK`; no flapping over 30 min |
| N4 | On Wi-Fi, unplug Ethernet | no switch, no event |
| N5 | Both interfaces on the same subnet | packet capture shows MQTT traffic leaves only on the active interface, before and after each switch |
| N6 | Block the broker on the Wi-Fi path only | failover to Ethernet within 30 s, then at most one health switch per 60 s |
| N7 | Device unbound (`binding: null`) | no failover, no resend loop; data stays in flash and is delivered after binding |
| N8 | Both links down for 10 min, then up | state `NONE` meanwhile; backlog replays via `tele/backlog` at no more than 20 messages per second |
| N9 | Boot with a C6 that does not answer | Ethernet works within 20 s; sampler runs; Wi-Fi retries every 60 s |

## 6. MQTT and the wire contract

`docs/integration-guide.md` is authoritative. This section lists what the firmware must do and the corrections found in the prototype. Use `esp-mqtt` with MQTT 5 (`CONFIG_MQTT_PROTOCOL_5`). **\[VERIFY\]** the MQTT 5 property API names (correlation data, session expiry) in the ESP-IDF v5.5 documentation.

### 6.1 Connection

| Item | Value |
| --- | --- |
| Broker | Mosquitto 2.x, port 8883, mutual TLS. Client certificate required, no user name or password. |
| Server check | verify against the provisioned CA, using a DNS name in the server certificate's SAN list |
| Client identity | certificate and key from NVS. The certificate CN is meant to equal `deviceId` (not enforced yet). |
| Client id, `deviceId` | the UUID returned by the backend's claim call, never the serial number |
| Session | MQTT 5, `clean_start` false, long session expiry, keepalive 30 s |
| Last will | topic `state`, payload `{"online":false}`, QoS 1, retained |
| Subscriptions, QoS 1 | `rmp/v1/{deviceId}/cmd/+`, `.../ack/data`, `.../cfg/desired` |
| Publishes | QoS 1 on every topic |

### 6.2 Topics

| Topic suffix | Direction | Use |
| --- | --- | --- |
| `state` | device to server | birth message at connect, then every 30 s |
| `tele/batch` | device to server | live samples, 10 rows or at most 10 s old |
| `tele/backlog` | device to server | replayed samples, 50 rows per message, at most 20 messages per second |
| `event` | device to server | discrete events |
| `ack/data` | server to device | `{"boot":N,"upto_seq":M}` high-water mark |
| `cmd/{name}` | server to device | commands |
| `ack/cmd` | device to server | reply to a command |
| `cfg/desired` | server to device | retained configuration bundle |

### 6.3 Payload rules

- **`state`**: `online`, `link` (`eth`, `wifi` or `none`), `boot`, `fw`, and `ts` only when the clock is synced. No other fields.
- **Batch envelope**: `v:1`, `boot`, `attempt` (UUID or `null`), `cal`, `fw`, `link`, `tsync` (0 or 1), `f` (column names), `d` (rows). Columns: `seq`, `mono`, `ts`, `t`, `t_raw`, `rpm`, `tq`, `q`, `flt`, `fl`.
- **`tsync`** is 1 only when the clock was NTP-synced at the time of the sample. Otherwise 0, and the server uses its own receipt time. Never send 1 with a guessed clock.
- **`seq`** increases by exactly 1 per stored sample. **`boot`** must change at every power-on and reset: keep a counter in NVS, and never erase NVS on a device in service.
- **`q`** is one character per channel in a fixed order (temperature, speed, torque), each `G`, `S` or `B`.
- **A failed PT100 read** sends `null` for `t` and `t_raw`. **\[VERIFY\]** with the backend that `null` inside rows is accepted.
- **`fl` bits** the device may set: 1 `LATE_CYCLE`, 4 `TIME_ESTIMATED`, 8 `TIME_DERIVED`, 32 `POST_PLANNED`, 64 `STARTED_OFFLINE`, 128 `LINK_DOWN`. Bits 2 and 16 belong to the server and are never set by the device.
- **Every sample is written to flash before it is published.** The ring tail advances only on `ack/data`. Unacked data is resent from the tail after 15 s, with exponential back-off up to 5 min while the server is not acking at all.
- **Duplicates:** the server de-duplicates on `(ts, deviceId, boot, seq)`. A resent batch with `tsync:0` gets a new receipt time, so it is not de-duplicated. **\[VERIFY\]** with the backend.

### 6.4 Binding

The server silently drops telemetry for a device that is not claimed and bound, and sends no error and no ack. Parse every `cfg/desired`:

- `binding` is an object: bound. Publish normally.
- `binding` is `null`: unbound. **Hold publishing**; data stays in flash and is sent after binding. Do not treat the missing acks as a bad link.
- No `cfg/desired` yet: unknown. Wait about 2 s after connecting for the retained message, then publish.
- Write the bundle to NVS only when its `version` changes. The fields `thresholds`, `alertCatalog`, `calibration`, `network` are always `null` today; do not build logic on them.

### 6.5 Commands

`set_calibration` arrives as `{id, cmd, version, channel, method, coefficients:{a, b}}` and means `corrected = a * raw + b`.

- Accept only channel `temp1`. Require both `a` and `b` as finite numbers, `a` between 0.9 and 1.1, `|b|` at most 10, and an integer version (a fully numeric string is also accepted). **\[VERIFY\]** the version type with the backend.
- Apply `a`, `b` and the version atomically so the sampler never sees a mix. Persist to NVS.
- Reply on `ack/cmd` with `{id, status:"applied"|"rejected", applied_version, reason}`. Put the command `id` in the MQTT 5 correlation data **and** in the JSON.
- Any unknown command is answered with `rejected` and a reason. It never crashes.
- The broker has no per-device ACL yet. Do not implement any command that changes network credentials. Keep `reboot` behind a compile-time switch, on by default.

### 6.6 Events

Body: `type`, `boot`, `mono`, `ts` (only when synced), `offline_origin`, plus free fields. Events: `DEVICE_REBOOT` (with the reset reason) at start, `TIME_ANCHOR` after every SNTP sync (its `ts` and `mono` are the anchor's own values), `NET_FAILOVER`, `NET_FAILBACK`, `GAP` (samples overwritten before being acked). Milestone M3 keeps the last 8 events in RAM and sends them after the next connection. A durable event queue in the config partition comes later (M5).

## 7. Storage

`partitions.csv` (TDD 7.6 plan with a core-dump partition carved from the spare area):

```text
# Name,   Type, SubType,  Offset,   Size
nvs,      data, nvs,      0x9000,   0x6000
phy_init, data, phy,      0xf000,   0x1000
factory,  app,  factory,  0x10000,  0x400000
cfg,      data, spiffs,   0x410000, 0x100000
coredump, data, coredump, 0x510000, 0x10000
spare,    data, spiffs,   0x520000, 0x170000
ring,     data, 0x40,     0x690000, 0x900000
```

The app slot is 4 MB and there is no OTA. Enable core dump to flash. If NVS fills up (certificates, keys, Wi-Fi, calibration, boot counter), enlarge it from the spare area and tell the owner.

### Ring buffer

Port `ring_store.h` from the prototype using `esp_partition_read`, `esp_partition_write` and `esp_partition_erase_range`, keeping the on-flash format and behaviour:

- Sector 4096 bytes: 64-byte header (magic, sector sequence, boot, time-sync state, UTC offset, attempt UUID, calibration version, CRC-16) followed by 144 records of 28 bytes (each with CRC-16, CCITT-FALSE). 9 MB is 2304 sectors.
- A new sector starts when the time state, calibration version, attempt or UTC offset (more than 250 ms) changes, and when the 32-bit millisecond counter wraps (49.7 days).
- Write-ahead: a record is stored before it is ever published. The tail advances only on `ack/data`, per boot. Records overwritten before being acked are counted and reported as a `GAP` event.
- The host tests (18 checks, including reboot mid-stream and a corrupted record) must pass unchanged in `test_host/`.
- Flash encryption is not enabled. If the owner enables it, writes must be 16-byte aligned and the record format must change first. **\[VERIFY\]** before freezing the format.

## 8. Device modules

### Sampler

One cycle per second. Take `mono` and the UTC time at the start of the cycle, then read temperature and motor. With no run active, store one sample every 10 s (idle stretching); during a run, store every second. Store the sample, then update the live values for the display.

### PT100 through the MAX31865

SPI mode 1 at about 1 MHz, auto-conversion, 50 Hz filter. Configuration register `0xD1` for a 3-wire sensor, `0xC1` for 2-wire or 4-wire. Resistance is `raw / 32768 * Rref` with the fault bit dropped. Convert with Callendar-Van Dusen (polynomial below 0 C), then apply the calibration `a * T + b`. A fault or no SPI response makes the channel `B`. A value outside -60 to 350 C makes it `S`.

`Rref` must match the reference resistor fitted on the module: 400 ohm or 430 ohm depending on the board. **\[VERIFY\]** on the real board.

Test values (IEC 60751, at `Rref` 400): 100.00 ohm = 0 C, 119.40 ohm = 50 C, 138.51 ohm = 100 C. The prototype's test checks the whole table to within 0.013 C. Keep it.

### Heidolph motor (read-only)

UART2, 9600 baud, 8N1, at least 120 ms between commands. Only the queries `r` (speed), `m` (torque), `f` (fault), `t`, `T`, `Q`, `z` exist. Put them in one constant table and add a compile-time check that fails the build if any other command is added. There is no API that sends an arbitrary string. Reply formats and the torque scale are **\[VERIFY\]**: they are captured on the bench with the console `motor` command and then set from the real text.

### DWIN display

UART1, write only. Baud 115200 and the variable addresses are **\[VERIFY\]** against the DGUS project. Frame: `5A A5 len 82 addrH addrL data`. Integer variables carry the value times 10 for temperature and torque. Text goes to its text address ending in `FF FF`. The temperature variable at `0x1000`, speed `0x1002`, torque `0x1004`, link and clock text `0x2020`. A bad or missing value shows `---`; a stale number is never shown. Update every 500 ms. Do not parse display input before milestone M5.

### Buttons

Four active-low inputs, 25 ms debounce. Events: short press (under 0.6 s, on release), long (1.5 s while held), hold (3 s, destructive actions only).

### Time

SNTP is the truth, with the configured NTP host first and a public pool as fallback. On every sync set the state to `NTP` and queue `TIME_ANCHOR`. The internal RTC bridges short power cuts: trust it for at most 24 h after the last sync, otherwise the state is `UNSYNCED`. No 32 kHz crystal is fitted, so measure the drift on the bench **\[VERIFY\]**.

### Serial console and provisioning

UART0 at 115200. Commands: `help`, `status`, `ring`, `binding`, `rtd`, `motor`, `time`, `set devid`, `set serial`, `set broker HOST [PORT]`, `set ntp`, `set wifi SSID PASS`, `set netprio wifi|eth`, `pem ca|cert|key` (paste, then `END`), `run UUID`, `stop`, `reboot`. Validate that `devid` and the run id are UUIDs. Never echo or log secrets.

## 9. Milestones and acceptance tests

The agent stops after each milestone with a short report: what was built, what passed, what is unverified.

| Milestone | Scope | Done when |
| --- | --- | --- |
| **M0** Toolchain and gate | ESP-IDF v5.5.x working in Antigravity; `ESP_IDF_VERSION` checked; Waveshare `10_wifistation` run unchanged (section 2); empty RMP project builds with `partitions.csv`, `rmp_pins.h` and its compile-time check; host tests ported | the Wi-Fi gate result is reported, the project builds clean, host tests pass |
| **M1** Drivers | PT100, Heidolph (read-only), DWIN output, buttons, serial console, `status`, `rtd`, `motor` commands | the bench checks of the bench guide pass: fixed resistors read 0, 50 and 100 C within 0.3 C; motor loopback echoes `r`, `m`; DWIN frames match the table of the bench guide; button events print |
| **M2** Storage and time | ring buffer, sampler at 1 Hz with idle stretching, boot counter, SNTP and RTC bridge, `ring` and `time` commands | 18 ring host tests pass; reboot keeps records; `time` reaches `NTP` on a network with internet; no sample is lost over a 24 h run |
| **M3** Network and MQTT | section 5 and 6.1 to 6.4: network manager with Wi-Fi primary, esp-mqtt MQTT 5 over mTLS, state, batches, backlog, acks, events, binding hold | acceptance tests N1 to N9 pass; the backend shows the device online with continuous `seq` and no gaps across a failover |
| **M4** Commands and config | `set_calibration` with ack and correlation data, unknown-command rejection, `cfg/desired` handling, reboot switch | a calibration sent from the backend changes `t` and is acked; a malformed one is rejected with a reason |
| **M5** Alerts and UI | alert engine, durable event queue in the config partition, run and post-process state machine, DWIN pages and menus, display input | defined by the TDD; the owner confirms scope first |
| **M6** Hardening | 7-day soak test, watchdog review, flash-encryption decision, factory enrolment flow, README and bench checklist | no unexplained reset in 7 days; all open items below closed |

## 10. Rules for the agent

1. Never invent a pin, a register value, a command reply format or a protocol detail. Ask.
2. The integration guide wins for MQTT. The schematic wins for pins.
3. Never print, log or commit certificates, private keys or Wi-Fi passwords. Keep a `.gitignore` for any local secrets file.
4. Do not flash, erase or write the ESP32-C6, and do not run `erase-flash`, without the owner approving that exact command.
5. The Heidolph driver can only send the read-only commands. Do not add a write command.
6. No OTA, no SoftAP.
7. Every new behaviour in `ring`, the JSON builders and the parsers gets a host test that runs on the PC. Commit small, with a message that says what changed.
8. Keep one constants header for every tunable value, so none is buried in code.
9. Be honest in reports: mark each result as `measured on hardware`, `host test only` or `not tested`.

## 11. Open items for the owner

| # | Question | Needed for |
| --- | --- | --- |
| 1 | Does the C6 work with `esp_hosted` 1.4.x (the M0 gate)? If not, the C6 must be reflashed through P2 | Wi-Fi |
| 2 | Does the backend accept `null` inside batch rows, and what type is the `set_calibration` `version`? | M3, M4 |
| 3 | The dedupe key includes `ts`, so a resent unsynced batch is not de-duplicated. Change the key, or accept rare duplicates? | M3 |
| 4 | Samples taken while the clock is only RTC-estimated are sent as `tsync:0`. Keep, or send `tsync:1` with the estimated flag? | M3 |
| 5 | Reference resistor on the MAX31865 board (400 or 430 ohm) | M1 |
| 6 | Heidolph reply formats and connector pinout; DWIN baud and variable addresses | M1 |
| 7 | On-board buck maximum input voltage, if a 12 to 24 V supply is planned | hardware |
| 8 | Flash encryption: yes or no, before the record format is frozen | M2, M6 |
| 9 | Which network policy do you want by default if both interfaces are on the same subnet and routing misbehaves (section 5.6)? | M3 |
| 10 | Does the Espressif extension install and work in Antigravity (Open VSX)? | M0 |
