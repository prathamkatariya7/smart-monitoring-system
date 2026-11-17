# RMP Firmware — Bench Wiring Guide (M1)

**Audience:** whoever is wiring the PT100/MAX31865, Heidolph motor, DWIN display, and
buttons to the Waveshare ESP32-P4-Module-DEV-KIT for the first time.
**Status:** none of this hardware is connected yet (as of 2026-11-09). The firmware
drivers for all four peripherals build cleanly against the real `esp32p4` target, but
every reading/reply/frame below is `not tested` until you wire the board and run the
console commands in this guide. See `docs/SPEC.md` section 11 for the specific open
items ([VERIFY]) that only bench testing can resolve.

All pin numbers below are **P6 header pin numbers** (the 2x20 header), with the GPIO
number in parentheses — read them straight off the board silkscreen. The authoritative
source is `components/rmp_types/include/rmp_pins.h`; if the two ever disagree, trust the
header file (it has a compile-time check; this guide doesn't).

**Before you start:** power the board only from its Type-C UART port during bench work.
All P6 GPIOs are **3.3 V and not 5 V tolerant** — connecting any 5 V signal directly to a
P6 pin can damage the chip permanently. Where a peripheral is natively 5 V (see the DWIN
section), you need a level shifter or a transceiver that outputs 3.3 V logic, not a
direct wire.

---

## 1. MAX31865 + PT100 (temperature)

| Signal | P6 header pin | GPIO |
|---|---|---|
| SCK | 20 | 3 |
| MOSI | 22 | 2 |
| MISO | 16 | 6 |
| CS | 15 | 5 |
| DRDY (optional) | 17 | 4 |
| 3V3 | 18 | — |
| GND | 19 | — |

Wire the MAX31865 breakout's SCK/MOSI/MISO/CS to the four pins above, and its own 3V3/GND
to header pins 18/19 (right next to the SPI pins). Leave DRDY unconnected if you don't
want to wire it — the driver polls instead of using the data-ready interrupt.

**Reference resistor:** your board's `Rref` is **430 ohm** (confirmed by you, not the
MAX31865 breakout's common 400 ohm default) — this is already set in
`components/rmp_types/include/rmp_config.h` (`RTD_RREF = 430.0f`). If you swap to a
different MAX31865 board later, check its silkscreen/datasheet for the fitted reference
resistor and update that constant — getting this wrong silently shifts every temperature
reading by a few degrees without any error being raised.

**PT100 wiring (3-wire, `RTD_WIRES=3` in the firmware):** a 3-wire PT100 has two wires
tied together on one end (both going to one of the MAX31865's "RTD+" screw terminals) and
the third wire going to the other RTD+ terminal; "F-" (force) and "RTD-" (return) share
the remaining terminal pair per the breakout's own silkscreen — follow your specific
breakout board's 3-wire diagram, they are not all laid out identically.

**Bench test (no real PT100 needed — fixed resistors are the actual M1 acceptance test):**
connect fixed resistors across the RTD+ /RTD- terminals in place of a real sensor and
confirm the firmware reads close to the IEC 60751 table value:

| Fixed resistor | Expected reading |
|---|---|
| 100.00 ohm | 0 °C |
| 119.40 ohm | 50 °C |
| 138.51 ohm | 100 °C |

Pass criteria (per `docs/SPEC.md` M1 table): within 0.3 °C of each value.

**Console commands once wired:**
```
> rtd
MAX31865 cfg=0x?? rtd_raw=0x???? fault=0x?? (0x0000/0xFFFF raw = no SPI response)
> status
fw 0.1.0-idf-m1  rtd init-ok (T=0.02 C, R=100.01 ohm)
```
If `rtd` reports `not initialized`, double check the SPI wiring and that 3V3/GND actually
reach the breakout (a floating/unpowered MAX31865 reads back as "no SPI response", which
is exactly what you'll see right now with nothing connected).

---

## 2. Heidolph motor controller (RS232, read-only)

| Signal | P6 header pin | GPIO |
|---|---|---|
| TX (P4 → transceiver) | 8 | 23 |
| RX (P4 ← transceiver) | 11 | 22 |

This firmware never sends anything to the motor except the seven read-only queries
(`r m f t T Q z` — speed/torque/fault/motor-temp/type/serial/timer). There is no code
path that can send an arbitrary string or a write command (enforced by a
`static_assert` in `components/rmp_motor/include/rmp_motor.h` that fails the *build* if
the allow-list is ever changed) — this is a deliberate RS232 wiring note, not a software
limitation you need to work around.

You need an **isolated RS232-to-TTL transceiver** between the P4's 3.3 V UART2 pins above
and the Heidolph's actual RS232 port (which uses ±12 V signaling, not 3.3 V) — never wire
a DB9 RS232 port directly to a GPIO. Standard DB9 (female, at the Heidolph end) reference:
pin 2 = RXD (Heidolph transmits here), pin 3 = TXD (Heidolph receives here), pin 5 = GND.
Your transceiver board handles the ±12V↔3.3V conversion; just make sure its TTL-side
TX/RX land on the P4 pins above (TX→RX, RX→TX, crossed, as with any UART link) and its
RS232-side DB9 lines go to the Heidolph.

**Console command once wired:**
```
> motor
  speed r       -> raw '...'
  torque m      -> raw '...'
  fault f       -> raw '...'
  motor temp t  -> raw '...'
  type T        -> raw '...'
  serial Q      -> raw '...'
```
**This is the exact mechanism the spec uses to resolve the `[VERIFY]` on reply format**
(SPEC.md section 11, item 6): run `motor`, copy the raw reply text for each query exactly
as printed, and send it to me. I'll then tighten `firstNumber()`/`parseFault()` in
`components/rmp_motor/rmp_motor.cpp` to match the real format instead of the
best-effort parser currently there (which assumes the first numeric token in the reply is
the value — true for many simple RS232 instruments, but not yet confirmed for this one).

---

## 3. DWIN display (UART1, write-only from the firmware)

| Signal | P6 header pin | GPIO |
|---|---|---|
| TX (P4 → DWIN RXD) | 12 | 21 |
| RX (P4 ← DWIN TXD) | 14 | 20 |

**Power safety note:** DWIN DGUS-II displays are very commonly powered at **5 V**, and
some models have 5 V-logic-level UART pins. Check your specific DWIN display's datasheet
before connecting:
- If its UART logic is already 3.3 V-tolerant (many modern DWIN models are), you can wire
  TX/RX directly to the pins above.
- If its UART logic is 5 V, you **must** use a level shifter/divider on the DWIN→P4 (RX)
  line at minimum — feeding 5 V into GPIO20 directly can damage it. The P4→DWIN (TX) line
  is usually fine either way since most 5V inputs tolerate a 3.3V "high", but check the
  datasheet rather than assuming.
- Power the DWIN display from its own appropriate supply (5V most likely), not from the
  P4's 3V3 rail.

**Baud rate and VP (variable pointer) addresses are `[VERIFY]`** against your actual DGUS
project file — the firmware currently uses the Arduino prototype's placeholder values
(115200 baud; VP_TEMP=0x1000, VP_RPM=0x1002, VP_TORQUE=0x1004, VP_NET_TXT=0x2020). If your
DGUS project defines different addresses, send me the project file (or just the VP address
list) and I'll update `components/rmp_types/include/rmp_config.h` to match — don't rewire
anything to work around a wrong address, the fix is a config change on my side.

**Verification once wired:** there's no dedicated console command yet (M1 doesn't wire
DWIN output into the console loop — that lands with the sampler in M2, since showing live
readings needs the RTD/motor polling loop). For now, the way to sanity-check the link is
visual: `app_main` doesn't currently push anything to the display either, so you'd see no
change — tell me once this is wired and I'll add a quick `dwin test` console command that
pushes a known value to `VP_TEMP` so you can confirm the frame format against your
display before we wire it into the real sampler loop.

---

## 4. Buttons (Menu / Up / Down / Select)

| Button | P6 header pin | GPIO | Board pull-up? |
|---|---|---|---|
| Menu | 25 | 32 | yes (R49) |
| Up | 30 | 33 | yes (R50) |
| Down | 32 | 26 | no — firmware enables internal pull-up |
| Select | 37 | 27 | no — firmware enables internal pull-up |

All four are **active-low**: wire one side of each pushbutton to the GPIO pin above, and
the other side to any GND pin on the header (e.g. header pin 5, 10, 13, 19, 26, 29, 33, or
40). No external resistor needed for any of them — the firmware enables the internal
pull-up on all four regardless of whether the board already has one, so a press simply
pulls the pin to 0V.

**Console behaviour once wired:** button events print continuously (no command needed —
this runs in its own background task):
```
[btn] Menu SHORT
[btn] Up LONG
[btn] Select HOLD3
```
- `SHORT`: pressed and released within 600 ms.
- `LONG`: held ≥1.5 s (fires once, while still held).
- `HOLD3`: held ≥3 s (fires once, while still held) — reserved for destructive actions in
  later milestones, not acted on yet.

---

## 5. After wiring: how to flash and watch the console

```powershell
. "D:\Pratham\Firmware\Cortex IDE\Smart Monitoring System\firmware\activate-esp-idf.ps1"
cd "D:\Pratham\Firmware\Cortex IDE\Smart Monitoring System\firmware"
idf.py -p COM20 flash monitor
```
(Replace `COM20` if the port changed — check Device Manager, same note as the M0 gate
test. Close Arduino IDE's Serial Monitor first if it's open, same reason as before: it
holds the COM port open and blocks esptool.)

Once connected, type `help` at the `>` prompt for the full command list, or just watch
for `[btn]` lines as you press buttons.
