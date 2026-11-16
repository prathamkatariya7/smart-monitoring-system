# Complete HMI UI Design & DGUS Integration Guide
**Borosil Reactor Monitoring Platform (RMP) — ESP32-P4 & DWIN T5L DGUS-II**

---

## 1. Executive System & Hardware Specification

This specification is the master reference for designing the **on-device HMI in Figma** and building the **DGUS-II project in DWIN DGUS Tool**. The firmware running on the ESP32-P4 controls pages, renders live telemetry, and receives operator actions via UART1.

### 1.1 Hardware & Communication Parameters
- **Target Display:** DWIN DGUS-II (T5L ASIC / LCM Series, e.g., DMG24320C024 / DMG24320C028 or similar 240×320 series).
- **Resolution:** **240 × 320 pixels** (Portrait orientation).
- **Communication:** UART1 (`PIN_DWIN_TX = GPIO 21`, `PIN_DWIN_RX = GPIO 20`).
- **Baud Rate:** `115200 bps`, 8 data bits, no parity, 1 stop bit (8-N-1).
- **DGUS Protocol Frame Format:**
  - Write Register/VP: `5A A5 <Length> 0x82 <VP_High> <VP_Low> <Data_Bytes...>`
  - Page Switch: `5A A5 07 0x82 00 84 5A 01 <Page_High> <Page_Low>`
  - Text Terminator: `0xFFFF` (2 bytes).
- **Physical Push Buttons (Header Inputs):**
  - **Menu** (`GPIO 32`): Silence active siren / Toggle menu.
  - **Up** (`GPIO 33`): Move selection / Option 0 (Accept / Start).
  - **Down** (`GPIO 26`): Move selection / Option 1 (Reject / Cancel).
  - **Select** (`GPIO 27`): Confirm choice / Acknowledge local alarm.
  *(Note: Both physical buttons and DGUS touchscreen touch keys trigger the same state machine).*

---

## 2. Complete Screen Architecture & State Flow

The HMI state machine has **4 core pages** programmed into the ESP32-P4 firmware:

```
                  [Power On / Idle]
                    Page 0x0001
                         │
                         │ (Server assigns process to Analyst)
                         ▼
                [Assignment Screen]
                    Page 0x0010
                   /           \
     [REJECT]     /             \  [ACCEPT]
                 ▼               ▼
          Page 0x0001      [Pre-Start Screen]
           (Idle)              Page 0x0011
                               /         \
                 [CANCEL]     /           \  [START PROCESS]
                             ▼             ▼
                      Page 0x0001     [Running Dashboard]
                       (Idle)             Page 0x0012
                                               │
                                               │ (External Heat / RoC Alarm)
                                               ▼
                                      [Flashing Alarm Banner]
                                      (Page 0x0012 + 0x1030 VP)
```

---

## 3. Screen-by-Screen Visual Layout & UI Geometry

### Screen 1: Idle Standby (`Page 0x0001` / `01_idle.bmp`)
- **Purpose:** Standby screen when no active process is assigned. Displays reactor number, lab name, network status, and baseline live sensor readings.
- **Visual Composition (240 × 320 px):**
  1. **Top Status Bar (`Y: 0 – 32`):**
     - Reactor Badge: `"Reactor 25"` (Font: 12px SemiBold, White).
     - Network Tag: Green pill `"● ONLINE"` (`Y: 8`, `X: 160`, Width: 70, Height: 18).
  2. **Sub-Header (`Y: 34 – 52`):**
     - Lab Name: `"QC Lab 1"` (Font: 11px Regular, Slate Gray `#94A3B8`).
     - Clock: `"14:32"` (Font: 11px Regular, `#94A3B8`, aligned right).
  3. **Main Baseline Status (`Y: 60 – 140`):**
     - Dark Slate Card (`#1E293B`, Radius: 8px, Margin: `X: 10`, Width: 220, Height: 75).
     - Label: `"STANDBY TEMPERATURE"` (10px, `#64748B`).
     - Value: `"24.8 °C"` (Big 28px Bold Cyan `#00F0FF`).
  4. **Motor Telemetry Baseline (`Y: 145 – 215`):**
     - 2 Split Cards (`Width: 105` each, `X: 10` and `X: 125`):
     - Left: `"0 RPM"` (16px Bold, White).
     - Right: `"0.0 N·cm"` (16px Bold, White).
  5. **Footer Prompt (`Y: 230 – 305`):**
     - Amber/Gray Dashed Container:
     - Text: `"WAITING FOR ASSIGNMENT"` (12px SemiBold, `#F59E0B`).
     - Subtext: `"Assign via Lab Incharge Web Portal"` (10px, `#64748B`).

---

### Screen 2: Analyst Assignment (`Page 0x0010` / `16_assignment.bmp`)
- **Purpose:** Pops up automatically when a Lab In-charge assigns a batch to this reactor. The analyst standing at the reactor must review and Accept or Reject.
- **Visual Composition (240 × 320 px):**
  1. **Top Banner (`Y: 0 – 36`):**
     - Background: Vibrant Indigo/Blue Header (`#1E40AF`).
     - Title: `"NEW PROCESS ASSIGNMENT"` (12px Bold, White).
  2. **Analyst Profile Card (`Y: 45 – 145`):**
     - Card Background: `#1E293B` (Radius: 8px, `X: 10`, Width: 220, Height: 95).
     - User Avatar Icon / Tag: `"Assigned Analyst"` (10px, `#94A3B8`).
     - Analyst Name (VP `0x3000`): **`"Deepa Nair"`** (Font: **22px ExtraBold**, Pure White, Centered).
     - Lab ID: `"QC Lab 1 | Reactor 25"` (11px, `#38BDF8`).
  3. **Notice Text (`Y: 155 – 185`):**
     - Text: `"Confirm physical readiness of reactor vessel before accepting."` (10px, `#94A3B8`, Centered).
  4. **Interactive Action Buttons (`Y: 195 – 285`):**
     - **ACCEPT Button (`Y: 200 – 240`, `X: 15 – 225`, Width: 210, Height: 42):**
       - Background: Solid Emerald Green (`#10B981`, Radius: 6px).
       - Text: `"✓ ACCEPT ASSIGNMENT"` (14px Bold White).
       - Touch Return Code / Touch VP: `0x3010 = 0x0000`.
     - **REJECT Button (`Y: 250 – 285`, `X: 15 – 225`, Width: 210, Height: 35):**
       - Background: Dark Red Outline (`#7F1D1D`, Border: 1px `#EF4444`, Radius: 6px).
       - Text: `"✕ REJECT"` (12px SemiBold `#EF4444`).
       - Touch Return Code / Touch VP: `0x3010 = 0x0001`.

---

### Screen 3: Pre-Start Safety Checklist (`Page 0x0011` / `17_prestart.bmp`)
- **Purpose:** Displayed after analyst accepts. Confirms the specific process recipe and safety limit parameters before turning on agitation or heating.
- **Visual Composition (240 × 320 px):**
  1. **Top Header (`Y: 0 – 36`):**
     - Title: `"PROCESS PRE-START"` (12px Bold White).
     - Badge: Green Check `"ACCEPTED"` (`X: 165`, Width: 65, Height: 18).
  2. **Process Information Card (`Y: 45 – 150`):**
     - Background: `#1E293B` (Radius: 8px, `X: 10`, Width: 220, Height: 100).
     - Label: `"PROCESS RECIPE"` (10px, `#94A3B8`).
     - Process Name (VP `0x3020`): **`"Synthesis Batch B-42"`** (16px Bold `#38BDF8`).
     - Limits Row: `"Max Temp: 85°C | Max RPM: 600"` (11px Regular, `#CBD5E1`).
     - Safety Watch: `"Max dT/dt: +5.0 °C/min"` (10px SemiBold, `#F59E0B`).
  3. **Notice Text (`Y: 160 – 190`):**
     - Text: `"Ensure impeller clearance and RTD immersion."` (10px, `#94A3B8`, Centered).
  4. **Interactive Action Buttons (`Y: 200 – 290`):**
     - **START PROCESS Button (`Y: 205 – 248`, `X: 15 – 225`, Width: 210, Height: 44):**
       - Background: Vibrant Royal Blue (`#2563EB`, Radius: 6px).
       - Text: `"▶ START PROCESS"` (15px Bold White).
       - Touch Return Code / Touch VP: `0x3030 = 0x0000`.
     - **CANCEL Button (`Y: 255 – 290`, `X: 15 – 225`, Width: 210, Height: 35):**
       - Background: Dark Gray (`#334155`, Radius: 6px).
       - Text: `"CANCEL"` (12px Regular `#94A3B8`).
       - Touch Return Code / Touch VP: `0x3030 = 0x0001`.

---

### Screen 4: Live Telemetry & Process Dashboard (`Page 0x0012` / `18_running.bmp`)
- **Purpose:** Primary operating screen during active batches. Streams real-time RTD temperature, motor RPM, torque, quality flags, and safety runaway alert banners.
- **Visual Composition (240 × 320 px):**
  1. **Top Header (`Y: 0 – 32`):**
     - Reactor / Analyst Title (VP `0x2000`): `"Deepa Nair (R-25)"` (12px Bold White).
     - Online Indicator (VP `0x2010`): Green Dot + `"ONLINE"` (10px `#10B981`).
     - Clock (VP `0x2040`): `"14:32"` (11px `#94A3B8`, aligned right).
  2. **Primary Temperature Card (`Y: 36 – 150`):**
     - Card Background: High-contrast Dark Blue (`#0F172A`, Border: 1px `#334155`, Radius: 8px, `X: 8`, Width: 224, Height: 112).
     - Card Header: Label `"TEMPERATURE"` (11px `#94A3B8`) + Quality Tag (VP `0x1008`, e.g., Green `"GOOD"`).
     - **Main Live Value (VP `0x1004`):** **`"35.2"`** (Huge **38px Bold Cyan `#00F0FF`**).
     - Unit Symbol: `"°C"` (18px Medium Cyan).
     - Secondary Footer Row:
       - Raw Sensor (VP `0x1006`): `"Raw 35.6 C"` (10px `#64748B`).
       - Cal Version (VP `0x100A`): `"Cal v1"` (10px `#64748B`).
  3. **Secondary Dual Telemetry Cards (`Y: 154 – 230`):**
     - **Motor Agitation RPM Card (`X: 8`, Width: 108, Height: 74):**
       - Header: `"STIRRER"` (10px `#94A3B8`).
       - **Value (VP `0x1014`):** **`"350"`** (22px Bold White).
       - Unit: `"RPM"` (11px `#64748B`).
     - **Motor Torque Card (`X: 124`, Width: 108, Height: 74):**
       - Header: `"TORQUE"` (10px `#94A3B8`).
       - **Value (VP `0x1016`):** **`"12.4"`** (22px Bold White).
       - Unit: `"N·cm"` (11px `#64748B`).
  4. **Safety & Alert Banner Footer (`Y: 236 – 312`):**
     - **Normal State:**
       - Background: `#1E293B` (Radius: 6px, `X: 8`, Width: 224, Height: 70).
       - Status: `"PROCESS RUNNING NORMAL"` (11px `#10B981`).
       - Fault Code (VP `0x1020`): `"Fault Code: 0"` (10px `#64748B`).
       - Instructions: `"Press Menu to mute"` (9px `#64748B`).
     - **CRITICAL ALARM TRIGGERED State (Overheating / Fire Runaway):**
       - Background: **Solid Flashing Danger Red (`#DC2626`)**.
       - Alert Text (VP `0x1030`): **`"CRITICAL: RATE +15.2 C/m"`** (13px Bold White).
       - Subtext: **`"OVERHEAT DETECTED - MUTE [SELECT]"`** (11px Bold Yellow `#FEF08A`).
       - Touch Area: Whole banner acts as local siren mute key (`Touch VP: 0x3040 = 0x0001`).

---

## 4. Comprehensive DGUS Variable Pointer (VP) Memory Map

When configuring widgets in DGUS Software, use the exact VP addresses below. These match the firmware's `rmp_dwin.cpp` and `app_main.cpp`.

| VP Address | Data Type | DGUS Control Tool | Length / Format | Description & Example |
|---|---|---|---|---|
| **`0x0084`** | `uint16` | System Register | 2 Bytes | DGUS Page Switch Command (`5A 01 <PageID>`) |
| **`0x1000`** | `int16` | Data Variable Display | 2 Bytes (Scale ×10) | Numeric Temperature: `352` = `35.2 °C` |
| **`0x1004`** | String | Text Display (0x14) | 10 Bytes (5 chars) | Formatted Temp String: `"35.2"` |
| **`0x1006`** | String | Text Display (0x14) | 16 Bytes | Raw Temp String: `"Raw 35.6 C"` |
| **`0x1008`** | String | Text Display (0x14) | 10 Bytes | Quality Status: `"GOOD"` or `"BAD"` |
| **`0x100A`** | String | Text Display (0x14) | 10 Bytes | Calibration ID: `"Cal v1"` |
| **`0x1010`** | `int16` | Data Variable Display | 2 Bytes | Numeric Motor RPM: `350` |
| **`0x1014`** | String | Text Display (0x14) | 10 Bytes | Formatted RPM String: `"350"` |
| **`0x1012`** | `int16` | Data Variable Display | 2 Bytes (Scale ×10) | Numeric Torque: `124` = `12.4 N·cm` |
| **`0x1016`** | String | Text Display (0x14) | 10 Bytes | Formatted Torque String: `"12.4"` |
| **`0x1020`** | String | Text Display (0x14) | 10 Bytes | Hardware Fault Code: `"0"` |
| **`0x1030`** | String | Text Display (0x14) | 32 Bytes | Alert Banner: `"CRITICAL: RATE +15.2 C/m"` |
| **`0x2000`** | String | Text Display (0x14) | 24 Bytes | Reactor Title: `"Deepa Nair (R-25)"` |
| **`0x2010`** | String | Text Display (0x14) | 10 Bytes | Connectivity Tag: `"ONLINE"` / `"OFFLINE"` |
| **`0x2020`** | String | Text Display (0x14) | 20 Bytes | Laboratory Name: `"QC Lab 1"` |
| **`0x2040`** | String | Text Display (0x14) | 10 Bytes | Time Display: `"14:32"` |
| **`0x3000`** | String | Text Display (0x14) | 30 Bytes | Assigned Analyst Name: `"Deepa Nair"` |
| **`0x3010`** | `uint16` / String | Return Key Code | 2 Bytes | Assignment Choice: `0`=Accept, `1`=Reject |
| **`0x3020`** | String | Text Display (0x14) | 30 Bytes | Process Name: `"Synthesis Batch B-42"` |
| **`0x3030`** | `uint16` / String | Return Key Code | 2 Bytes | Pre-Start Choice: `0`=Start, `1`=Cancel |
| **`0x3040`** | `uint16` | Return Key Code | 2 Bytes | Alarm Mute Button Return Code |

---

## 5. Design System Tokens for Figma & Claude

### 5.1 Color Palette
- **Background Deep:** `#0B1220` (Dark Navy canvas).
- **Card Surface:** `#1E293B` (Slate 800) with 1px border `#334155` (Slate 700).
- **Primary Accent / Temperature:** `#00F0FF` (Cyan) and `#38BDF8` (Sky 400).
- **Success / Online / Accept:** `#10B981` (Emerald 500) and `#059669` (Dark Emerald).
- **Warning / Rate of Change:** `#F59E0B` (Amber 500).
- **Critical Alarm / Reject:** `#EF4444` (Red 500) and `#DC2626` (Red 600).
- **Text Hierarchy:**
  - Primary: `#F8FAFC` (Pure/Near White).
  - Secondary: `#CBD5E1` (Slate 300).
  - Muted/Labels: `#64748B` (Slate 500).

### 5.2 Typography Tokens (Pixel Units for 240×320 Canvas)
- **Huge Metric Digits:** `36px – 40px` Bold / ExtraBold (e.g., `"35.2"`).
- **Sub-Metric Digits:** `20px – 24px` Bold (e.g., `"350"`, `"12.4"`).
- **Page Titles & Analyst Name:** `16px – 20px` Bold.
- **Button Labels:** `13px – 14px` SemiBold / Bold.
- **Card Headers & Metadata:** `10px – 11px` Regular / Medium.
- **System Footers / Subtext:** `9px – 10px` Regular.

---

## 6. Export Rules & DGUS Tool Integration Step-by-Step

### 6.1 Exporting Images from Figma
1. **Canvas Size:** Exactly **`240px` (Width) × `320px` (Height)**.
2. **File Format:** **24-bit Bitmap (`.BMP`)** or high-res `.PNG` converted to 24-bit BMP.
3. **Naming Convention:**
   - `01_idle.bmp` (ID 1 -> Page `0x0001`)
   - `16_assignment.bmp` (ID 16 -> Page `0x0010`)
   - `17_prestart.bmp` (ID 17 -> Page `0x0011`)
   - `18_running.bmp` (ID 18 -> Page `0x0012`)
   - `19_alarm.bmp` (ID 19 -> Flashing alert background)

### 6.2 Setting Up the Project in DGUS Tool (v7.x or v8.x)
1. Open DWIN DGUS Tool -> New Project -> Resolution `240 × 320`.
2. Import the 4 BMP background images.
3. On **Page 18 (Running Dashboard)**:
   - Add **Text Display** at coordinates `X: 20, Y: 60`, set VP to `0x1004`, Font 0, Size 32, Color `#00F0FF`.
   - Add **Text Display** at coordinates `X: 20, Y: 180`, set VP to `0x1014`, Font 0, Size 20, Color `#FFFFFF`.
   - Add **Text Display** at coordinates `X: 135, Y: 180`, set VP to `0x1016`, Font 0, Size 20, Color `#FFFFFF`.
   - Add **Text Display** at coordinates `X: 15, Y: 245`, set VP to `0x1030`, Font 0, Size 14, Color `#FFFF00`.
4. On **Page 16 (Assignment Screen)**:
   - Add **Text Display** at `X: 20, Y: 85`, VP `0x3000` (Analyst Name).
   - Add **Return Key Code** Touch control over `[ ACCEPT ]`: Area `X: 15, Y: 200, W: 210, H: 42`, VP: `0x3010`, Return Value: `0x0000`.
   - Add **Return Key Code** Touch control over `[ REJECT ]`: Area `X: 15, Y: 250, W: 210, H: 35`, VP: `0x3010`, Return Value: `0x0001`.
5. On **Page 17 (Pre-Start Screen)**:
   - Add **Text Display** at `X: 20, Y: 80`, VP `0x3020` (Process Name).
   - Add **Return Key Code** Touch control over `[ START PROCESS ]`: Area `X: 15, Y: 205, W: 210, H: 44`, VP: `0x3030`, Return Value: `0x0000`.
   - Add **Return Key Code** Touch control over `[ CANCEL ]`: Area `X: 15, Y: 255, W: 210, H: 35`, VP: `0x3030`, Return Value: `0x0001`.
6. Click **Generate Configuration Files** (`13_Touch.bin`, `14_Show.bin`, etc.).
7. Copy the entire `DWIN_SET` folder to an SD card formatted with **FAT32 (4096-byte cluster size)**.
8. Insert into DWIN screen, power up, wait for `"SD Card Process... Complete"`, remove SD card, and reboot.

---

## 7. Master Copy-Paste Prompt for Claude / Claude Figma Connector

Copy and paste the exact block below into Claude to generate the Figma design:

```markdown
You are an expert industrial UI/UX designer and embedded HMI design specialist.
Create a high-contrast, modern industrial HMI touchscreen UI in Figma for a pharmaceutical chemical Reactor Monitoring Platform (RMP).

### Project Specs:
- Screen Dimensions: 240 px (Width) × 320 px (Height) - Portrait orientation.
- Target Hardware: DWIN DGUS-II LCD Display driven by ESP32-P4 over UART.
- Design Aesthetic: High-contrast Dark Industrial Theme (similar to Siemens/ABB lab instrumentation).
- Color Tokens:
  * Background: #0B1220 (Very deep navy)
  * Card Surfaces: #1E293B (Slate 800) with 1px border #334155 (Slate 700)
  * Primary Accent: #00F0FF (Neon Cyan for live temperature)
  * Positive / Normal: #10B981 (Emerald Green for online badge, accept button)
  * Warning / RoC: #F59E0B (Amber for rate-of-change notices)
  * Critical Alert / Stop: #EF4444 (Crimson Red for alarms & reject button)
  * Text Colors: #F8FAFC (Primary white), #94A3B8 (Slate muted labels)

### Generate 4 Distinct Frames (240x320 each):

1. Frame "01_Idle_Standby":
   - Top Bar: "Reactor 25" title + green pill "● ONLINE".
   - Sub-bar: "QC Lab 1" + clock "14:32".
   - Card 1: Standby Temp card showing "24.8 °C" in cyan.
   - Dual split cards: "0 RPM" and "0.0 N·cm".
   - Bottom Box: Dashed container with text "WAITING FOR ASSIGNMENT - Assign via Lab Incharge Portal".

2. Frame "16_Analyst_Assignment":
   - Top Header: Solid Blue bar with "NEW PROCESS ASSIGNMENT".
   - Central Card: "Assigned Analyst" label + large bold name "Deepa Nair" (22px bold white) + "QC Lab 1 | Reactor 25".
   - Notice: "Confirm physical readiness of reactor vessel before accepting."
   - Button 1: Solid Emerald Green button "[ ✓ ACCEPT ASSIGNMENT ]" (Height: 42px).
   - Button 2: Red outline button "[ ✕ REJECT ]" (Height: 35px).

3. Frame "17_PreStart_Checklist":
   - Top Header: "PROCESS PRE-START" + green badge "ACCEPTED".
   - Central Card: "PROCESS RECIPE" label + Process name "Synthesis Batch B-42" in Sky Blue (16px bold) + limits row "Max Temp: 85°C | Max RPM: 600" + safety label "Max dT/dt: +5.0 °C/min".
   - Button 1: Solid Royal Blue button "[ ▶ START PROCESS ]" (Height: 44px).
   - Button 2: Neutral Slate button "[ CANCEL ]" (Height: 35px).

4. Frame "18_Running_Dashboard":
   - Top Header: "Deepa Nair (R-25)" + green dot "ONLINE" + "14:32".
   - Hero Card: Temperature card with label "TEMPERATURE" + green badge "GOOD". Value "35.2 °C" in massive 38px bold cyan. Subtitle "Raw 35.6 C | Cal v1".
   - Dual Split Cards: Left: "STIRRER" -> "350 RPM". Right: "TORQUE" -> "12.4 N·cm".
   - Bottom Banner (Dual state design):
     * Normal state: Dark card with green check "PROCESS RUNNING NORMAL | Fault Code: 0".
     * Active Alarm state: Bright red flashing card with bold white text "🔥 CRITICAL: RATE +15.2 C/m" and yellow subtext "OVERHEAT DETECTED - TOUCH TO MUTE".

All components must have tidy auto-layout, crisp pixel alignment, readable font sizes (minimum 10px for small labels, 36px+ for primary values), and clean layer hierarchies for instant export to 24-bit BMP.
```

