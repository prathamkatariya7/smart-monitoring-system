# Reactor Monitoring Platform (RMP) — Complete HMI System Architecture
**Version:** 2.0 (Production Release)  
**Target Hardware:** ESP32-P4 (MCU) + DWIN DGUS-II T5L LCM (Display)  
**Display Format:** 240 × 320 Pixels (Portrait, 24-bit RGB BMP)  
**Communication Bus:** UART1 @ 115200 bps (8-N-1, Half-Duplex RS232/TTL)  
**Governance & Standards:** ISA-18.2 / IEC 62682 (Alarm Management), 21 CFR Part 11 (Audit Attribution), IEC 60601-1-8 (Alarm Usability)

---

## 1. Architectural Foundation & Standard Decisions

### 1.1 Resolution of Open Architectural Questions
In accordance with pharmaceutical engineering and industrial SCADA/DCS standards (ISA-88 batch control and ISA-18.2 alarm management):

1. **Alarm State Synchronization (Edge Autonomous + Server Sync):**
   - **Decision:** Dual-Safety Architecture.
   - **Mechanism:** The ESP32-P4 device evaluates safety thresholds (Max Temperature, Rate-of-Change `dT/dt`) locally at 1 Hz on hardware interrupts. If a safety limit is breached, the HMI screen and hardware buzzer fire with **0 ms network latency**, irrespective of Wi-Fi or MQTT connectivity. Concurrently, the event is published to MQTT (`event` topic) and the server's acknowledgment/return state syncs back down to the HMI via `cfg/desired` and command topics.

2. **Process Lifecycle & Assignment Context:**
   - **Decision:** Desired-State Bidirectional Sync.
   - **Mechanism:** When a Lab In-charge schedules/assigns a batch on the web platform, the backend pushes the assignment payload down via MQTT `cfg/desired`. The ESP32 receives the analyst name, process name, and custom safety thresholds, caches them in NVS/RAM, and automatically flips the HMI from `Idle` to `Assignment`.

3. **Operator Identity & Physical Authentication (No PIN on HMI):**
   - **Decision:** Physical Verification without On-Device PIN.
   - **Reasoning:** In 21 CFR Part 11 compliant environments, user credentialing (JWT, MFA, session tracking) is strictly authenticated on the Web Portal. The physical reactor HMI is hardware-bound to an explicit equipment ID and laboratory. When the analyst taps **`[ ACCEPT ]`** or **`[ START PROCESS ]`**, the device publishes an attributed event (`ASSIGNMENT_ACCEPTED`, `ATTEMPT_STARTED`) linking the assigned user's UUID with hardware timestamping and physical vessel readiness. No cumbersome touch-keypad PIN is required on the 240×320 screen.

4. **Local Siren Muting vs. Server Override:**
   - **Decision:** Local Siren Silence is a physical UX action (`ALERT_MUTED`).
   - **Reasoning:** Pressing `Select` or `Menu` on the device silences the physical buzzer so operators can safely handle the reactor without ear fatigue. This does **not** cancel the alarm condition in the database or server; the red visual banner remains active on the HMI and web dashboard until the temperature drops back within safe limits.

---

## 2. Complete State Machine & Screen Flow

The HMI firmware executes a deterministic 10-screen finite state machine (FSM):

```
                       [0x0000: Power-On POST Boot]
                                    │
                                    ▼
                ┌─────── [0x0002: Wi-Fi Provisioning] ◄── No Wi-Fi Creds
                │                   │ (Connected)
                │                   ▼
                │        [0x0003: Unclaimed / Unbound] ◄── Not Bound to Reactor
                │                   │ (Bound via Web)
                │                   ▼
                └───────► [0x0001: Idle Standby] ◄─────────────────────────┐
                                    │                                      │
                                    │ (MQTT receives Process Assignment)   │
                                    ▼                                      │
                        [0x0010: Assignment Screen]                        │
                               /         \                                 │
                 [REJECT]     /           \  [ACCEPT]                      │
                (Event sent) └─────────────► [0x0011: Pre-Start Checklist] │
                                                  /         \              │
                                    [CANCEL]     /           \ [START]     │
                                                ▼             ▼            │
                                           Page 0x0001   [0x0012: Running] │
                                                          │        ▲       │
                                  [Overheat / RoC Alert]  │        │ (Ack) │
                                                          ▼        │       │
                                                 [0x0013: Alarm] ──┘       │
                                                          │                │
                                       (Process Complete) ▼                │
                                                 [0x0014: Completed] ──────┘

   [Diagnostic Screen (0x0020)]: Accessible from any screen via 3s Hold of MENU button.
```

---

## 3. Exhaustive Screen Specifications (Pixel-by-Pixel)

All coordinates are based on the **240 px (Width) × 320 px (Height)** portrait orientation.

---

### Screen 0: Hardware Boot & POST (`Page 0x0000` / `00_boot.bmp`)
- **Trigger:** Power applied / ESP32 reboot.
- **Duration:** 1.5 – 3.0 seconds during peripheral initialization (RTD, RS232, NVS, Wi-Fi).
- **Layout:**
  - **Background:** Deep Navy (`#0B1220`).
  - **Brand Logo / Emblem:** Centered at `X: 70, Y: 60`, `Width: 100, Height: 70` (`#38BDF8` Cyan/Blue icon).
  - **Product Title:** `"BOROSIL RMP"` (Font: 18px ExtraBold White, Centered `Y: 145`).
  - **Sub-Title:** `"Reactor Monitoring Platform"` (Font: 10px Medium Slate `#94A3B8`, Centered `Y: 170`).
  - **POST Status Box (`X: 20, Y: 210, W: 200, H: 60`):**
    - Border: 1px `#1E293B`, Background: `#0F172A`, Radius: 4px.
    - POST Line 1: `"MAX31865 RTD ... OK"` (9px Mono Green `#10B981`, `Y: 218, X: 28`).
    - POST Line 2: `"RS232 Motor .... OK"` (9px Mono Green `#10B981`, `Y: 232, X: 28`).
    - POST Line 3: `"Crypto / NVS ... OK"` (9px Mono Green `#10B981`, `Y: 246, X: 28`).
  - **Progress Bar (`X: 20, Y: 285, W: 200, H: 6`):** Neon Cyan `#00F0FF` fill.
  - **Firmware Ver:** `"FW v0.1.0-p4"` (8px Slate `#64748B`, `X: 20, Y: 302`).

---

### Screen 1: Idle Standby (`Page 0x0001` / `01_idle.bmp`)
- **Trigger:** Device bound, connected, no process currently executing.
- **Layout:**
  - **Header Bar (`X: 0, Y: 0, W: 240, H: 34`):**
    - Background: `#111C30`.
    - Reactor Name (VP `0x2000`): `"Reactor 25"` (Font: 13px Bold White `#FFFFFF`, `X: 12, Y: 9`).
    - Online Badge (VP `0x2010`): Solid Green pill (`X: 165, Y: 8, W: 63, H: 18`, Radius: 9px), Text: `"● ONLINE"` (9px Bold White).
  - **Sub-Header Info (`X: 12, Y: 38, W: 216, H: 16`):**
    - Lab Name (VP `0x2020`): `"QC Lab 1"` (10px Regular `#94A3B8`, Left-aligned).
    - Clock (VP `0x2040`): `"14:32"` (11px Regular `#94A3B8`, Right-aligned `X: 195`).
  - **Standby Telemetry Card (`X: 10, Y: 58, W: 220, H: 86`):**
    - Background: `#1E293B`, Border: 1px `#334155`, Radius: 8px.
    - Title Label: `"STANDBY VESSEL TEMP"` (10px SemiBold `#64748B`, `X: 22, Y: 68`).
    - Quality Dot: 6px Green Circle (`#10B981`, `X: 198, Y: 72`).
    - Live Value (VP `0x1004`): **`"24.8"`** (Font: **34px Bold `#00F0FF`**, `X: 22, Y: 84`).
    - Unit: `"°C"` (Font: 16px Medium `#38BDF8`, `X: 110, Y: 92`).
    - Raw Sensor (VP `0x1006`): `"Raw 24.9 °C"` (10px `#64748B`, `X: 22, Y: 124`).
    - Cal Tag (VP `0x100A`): `"Cal v1"` (10px `#64748B`, `X: 170, Y: 124`).
  - **Motor Idle Status Card (`X: 10, Y: 152, W: 220, H: 64`):**
    - Split Container: 2 inner zones (`Width: 105` each).
    - Left (Stirrer): Label `"STIRRER"` (9px `#64748B`, `Y: 160`), Value (VP `0x1014`): `"0 RPM"` (16px Bold White, `Y: 178`).
    - Right (Torque): Label `"TORQUE"` (9px `#64748B`, `Y: 160`), Value (VP `0x1016`): `"0.0 N·cm"` (16px Bold White, `Y: 178`).
  - **Standby Action Box (`X: 10, Y: 226, W: 220, H: 82`):**
    - Border: 1.5px Dashed `#334155`, Background: `#0F172A`, Radius: 6px.
    - Status Icon: Hourglass / Clock symbol (`#F59E0B`, `X: 108, Y: 236`).
    - Text 1: `"WAITING FOR ASSIGNMENT"` (Font: 11px Bold Amber `#F59E0B`, Centered `Y: 258`).
    - Text 2: `"Assign via Lab Incharge Web Portal"` (Font: 9px `#64748B`, Centered `Y: 276`).
    - Sub-note: `"Hold Menu 3s for Network Info"` (Font: 8px `#475569`, Centered `Y: 292`).

---

### Screen 2: SoftAP Wi-Fi Provisioning (`Page 0x0002` / `02_prov.bmp`)
- **Trigger:** Device has no Wi-Fi credentials or cannot connect after 2-minute retry window.
- **Layout:**
  - **Header:** Amber banner `"NETWORK SETUP REQUIRED"` (11px Bold White `#FFFFFF`, Background `#B45309`, `Y: 0 – 34`).
  - **Illustration / QR Code Placeholder (`X: 60, Y: 48, W: 120, H: 120`):**
    - Centered Wi-Fi AP Icon or QR code linking to `http://192.168.4.1`.
  - **Instruction Card (`X: 10, Y: 178, W: 220, H: 85`):**
    - Background: `#1E293B`, Radius: 6px, Padding: 10px.
    - Step 1: `"1. Connect phone to Wi-Fi:"` (10px `#94A3B8`).
    - SSID Name: `"Borosil-RMP-Setup"` (11px Bold Cyan `#00F0FF`).
    - Step 2: `"2. Open browser to:"` (10px `#94A3B8`).
    - Portal URL: `"http://192.168.4.1"` (11px Bold White `#FFFFFF`).
  - **Footer:** `"Listening for credentials..."` (Font: 9px Italic Amber `#F59E0B`, Centered `Y: 290`).

---

### Screen 3: Unclaimed / Unbound Device (`Page 0x0003` / `03_unbound.bmp`)
- **Trigger:** Device connected to Wi-Fi & MQTT broker, but admin has not bound this device ID to a Reactor.
- **Layout:**
  - **Header:** Gray/Blue banner `"DEVICE NOT BOUND"` (12px Bold White, Background `#334155`, `Y: 0 – 34`).
  - **Warning Badge (`X: 20, Y: 50, W: 200, H: 45`):**
    - Amber pill: `"⚠️ TELEMETRY NOT RECORDED"` (11px Bold Amber `#F59E0B`).
    - Explanation: `"Device is online but has no reactor assignment."` (9px `#94A3B8`).
  - **Device Identifier Card (`X: 10, Y: 105, W: 220, H: 120`):**
    - Background: `#1E293B`, Border: 1px `#475569`, Radius: 6px.
    - Label: `"HARDWARE IDENTIFIER (UUID)"` (9px SemiBold `#64748B`, `X: 18, Y: 115`).
    - Truncated ID (VP `0x2050`): **`"01a1af2d...6bc7"`** (13px Mono Bold Cyan `#00F0FF`, `X: 18, Y: 132`).
    - MAC Address: `"MAC: E8:F6:0A:E3:90:FB"` (10px Mono `#94A3B8`, `X: 18, Y: 156`).
    - IP Address: `"IP: 172.16.50.162"` (10px Mono `#94A3B8`, `X: 18, Y: 174`).
    - Broker Host: `"172.16.50.138:18883 (mTLS)"` (10px Mono `#94A3B8`, `X: 18, Y: 192`).
  - **Instruction:** `"Log into Web Admin -> Devices -> Claim & Bind this Device to a Reactor vessel."` (9px `#94A3B8`, Centered `Y: 245`).

---

### Screen 4: Analyst Process Assignment (`Page 0x0010` / `16_assignment.bmp`)
- **Trigger:** Lab In-charge schedules/assigns a batch to this reactor. ESP32 receives MQTT `cfg/desired`.
- **Layout:**
  - **Top Alert Banner (`X: 0, Y: 0, W: 240, H: 36`):**
    - Background: Royal Indigo `#1D4ED8`.
    - Icon: 📋 Clipboard icon.
    - Title: `"PROCESS ASSIGNMENT"` (Font: 13px Bold White `#FFFFFF`, `X: 30, Y: 10`).
  - **Assigned Analyst Card (`X: 10, Y: 46, W: 220, H: 92`):**
    - Background: `#1E293B`, Border: 1.5px Solid `#38BDF8`, Radius: 8px.
    - Label: `"ASSIGNED ANALYST"` (9px SemiBold `#38BDF8`, `X: 18, Y: 56`).
    - Analyst Name (VP `0x3000`): **`"Deepa Nair"`** (Font: **22px ExtraBold White `#FFFFFF`**, `X: 18, Y: 72`).
    - Scope Tag: `"QC Lab 1 | Reactor 25"` (10px Medium `#94A3B8`, `X: 18, Y: 108`).
  - **Process Context Summary (`X: 10, Y: 144, W: 220, H: 46`):**
    - Background: `#0F172A`, Radius: 4px.
    - Process Name: `"Synthesis Batch B-42"` (11px Bold White, `X: 18, Y: 152`).
    - Prompt: `"Please physically inspect vessel readiness."` (9px `#94A3B8`, `X: 18, Y: 170`).
  - **Interactive Touch Buttons (`Y: 198 – 292`):**
    - **`[ ACCEPT ASSIGNMENT ]` Button (`X: 12, Y: 198, W: 216, H: 44`):**
      - Background: Emerald Green (`#059669`), Active Press (`#10B981`), Radius: 6px.
      - Text: `"✓  ACCEPT ASSIGNMENT"` (Font: 13px Bold White).
      - DGUS Touch Control: Return Key Code `Touch VP: 0x3010`, Value: `0x0000`.
      - Physical Key: `BTN_UP` (Option 0).
    - **`[ REJECT ]` Button (`X: 12, Y: 250, W: 216, H: 38`):**
      - Background: `#1E1B1B`, Border: 1.5px Solid `#EF4444`, Radius: 6px.
      - Text: `"✕  REJECT ASSIGNMENT"` (Font: 12px SemiBold Red `#EF4444`).
      - DGUS Touch Control: Return Key Code `Touch VP: 0x3010`, Value: `0x0001`.
      - Physical Key: `BTN_DOWN` (Option 1).
  - **Footer Instruction:** `"Press Select button or tap screen"` (8px Slate `#64748B`, Centered `Y: 304`).

---

### Screen 5: Pre-Start Checklist & Limits (`Page 0x0011` / `17_prestart.bmp`)
- **Trigger:** Analyst accepted assignment (`0x3010 = 0x0000`).
- **Layout:**
  - **Header (`X: 0, Y: 0, W: 240, H: 34`):**
    - Title: `"PRE-START CHECKLIST"` (12px Bold White `#FFFFFF`, `X: 12, Y: 9`).
    - Status Badge: `"ACCEPTED"` (9px Green `#10B981`, `X: 168, Y: 9`).
  - **Recipe & Limit Verification Card (`X: 10, Y: 42, W: 220, H: 108`):**
    - Background: `#1E293B`, Border: 1px `#334155`, Radius: 8px.
    - Process Title (VP `0x3020`): **`"Synthesis Batch B-42"`** (Font: 14px Bold Sky Blue `#38BDF8`, `X: 18, Y: 52`).
    - Divider Line: `Y: 72`, Color `#334155`.
    - Safety Parameter Table (`X: 18, Y: 78`):
      - Line 1: `"Max Allowed Temp:"` ... **`"85.0 °C"`** (10px White, Right-aligned).
      - Line 2: `"Max Allowed Speed:"` ... **`"600 RPM"`** (10px White, Right-aligned).
      - Line 3: `"Max Rate of Rise:"` ... **`"+5.0 °C/min"`** (10px Amber `#F59E0B`, Right-aligned).
  - **Safety Attestation Checklist (`X: 10, Y: 156, W: 220, H: 40`):**
    - Background: `#0F172A`, Radius: 4px.
    - Bullet 1: `"☑ RTD probe submerged in reactant"` (9px `#94A3B8`, `X: 18, Y: 164`).
    - Bullet 2: `"☑ Motor impeller clear of vessel wall"` (9px `#94A3B8`, `X: 18, Y: 178`).
  - **Interactive Action Buttons (`Y: 204 – 294`):**
    - **`[ START PROCESS ]` Button (`X: 12, Y: 204, W: 216, H: 44`):**
      - Background: Vibrant Royal Blue (`#2563EB`), Active Press (`#1D4ED8`), Radius: 6px.
      - Text: `"▶  START PROCESS"` (Font: 14px Bold White).
      - DGUS Touch Control: Return Key Code `Touch VP: 0x3030`, Value: `0x0000`.
      - Physical Key: `BTN_UP` (Option 0).
    - **`[ CANCEL ]` Button (`X: 12, Y: 256, W: 216, H: 36`):**
      - Background: `#334155`, Radius: 6px.
      - Text: `"CANCEL / RETURN"` (Font: 11px SemiBold `#94A3B8`).
      - DGUS Touch Control: Return Key Code `Touch VP: 0x3030`, Value: `0x0001`.
      - Physical Key: `BTN_DOWN` (Option 1).
  - **Footer:** `"Tap START to commence batch data logging"` (8px `#64748B`, Centered `Y: 304`).

---

### Screen 6: Live Running Dashboard (`Page 0x0012` / `18_running.bmp`)
- **Trigger:** Process is running (`ATTEMPT_STARTED` published).
- **Layout:**
  - **Top Header Bar (`X: 0, Y: 0, W: 240, H: 32`):**
    - Background: `#111C30`.
    - Reactor / Analyst String (VP `0x2000`): `"Deepa Nair (R-25)"` (11px Bold White, `X: 10, Y: 8`).
    - Online Dot (VP `0x2010`): 6px Green Circle + `"ONLINE"` (9px Green `#10B981`, `X: 145, Y: 10`).
    - Clock (VP `0x2040`): `"14:32"` (11px `#94A3B8`, `X: 198, Y: 8`).
  - **Hero Temperature Telemetry Card (`X: 8, Y: 36, W: 224, H: 112`):**
    - Background: `#0F172A`, Border: 1px Solid `#1E293B`, Radius: 8px.
    - Card Label: `"REACTION TEMPERATURE"` (10px SemiBold `#94A3B8`, `X: 18, Y: 46`).
    - Quality Badge (VP `0x1008`): Green Pill `"GOOD"` (9px Bold White on `#059669`, `X: 172, Y: 44`, Width: 46, Height: 18).
    - **Live Big Digit (VP `0x1004`):** **`"35.2"`** (Font: **38px Bold Neon Cyan `#00F0FF`**, `X: 18, Y: 68`).
    - Unit Symbol: `"°C"` (Font: 18px Medium Cyan `#38BDF8`, `X: 122, Y: 76`).
    - Trend / Rate: `"+0.4 °C/min"` (11px Medium Green `#10B981`, `X: 154, Y: 78`).
    - Divider Line: `Y: 118`, Color `#1E293B`.
    - Sub-Details Row:
      - Raw Sensor (VP `0x1006`): `"Raw 35.6 C"` (10px `#64748B`, `X: 18, Y: 126`).
      - Cal Tag (VP `0x100A`): `"Cal v1.0"` (10px `#64748B`, `X: 168, Y: 126`).
  - **Secondary Agitation & Torque Cards (`X: 8, Y: 152, W: 224, H: 76`):**
    - **Stirrer Speed Card (`X: 8, Y: 152, W: 110, H: 76`):**
      - Background: `#1E293B`, Radius: 6px, Border: 1px `#334155`.
      - Header: `"STIRRER"` (9px SemiBold `#94A3B8`, `X: 16, Y: 160`).
      - Live RPM (VP `0x1014`): **`"350"`** (Font: **22px Bold White `#FFFFFF`**, `X: 16, Y: 178`).
      - Unit: `"RPM"` (10px Medium `#64748B`, `X: 68, Y: 186`).
      - Target: `"Set: 350"` (9px `#64748B`, `X: 16, Y: 206`).
    - **Stirrer Torque Card (`X: 122, Y: 152, W: 110, H: 76`):**
      - Background: `#1E293B`, Radius: 6px, Border: 1px `#334155`.
      - Header: `"TORQUE"` (9px SemiBold `#94A3B8`, `X: 130, Y: 160`).
      - Live Torque (VP `0x1016`): **`"12.4"`** (Font: **22px Bold White `#FFFFFF`**, `X: 130, Y: 178`).
      - Unit: `"N·cm"` (10px Medium `#64748B`, `X: 184, Y: 186`).
      - Load Bar: 60% fill Cyan bar (`X: 130, Y: 210, W: 90, H: 4`).
  - **Process Health & Alert Footer Card (`X: 8, Y: 232, W: 224, H: 82`):**
    - **Normal State:**
      - Background: `#1E293B`, Radius: 6px.
      - Status Indicator: Green Check + `"RUNNING (BATCH B-42)"` (11px Bold Emerald `#10B981`, `X: 18, Y: 242`).
      - Sub-metrics: `"Duration: 01:24:10 | Faults: 0"` (9px `#94A3B8`, `X: 18, Y: 260`).
      - Action hint: `"Short-press Select to mute alerts"` (8px `#64748B`, `X: 18, Y: 288`).
    - **Local Siren Silenced State:**
      - Shows Gray pill: `"🔇 SIREN SILENCED (VISUAL MONITORING ACTIVE)"` (9px Amber `#F59E0B`).

---

### Screen 7: Critical Fire / Safety Runaway Alarm (`Page 0x0013` / `19_alarm.bmp`)
- **Trigger:** Immediate edge trigger when `rate > g_max_temp_roc` (e.g. `+15.2 °C/min > +5.0 °C/min`) OR `t_eval > g_max_temp` (e.g. `86.5 °C > 85.0 °C`).
- **Layout:**
  - **Flashing Header Bar (`X: 0, Y: 0, W: 240, H: 40`):**
    - Background: Solid Bright Crimson Red (`#DC2626`).
    - Flashing Icon: ⚠️ 🔥 Flame & Alert Symbol.
    - Title: `"CRITICAL SAFETY ALARM"` (Font: 13px ExtraBold White `#FFFFFF`, Centered).
  - **Alarm Diagnosis Card (`X: 8, Y: 46, W: 224, H: 110`):**
    - Background: `#450A0A` (Deep Blood Red), Border: 2px Solid `#EF4444`, Radius: 8px.
    - Parameter Label: `"PARAMETER: THERMAL RUNAWAY"` (10px Bold Yellow `#FDE047`, `X: 16, Y: 56`).
    - Rate Warning (VP `0x1030`): **`"+15.2 °C/min"`** (Font: **24px ExtraBold White**, `X: 16, Y: 72`).
    - Limit Exceeded: `"Safety Limit: +5.0 °C/min Exceeded!"` (10px Bold Light Red `#FCA5A5`, `X: 16, Y: 104`).
    - Current Temp: `"Vessel Temperature: 86.2 °C"` (10px White, `X: 16, Y: 122`).
  - **Safety Action Instructions (`X: 8, Y: 162, W: 224, H: 80`):**
    - Background: `#1F1010`, Radius: 6px, Border: 1px `#7F1D1D`.
    - Step 1: `"1. Cut heating mantle power immediately."` (9px White, `X: 16, Y: 172`).
    - Step 2: `"2. Verify condenser cooling water flow."` (9px White, `X: 16, Y: 188`).
    - Step 3: `"3. Inspect stirrer rotation clearance."` (9px White, `X: 16, Y: 204`).
    - Note: `"Server & Lab Incharge alerted automatically."` (9px Yellow `#FEF08A`, `X: 16, Y: 222`).
  - **Interactive Siren Mute Button (`X: 12, Y: 248, W: 216, H: 48`):**
    - Background: Solid Amber (`#D97706`), Active Press (`#B45309`), Radius: 6px.
    - Text: `"🔇  SILENCE HARDWARE SIREN"` (Font: 13px Bold White).
    - DGUS Touch Control: Return Key Code `Touch VP: 0x3040 = 0x0001`.
    - Physical Key: `BTN_SELECT` or `BTN_MENU`.
  - **Footer:** `"Visual alarm remains active until condition clears"` (8px Light Red `#FCA5A5`, Centered `Y: 304`).

---

### Screen 8: Process Completion & Handover (`Page 0x0014` / `20_complete.bmp`)
- **Trigger:** Process reaches completion criteria or analyst completes run.
- **Layout:**
  - **Header (`X: 0, Y: 0, W: 240, H: 36`):**
    - Background: `#065F46` (Deep Emerald).
    - Title: `"BATCH COMPLETED"` (12px Bold White, Centered).
  - **Batch Summary Card (`X: 10, Y: 46, W: 220, H: 125`):**
    - Background: `#1E293B`, Radius: 8px.
    - Process Name: `"Synthesis Batch B-42"` (13px Bold Cyan `#00F0FF`, `X: 18, Y: 58`).
    - Total Run Time: `"Total Duration: 02:45:18"` (10px White, `X: 18, Y: 80`).
    - Final Temp: `"Final Temp: 24.2 °C"` (10px `#94A3B8`, `X: 18, Y: 98`).
    - Total Data Samples: `"Samples Logged: 9,918"` (10px `#94A3B8`, `X: 18, Y: 116`).
    - Audit State: `"Signed & Stored to TimescaleDB"` (9px Green `#10B981`, `X: 18, Y: 138`).
  - **Release Reactor Action (`X: 12, Y: 210, W: 216, H: 48`):**
    - Button: `"✓  RELEASE VESSEL TO IDLE"` (13px Bold White, Background `#10B981`, Radius: 6px).
    - Touch Control: Return Key Code `0x3050 = 0x0001`.
    - Returns display to `Page 0x0001 (Idle)`.

---

### Screen 9: Hardware & Network Diagnostics (`Page 0x0020` / `32_diagnostics.bmp`)
- **Trigger:** Hold `MENU` physical button for 3 seconds on any screen, or tap network badge.
- **Layout:**
  - **Header:** `"SYSTEM DIAGNOSTICS"` (12px Bold White, Background `#1E293B`, `Y: 0 – 34`).
  - **Diagnostic Metrics Container (`X: 10, Y: 40, W: 220, H: 225`):**
    - Background: `#0F172A`, Border: 1px `#334155`, Radius: 6px, Padding: 8px.
    - Metric 1: `"Wi-Fi SSID:"` ... **`"BSL_PUNE"`** (10px Mono).
    - Metric 2: `"IP Address:"` ... **`"172.16.50.162"`** (10px Mono).
    - Metric 3: `"MQTT Broker:"` ... **`"172.16.50.138:18883"`** (10px Mono).
    - Metric 4: `"mTLS Status:"` ... **`"CONNECTED (TLSv1.2)"`** (10px Mono Green `#10B981`).
    - Metric 5: `"NTP Time Sync:"` ... **`"LOCKED (±2 ms)"`** (10px Mono Green `#10B981`).
    - Metric 6: `"MAX31865 SPI:"` ... **`"ACTIVE (430.0 Rref)"`** (10px Mono).
    - Metric 7: `"RS232 Bus:"` ... **`"HEIDOLPH (9600 8N1)"`** (10px Mono).
    - Metric 8: `"Flash Storage:"` ... **`"Ring 16 MB (3% Used)"`** (10px Mono).
    - Metric 9: `"ESP32-P4 MAC:"` ... **`"E8:F6:0A:E3:90:FB"`** (10px Mono).
  - **Return Button (`X: 12, Y: 272, W: 216, H: 38`):**
    - `"◄  RETURN TO MONITORING"` (12px SemiBold White, Background `#334155`, Radius: 6px).
    - Touch Control: Returns to previous active page.

---

## 4. Complete Variable Pointer (VP) Memory Map

This is the exact memory map shared between the ESP-IDF C++ firmware and the DGUS configuration project.

| VP Address | Data Type | DGUS Widget Tool | Length / Unit | Direction | Description |
|---|---|---|---|---|---|
| **`0x0084`** | `uint16` | DGUS Page Register | 2 Bytes | ESP32 → Display | Command hardware page jump (`5A 01 <PageID>`) |
| **`0x1000`** | `int16` | Data Variable Display | 2 Bytes (Scale ×10) | ESP32 → Display | Numeric Temperature (`352` = `35.2 °C`) |
| **`0x1004`** | String | Text Display (0x14) | 10 Bytes (ASCII) | ESP32 → Display | Formatted Live Temperature (`"35.2"`) |
| **`0x1006`** | String | Text Display (0x14) | 16 Bytes (ASCII) | ESP32 → Display | Uncalibrated Raw Temperature (`"Raw 35.6 C"`) |
| **`0x1008`** | String | Text Display (0x14) | 10 Bytes (ASCII) | ESP32 → Display | Sensor Quality Flag (`"GOOD"`, `"BAD"`) |
| **`0x100A`** | String | Text Display (0x14) | 10 Bytes (ASCII) | ESP32 → Display | Applied Calibration Version (`"Cal v1"`) |
| **`0x1010`** | `int16` | Data Variable Display | 2 Bytes (Integer) | ESP32 → Display | Numeric Motor Stirrer Speed (`350`) |
| **`0x1014`** | String | Text Display (0x14) | 10 Bytes (ASCII) | ESP32 → Display | Formatted Motor RPM (`"350"`) |
| **`0x1012`** | `int16` | Data Variable Display | 2 Bytes (Scale ×10) | ESP32 → Display | Numeric Motor Torque (`124` = `12.4 N·cm`) |
| **`0x1016`** | String | Text Display (0x14) | 10 Bytes (ASCII) | ESP32 → Display | Formatted Motor Torque (`"12.4"`) |
| **`0x1020`** | String | Text Display (0x14) | 10 Bytes (ASCII) | ESP32 → Display | Hardware Diagnostic Fault Code (`"0"`) |
| **`0x1030`** | String | Text Display (0x14) | 32 Bytes (ASCII) | ESP32 → Display | Safety Alarm Warning Banner String |
| **`0x2000`** | String | Text Display (0x14) | 24 Bytes (ASCII) | ESP32 → Display | Header Title (`"Deepa Nair (Reactor 25)"`) |
| **`0x2010`** | String | Text Display (0x14) | 10 Bytes (ASCII) | ESP32 → Display | Connectivity Tag (`"ONLINE"`, `"OFFLINE"`) |
| **`0x2020`** | String | Text Display (0x14) | 20 Bytes (ASCII) | ESP32 → Display | Laboratory Name (`"QC Lab 1"`) |
| **`0x2040`** | String | Text Display (0x14) | 10 Bytes (ASCII) | ESP32 → Display | Realtime NTP Clock Display (`"14:32"`) |
| **`0x2050`** | String | Text Display (0x14) | 36 Bytes (ASCII) | ESP32 → Display | Hardware Device UUID (truncated for display) |
| **`0x3000`** | String | Text Display (0x14) | 30 Bytes (ASCII) | ESP32 → Display | Assigned Analyst Name (`"Deepa Nair"`) |
| **`0x3010`** | `uint16` | Return Key Code Touch | 2 Bytes | Display → ESP32 | Assignment Touch: `0x0000`=Accept, `0x0001`=Reject |
| **`0x3020`** | String | Text Display (0x14) | 30 Bytes (ASCII) | ESP32 → Display | Assigned Process Recipe Name |
| **`0x3030`** | `uint16` | Return Key Code Touch | 2 Bytes | Display → ESP32 | Pre-Start Touch: `0x0000`=Start, `0x0001`=Cancel |
| **`0x3040`** | `uint16` | Return Key Code Touch | 2 Bytes | Display → ESP32 | Alarm Mute Touch Key: `0x0001`=Mute Siren |
| **`0x3050`** | `uint16` | Return Key Code Touch | 2 Bytes | Display → ESP32 | Release Vessel Touch Key: `0x0001`=Release |

---

## 5. Serial Protocol & Packet Framing Specification

### 5.1 ESP32 → DWIN DGUS Packet Frame (UART Write)
All write commands follow the standard DGUS-II protocol header `0x5A 0xA5`:

```
┌──────┬──────┬─────────┬──────┬──────────┬──────────┬─────────────────┐
│ 0x5A │ 0xA5 │ Length  │ 0x82 │ VP_High  │ VP_Low   │ Data Bytes...   │
└──────┴──────┴─────────┴──────┴──────────┴──────────┴─────────────────┘
```

1. **Page Switch Frame Example (Jump to Running Page 0x0012):**
   ```hex
   5A A5 07 82 00 84 5A 01 00 12
   ```
   - `5A A5`: DGUS Frame Header.
   - `07`: Remaining byte count (7 bytes follow).
   - `82`: Write Register / VP command.
   - `00 84`: DGUS System Page Register address.
   - `5A 01`: DWIN Page Switch Magic Command.
   - `00 12`: Target Page ID (Page 18 / `0x0012`).

2. **String Variable Write Example (Write "35.2" to VP 0x1004):**
   ```hex
   5A A5 09 82 10 04 33 35 2E 32 FF FF
   ```
   - `Length = 0x09` (command + VP + 4 text bytes + 2 terminator bytes).
   - `10 04`: VP Address `0x1004`.
   - `33 35 2E 32`: ASCII for `"35.2"`.
   - `FF FF`: DWIN 2-byte string terminator.

3. **Numeric 16-bit Integer Write (Write 352 to VP 0x1000):**
   ```hex
   5A A5 05 82 10 00 01 60
   ```
   - `Length = 0x05`.
   - `10 00`: VP Address `0x1000`.
   - `01 60`: Hexadecimal for `352` (`35.2 °C` with 1 decimal place scale).

---

### 5.2 DWIN DGUS → ESP32 Touch Packet Frame (UART Return Key)
When the operator presses a touch area configured with a **Return Key Code**, DGUS sends:

```
┌──────┬──────┬─────────┬──────┬──────────┬──────────┬────────┬──────────┐
│ 0x5A │ 0xA5 │  0x06   │ 0x83 │ VP_High  │ VP_Low   │ 0x01   │ Key_Val  │
└──────┴──────┴─────────┴──────┴──────────┴──────────┴────────┴──────────┘
```

1. **Analyst Taps `[ ACCEPT ASSIGNMENT ]` (VP 0x3010, Value 0x0000):**
   ```hex
   5A A5 06 83 30 10 01 00 00
   ```
   - The ESP32 UART interrupt receives this, publishes `ASSIGNMENT_ACCEPTED` over MQTT, and flips the screen to `Page 0x0011 (Pre-Start)`.

2. **Analyst Taps `[ REJECT ASSIGNMENT ]` (VP 0x3010, Value 0x0001):**
   ```hex
   5A A5 06 83 30 10 01 00 01
   ```
   - The ESP32 publishes `ASSIGNMENT_REJECTED` over MQTT and flips screen back to `Page 0x0001 (Idle)`.

3. **Operator Taps `[ SILENCE SIREN ]` on Alarm Screen (VP 0x3040, Value 0x0001):**
   ```hex
   5A A5 06 83 30 40 01 00 01
   ```
   - The ESP32 mutes the hardware buzzer, publishes `ALERT_MUTED`, and updates the alert banner.

---

## 6. DGUS Software Project Generation & SD Flashing Recipe

### 6.1 Required File Structure
In the root of your MicroSD card, create a single directory named **`DWIN_SET`**:

```
[SD Card Root]
└── DWIN_SET/
    ├── 01_idle.bmp            (24-bit BMP, 240x320)
    ├── 16_assignment.bmp      (24-bit BMP, 240x320)
    ├── 17_prestart.bmp        (24-bit BMP, 240x320)
    ├── 18_running.bmp         (24-bit BMP, 240x320)
    ├── 19_alarm.bmp           (24-bit BMP, 240x320)
    ├── 20_complete.bmp        (24-bit BMP, 240x320)
    ├── 32_diagnostics.bmp     (24-bit BMP, 240x320)
    ├── 0_DWIN_ASC.HZK         (Standard ASCII font library)
    ├── 13_Touch.bin           (Generated touch configuration)
    ├── 14_Show.bin            (Generated display configuration)
    └── 22_Config.bin          (Baud 115200, orientation, touch driver)
```

### 6.2 SD Card Formatting Prerequisites
- **Format:** FAT32 (MS-DOS).
- **Allocation Unit (Cluster Size):** **4096 bytes** (Mandatory — DWIN bootloaders will refuse cards formatted with 8192 or default cluster sizes).
- **Capacity:** 4 GB, 8 GB, or 16 GB Class 10 MicroSD card (Cards > 32 GB formatted as exFAT will not boot).

---

## 7. Master Claude / Claude Figma Connector Generation Package

Copy the block below and pass it directly to Claude to generate all UI frames in Figma:

```markdown
You are an expert industrial embedded UI/UX designer.
Create a complete, pixel-perfect 10-screen HMI design system in Figma for the Borosil Reactor Monitoring Platform (RMP).

### System Parameters:
- Screen Resolution: Exactly 240 px (Width) × 320 px (Height) - Portrait orientation.
- Hardware Target: DWIN DGUS-II T5L Display driven by ESP32-P4 over UART.
- Aesthetic: Modern High-Contrast Pharmaceutical Instrumentation (Siemens / Mettler Toledo style).
- Color System:
  * Canvas Background: #0B1220 (Deepest Navy)
  * Card Surfaces: #1E293B (Slate 800) with 1px border #334155 (Slate 700)
  * Metric Accent: #00F0FF (Neon Cyan for live temperature)
  * Success / Normal: #10B981 (Emerald Green for online badge, accept button)
  * Warning / RoC: #F59E0B (Amber for rate-of-change notices)
  * Critical Alarm / Danger: #EF4444 (Crimson Red for alarms & reject button)
  * Text Colors: #F8FAFC (Primary white), #94A3B8 (Slate muted labels)

### Generate 6 Primary Core Production Frames (240x320 each):

1. Frame "01_Idle_Standby":
   - Top Header (34px): Title "Reactor 25" + green status pill "● ONLINE".
   - Sub-bar: "QC Lab 1" + clock "14:32".
   - Card 1: Standby Temp card with label "STANDBY VESSEL TEMP" and value "24.8 °C" in 34px bold Cyan. Raw label "Raw 24.9 °C | Cal v1".
   - Dual split cards: "STIRRER: 0 RPM" and "TORQUE: 0.0 N·cm".
   - Bottom Container: Dashed amber box "WAITING FOR ASSIGNMENT - Assign via Lab Incharge Web Portal".

2. Frame "16_Analyst_Assignment":
   - Top Header (36px): Royal Blue bar "#1D4ED8" with title "PROCESS ASSIGNMENT".
   - Hero Card: "ASSIGNED ANALYST" label + prominent bold name "Deepa Nair" (22px bold white) + "QC Lab 1 | Reactor 25".
   - Notice: "Confirm physical readiness of reactor vessel before accepting."
   - Button 1: Solid Emerald Green "#059669" button "[ ✓ ACCEPT ASSIGNMENT ]" (Height: 44px).
   - Button 2: Red outline button "[ ✕ REJECT ASSIGNMENT ]" (Height: 38px).

3. Frame "17_PreStart_Checklist":
   - Top Header (34px): Title "PRE-START CHECKLIST" + green tag "ACCEPTED".
   - Recipe Card: Process recipe "Synthesis Batch B-42" in Sky Blue (14px bold) + table: "Max Temp: 85.0 °C", "Max Speed: 600 RPM", "Max dT/dt: +5.0 °C/min".
   - Checklist box: "☑ RTD probe submerged in reactant" and "☑ Impeller clearance verified".
   - Button 1: Solid Royal Blue "#2563EB" button "[ ▶ START PROCESS ]" (Height: 44px).
   - Button 2: Neutral Slate "#334155" button "[ CANCEL / RETURN ]" (Height: 36px).

4. Frame "18_Running_Dashboard":
   - Top Header: "Deepa Nair (R-25)" + green dot "ONLINE" + clock "14:32".
   - Hero Temp Card: "REACTION TEMPERATURE" label + green pill "GOOD". Huge value "35.2" in 38px bold Cyan with "°C" unit + sub-row "Raw 35.6 C | Cal v1.0".
   - Dual Split Cards: Left: "STIRRER" -> "350 RPM". Right: "TORQUE" -> "12.4 N·cm".
   - Bottom Health Card: Green check + "RUNNING (BATCH B-42)" + "Duration: 01:24:10 | Faults: 0".

5. Frame "19_Critical_Alarm":
   - Top Header: Solid Bright Red "#DC2626" with flashing alert title "CRITICAL SAFETY ALARM".
   - Emergency Card: Deep red container "#450A0A" with yellow label "PARAMETER: THERMAL RUNAWAY", huge rate value "+15.2 °C/min", and limit text "Safety Limit: +5.0 °C/min Exceeded! Vessel Temp: 86.2 °C".
   - Action checklist: "1. Cut heating power | 2. Check cooling water | 3. Server alerted".
   - Button: Solid Amber "#D97706" button "[ 🔇 SILENCE HARDWARE SIREN ]" (Height: 48px).

6. Frame "32_System_Diagnostics":
   - Header: "SYSTEM DIAGNOSTICS".
   - Terminal-style dark slate container with mono lines: "SSID: BSL_PUNE", "IP: 172.16.50.162", "Broker: 172.16.50.138:18883 (TLSv1.2)", "NTP Sync: LOCKED", "RTD: MAX31865 OK", "Motor: RS232 OK".
   - Return Button: "[ ◄ RETURN TO MONITORING ]".

Ensure tidy auto-layout, exact pixel alignment to 240x320, readable font sizes (minimum 10px), high contrast for industrial visibility, and clean layer naming suitable for direct export to 24-bit BMP.
```

