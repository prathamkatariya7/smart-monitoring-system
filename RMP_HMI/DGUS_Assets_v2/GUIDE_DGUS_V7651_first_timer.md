# Borosil RMP - DWIN DGUS HMI v2.0: first-timer build guide
Display: DWIN T5L DGUS II, 240 x 320 portrait. Tool: DGUS V7.651. Everything in this guide uses the files in this package.
Items I could not confirm in your exact V7.651 build are tagged **[VERIFY]** - keep DWIN's *T5L_DGUSII Application Development Guide* (public PDF) open as the tie-breaker.

## 0. Read this first - what is different from the v2.0 document
The final document is the architecture source of truth; I kept every screen, string and behaviour. The following had to change for DGUS to work. The firmware team must apply items 1-6.

1. **Page numbers are contiguous 0-9.** DGUS page N shows background image N. Keep the document's IDs as firmware constants and map them: `0x0000->0, 0x0001->1, 0x0002->2, 0x0003->3, 0x0010->4, 0x0011->5, 0x0012->6, 0x0013->7, 0x0014->8, 0x0020->9`.
2. **The document's VP table overlaps itself.** A 10-byte text at `0x1004` occupies 5 words (`0x1004-0x1008`) but `0x1006`, `0x1008` and `0x100A` are also text variables; `0x1014/0x1016` collide the same way. Telemetry strings now live at `0x1100-0x11D0`, spaced so nothing overlaps (checked by script). Full list: `VP_map.csv`.
3. **Connectivity pill** is an icon variable `0x2018` (0 ONLINE green, 1 OFFLINE red). A text variable cannot change the pill colour, so OFFLINE would still look green. `0x2010` is reserved.
4. **Quality badge** is an icon variable `0x1301` (0 GOOD, 1 SUSPECT, 2 BAD); the Idle page has a dot `0x1300`. Status is never colour-only (the pill carries text).
5. **Dynamic text is ASCII only** and snaps to DGUS cell sizes 8x16 / 12x24 / 16x32 / 20x40. Symbols (degree sign, middle dot, check marks, bullets) are painted into the pictures. Send `"Raw 35.6 C"`, not `"Raw 35.6 °C"`.
6. **New icon / bar variables:** alarm header flash `0x1308`, mute button state `0x1309` (0 SILENCE, 1 SILENCED), running footer `0x1307`, audit state `0x130A`, diagnostics status dots `0x1310-0x1318`, progress bars `0x1305` (torque load) and `0x1306` (boot).
7. **Touch:** the document defines touch return keys. The module named in the original design (DMG32240C024_03WN) has **no touch panel**, so touch VPs never fire; the ESP32 must handle the physical keys (UP/DOWN/SELECT/MENU) and do the same actions. The pictures therefore say "UP = Accept" etc. If your panel does have touch, the buttons already work. **Ask the hardware team which module you have.**
8. **Document section 6.1 (loose BMP files inside DWIN_SET) is not how DGUS II works.** The display reads ICL / BIN files, not BMPs (see section 8). The BMPs in this package are only *inputs* for the DGUS tool.
9. **Logo:** the BOROSIL wordmark on page 0 is a text placeholder. Replace the area (x35-205, y50-120) with your logo PNG before generating the ICL.
10. **Numeric VPs `0x1000 / 0x1010 / 0x1012`** from the document are not placed on any page; the text VPs show the values.

## 1. Package contents
| Folder / file | Use |
|---|---|
| `01_backgrounds_bmp/0..9.bmp` (+ `_png`, `_named`) | Static page pictures, 24-bit, 240x320. File name = DGUS page number. |
| `02_icon_libraries/33..39_*` | One folder per icon library; image N = variable value N. `40_/41_FALLBACK_*` = stepped bars (only if you do not use the Progress Bar widget). |
| `03_placement_map/` | Reference only: magenta = text, orange = icon, cyan = bar, green = touch, with exact boxes. |
| `04_preview_with_sample_values/` | What each page should look like when the ESP32 has written values. |
| `VP_map.csv` | Every variable: VP, widget, x, y, w, h, bytes, font cell, align, colour, writer, rate. |
| `05_serial_test_frames.txt` | Ready-to-paste hex frames for every VP and every page. |
| `tools/` | The generator (`spec.py`, `render.py`, `export.py`) and `spec.json` - rerun to regenerate every asset after a layout change. |

## 2. Prerequisites
1. **DGUS Tool V7.651** (Windows). Unzip to a path with no spaces, e.g. `C:\DWIN\DGUS`.
2. **Fonts:** install *JetBrains Mono* (free) so the font tool can see it.
3. **SD card:** 4-16 GB, **FAT32, 4096-byte allocation unit**, Class 10 (per your document; DWIN's loader is picky - [VERIFY] in the DWIN guide). Empty except for `DWIN_SET`.
4. **Hardware for testing:** 5 V supply, USB-TTL adapter at **3.3 V**, a serial terminal in hex mode (SSCOM, Realterm).
5. **Hardware-team questions:** where is the TF slot on this module; which UART is wired to the ESP32 (the *DWIN OS file* must match - section 6); is there a buzzer (ESP32 must not drive it; the siren is the ESP32's hardware buzzer).

## 3. Create the project
1. Start DGUS Tool -> **New**. Resolution **240 x 320**, folder `C:\RMP_HMI\project`.
2. Save once: this creates `DWprj.hmi` next to an empty `DWIN_SET` folder. Keep the whole folder (including `.hmi`) in Git and tag each release.
3. Copy this package to `C:\RMP_HMI\assets`.

## 4. Background library (sector 32)
1. Put `0.bmp ... 9.bmp` in a folder named `32` (the tool convention is one folder per library). Keep the numbers 0-9; DGUS indexes by number. If the tool lists them as 0,1,2,10 sort order, fix it before generating.
2. Open the **ICL tool** -> choose the folder -> JPEG quality 100 -> **Generate**. Save as `32.ICL`/`32_xxx.ICL` in **DWIN_SET** (and keep a copy in your source folder).
3. Why 32: the number in an ICL file name is the **flash sector** it is written to, and a sector holds one file. Use unique numbers; 32 for pictures and 33-39 for icons follows DWIN's convention [VERIFY the allowed range in the guide, chapter on flash layout].
4. Your logo: replace the placeholder in `0.bmp` first (edit the BMP in any editor, keep 240x320, 24-bit).

## 5. Icon libraries
Repeat the ICL tool once per folder in `02_icon_libraries` (33 conn pill, 34 quality pill, 35 status dot, 36 alarm header, 37 mute button, 38 running footer, 39 audit state). Save each as `NN.ICL` in DWIN_SET. Never rename the images - the number *is* the value the ESP32 writes.
Rule that bites everyone: **if you change any picture later, regenerate its ICL, copy it into DWIN_SET again, and regenerate 13/14/22.** Old pictures on the screen almost always mean an old ICL on the SD card.

## 6. Font, configuration, DWIN OS
1. **Font:** run *0# word bank generating*, pick JetBrains Mono (Regular/Bold as the tool allows). You need cells 8x16, 12x24, 16x32 and 20x40 [VERIFY the exact list offered; if one is missing, tell me and I will resnap the layout]. Output `0_DWIN_ASC.HZK` -> DWIN_SET.
2. **Config file** (`T5LCFG*.CFG`): *New CFG*. Set **baud 115200** (8N1, agreed with firmware), start page 0, touch off if the panel has none, rotation only if the screen comes up rotated. Enable **write-ACK** only if firmware wants it (frame `5A A5 03 82 4F 4B`).
3. **DWIN OS file** (name like `DWINOS_..._UARTx.bin`, supplied by DWIN or the module vendor): it selects which UART the display uses. **Do not change it** unless the hardware team confirms the UART; a wrong OS file stops all serial communication.

## 7. Place the variables, page by page
Open the Variable configuration view (F3). For each page: select the page, draw a variable box, then type the exact x/y/w/h so you never position by eye.

**Text Display** (every row of type Text): VP; box x,y,w,h; **bytes** = length; font library 0 (0_DWIN_ASC), cell as listed; alignment as listed; colour as listed; **end-of-text marker 0xFFFF on** (so shorter strings clear the old text) [VERIFY option name]. Variable length is always bytes = 2 x words; the next VP must be at least bytes/2 words higher (already true in `VP_map.csv`).
**Icon Display:** VP; library number; first icon index 0; **opaque** display (the images carry their own background) [VERIFY].
**Progress bar:** try the *Progress Bar Display* widget first [VERIFY parameters]. If it is awkward, use the stepped icons in `40_/41_FALLBACK_*` as Icon Display variables (value 0-10) - same VP, same position.
**Touch / Return Key Code:** an invisible touch area; when pressed the display sends `5A A5 06 83 <VP> 01 <value>`. Only useful if the panel has touch.
**Tip:** the header variables `0x2000/0x2018/0x2040` appear on pages 1 and 6; build them once and copy to the other page. Same VP on two pages stays in sync.

### Page 0 - Boot / POST (doc page 0x0000, picture `0.bmp`)
| VP | Name | Widget | x | y | w | h | Settings |
|---|---|---|---|---|---|---|---|
| `0x1306` | boot_progress | Progress bar (or stepped icons 40/41) | 20 | 285 | 200 | 6 | 0-100 (widget) or 0-10 (fallback icons), fill `#00F0FF` |
| `0x1060` | fw_version | Text Display | 20 | 300 | 128 | 16 | 16 bytes, font 0#, cell 8x16, align l, colour `#8196BC` |

### Page 1 - Idle Standby (doc page 0x0001, picture `1.bmp`)
| VP | Name | Widget | x | y | w | h | Settings |
|---|---|---|---|---|---|---|---|
| `0x2000` | reactor_title | Text Display | 32 | 9 | 128 | 16 | 24 bytes, font 0#, cell 8x16, align l, colour `#F4F7FC` |
| `0x2018` | conn_pill | Icon Display | 172 | 8 | 56 | 18 | library 33, first icon 0; values: 0 ONLINE,1 OFFLINE |
| `0x2020` | lab_name | Text Display | 12 | 40 | 120 | 16 | 20 bytes, font 0#, cell 8x16, align l, colour `#9DB0CF` |
| `0x2040` | clock | Text Display | 188 | 40 | 40 | 16 | 10 bytes, font 0#, cell 8x16, align r, colour `#9DB0CF` |
| `0x1300` | temp_quality_dot | Icon Display | 208 | 69 | 9 | 9 | library 35, first icon 0; values: 0 good,1 suspect,2 bad,3 off |
| `0x1100` | temp_value | Text Display | 22 | 82 | 100 | 40 | 8 bytes, font 0#, cell 20x40, align r, colour `#00F0FF` |
| `0x1110` | temp_raw | Text Display | 22 | 126 | 120 | 16 | 16 bytes, font 0#, cell 8x16, align l, colour `#8196BC` |
| `0x1120` | cal_tag | Text Display | 154 | 126 | 64 | 16 | 10 bytes, font 0#, cell 8x16, align r, colour `#8196BC` |
| `0x1130` | rpm_value | Text Display | 20 | 176 | 48 | 24 | 8 bytes, font 0#, cell 12x24, align l, colour `#F4F7FC` |
| `0x1140` | torque_value | Text Display | 126 | 176 | 60 | 24 | 8 bytes, font 0#, cell 12x24, align l, colour `#F4F7FC` |

### Page 2 - SoftAP Wi-Fi Provisioning (doc page 0x0002, picture `2.bmp`)
| VP | Name | Widget | x | y | w | h | Settings |
|---|---|---|---|---|---|---|---|

### Page 3 - Unclaimed / Unbound Device (doc page 0x0003, picture `3.bmp`)
| VP | Name | Widget | x | y | w | h | Settings |
|---|---|---|---|---|---|---|---|
| `0x2050` | device_uuid | Text Display | 18 | 130 | 192 | 16 | 36 bytes, font 0#, cell 8x16, align l, colour `#00F0FF` |
| `0x3280` | mac_address | Text Display | 50 | 156 | 136 | 16 | 18 bytes, font 0#, cell 8x16, align l, colour `#9DB0CF` |
| `0x3210` | ip_address | Text Display | 50 | 176 | 128 | 16 | 16 bytes, font 0#, cell 8x16, align l, colour `#9DB0CF` |
| `0x3220` | mqtt_broker | Text Display | 54 | 196 | 152 | 16 | 24 bytes, font 0#, cell 8x16, align l, colour `#9DB0CF` |

### Page 4 - Analyst Process Assignment (doc page 0x0010, picture `4.bmp`)
| VP | Name | Widget | x | y | w | h | Settings |
|---|---|---|---|---|---|---|---|
| `0x3000` | analyst_name | Text Display | 18 | 70 | 204 | 24 | 30 bytes, font 0#, cell 12x24, align l, colour `#F4F7FC` |
| `0x3070` | scope_tag | Text Display | 18 | 110 | 200 | 16 | 24 bytes, font 0#, cell 8x16, align l, colour `#9DB0CF` |
| `0x3020` | process_name | Text Display | 18 | 148 | 200 | 16 | 30 bytes, font 0#, cell 8x16, align l, colour `#F4F7FC` |
| `0x3010` | touch: accept | Touch / Return Key Code | 12 | 198 | 216 | 44 | returns `0x0000` (physical key: BTN_UP) |
| `0x3010` | touch: reject | Touch / Return Key Code | 12 | 250 | 216 | 38 | returns `0x0001` (physical key: BTN_DOWN) |

### Page 5 - Pre-Start Checklist & Limits (doc page 0x0011, picture `5.bmp`)
| VP | Name | Widget | x | y | w | h | Settings |
|---|---|---|---|---|---|---|---|
| `0x3020` | process_name | Text Display | 18 | 50 | 200 | 16 | 30 bytes, font 0#, cell 8x16, align l, colour `#38BDF8` |
| `0x3080` | max_temp | Text Display | 116 | 80 | 64 | 16 | 8 bytes, font 0#, cell 8x16, align r, colour `#F4F7FC` |
| `0x3090` | max_speed | Text Display | 116 | 98 | 64 | 16 | 8 bytes, font 0#, cell 8x16, align r, colour `#F4F7FC` |
| `0x30A0` | max_roc | Text Display | 116 | 116 | 64 | 16 | 8 bytes, font 0#, cell 8x16, align r, colour `#F59E0B` |
| `0x3030` | touch: start | Touch / Return Key Code | 12 | 204 | 216 | 44 | returns `0x0000` (physical key: BTN_UP) |
| `0x3030` | touch: cancel | Touch / Return Key Code | 12 | 256 | 216 | 36 | returns `0x0001` (physical key: BTN_DOWN) |

### Page 6 - Live Running Dashboard (doc page 0x0012, picture `6.bmp`)
| VP | Name | Widget | x | y | w | h | Settings |
|---|---|---|---|---|---|---|---|
| `0x2000` | reactor_title | Text Display | 10 | 8 | 112 | 16 | 24 bytes, font 0#, cell 8x16, align l, colour `#F4F7FC` |
| `0x2018` | conn_pill | Icon Display | 132 | 7 | 56 | 18 | library 33, first icon 0; values: 0 ONLINE,1 OFFLINE |
| `0x2040` | clock | Text Display | 190 | 8 | 40 | 16 | 10 bytes, font 0#, cell 8x16, align r, colour `#9DB0CF` |
| `0x1301` | temp_quality_pill | Icon Display | 172 | 43 | 52 | 18 | library 34, first icon 0; values: 0 GOOD,1 SUSPECT,2 BAD |
| `0x1100` | temp_value | Text Display | 18 | 66 | 100 | 40 | 8 bytes, font 0#, cell 20x40, align r, colour `#00F0FF` |
| `0x11B0` | trend_rate | Text Display | 148 | 86 | 48 | 16 | 10 bytes, font 0#, cell 8x16, align r, colour `#10B981` |
| `0x1110` | temp_raw | Text Display | 18 | 124 | 120 | 16 | 16 bytes, font 0#, cell 8x16, align l, colour `#8196BC` |
| `0x1120` | cal_tag | Text Display | 158 | 124 | 64 | 16 | 10 bytes, font 0#, cell 8x16, align r, colour `#8196BC` |
| `0x1130` | rpm_value | Text Display | 16 | 174 | 48 | 24 | 8 bytes, font 0#, cell 12x24, align l, colour `#F4F7FC` |
| `0x1150` | rpm_set | Text Display | 16 | 206 | 64 | 16 | 10 bytes, font 0#, cell 8x16, align l, colour `#8196BC` |
| `0x1140` | torque_value | Text Display | 130 | 174 | 60 | 24 | 8 bytes, font 0#, cell 12x24, align l, colour `#F4F7FC` |
| `0x1305` | torque_load_bar | Progress bar (or stepped icons 40/41) | 130 | 208 | 90 | 4 | 0-100 (widget) or 0-10 (fallback icons), fill `#00F0FF` |
| `0x11D0` | batch_tag | Text Display | 108 | 242 | 96 | 16 | 12 bytes, font 0#, cell 8x16, align l, colour `#10B981` |
| `0x11C0` | duration | Text Display | 68 | 260 | 64 | 16 | 10 bytes, font 0#, cell 8x16, align l, colour `#F4F7FC` |
| `0x1160` | fault_code | Text Display | 186 | 260 | 32 | 16 | 6 bytes, font 0#, cell 8x16, align l, colour `#F4F7FC` |
| `0x1307` | run_footer | Icon Display | 16 | 288 | 200 | 16 | library 38, first icon 0; values: 0 hint,1 silenced |

### Page 7 - Critical Safety Alarm (doc page 0x0013, picture `7.bmp`)
| VP | Name | Widget | x | y | w | h | Settings |
|---|---|---|---|---|---|---|---|
| `0x1308` | alarm_header_flash | Icon Display | 0 | 0 | 240 | 40 | library 36, first icon 0; values: 0 bright,1 dim |
| `0x1180` | alarm_param | Text Display | 16 | 54 | 208 | 16 | 32 bytes, font 0#, cell 8x16, align l, colour `#FDE047` |
| `0x1170` | alarm_rate | Text Display | 16 | 72 | 96 | 32 | 16 bytes, font 0#, cell 16x32, align r, colour `#F4F7FC` |
| `0x11A0` | alarm_limit | Text Display | 86 | 106 | 48 | 16 | 8 bytes, font 0#, cell 8x16, align r, colour `#FCA5A5` |
| `0x1190` | alarm_temp | Text Display | 120 | 126 | 48 | 16 | 8 bytes, font 0#, cell 8x16, align r, colour `#F4F7FC` |
| `0x1309` | mute_button | Icon Display | 12 | 248 | 216 | 48 | library 37, first icon 0; values: 0 SILENCE,1 SILENCED |
| `0x3040` | touch: silence siren | Touch / Return Key Code | 12 | 248 | 216 | 48 | returns `0x0001` (physical key: BTN_SELECT / BTN_MENU) |

### Page 8 - Process Completion & Handover (doc page 0x0014, picture `8.bmp`)
| VP | Name | Widget | x | y | w | h | Settings |
|---|---|---|---|---|---|---|---|
| `0x3020` | process_name | Text Display | 18 | 56 | 200 | 16 | 30 bytes, font 0#, cell 8x16, align l, colour `#00F0FF` |
| `0x3100` | total_duration | Text Display | 112 | 84 | 64 | 16 | 10 bytes, font 0#, cell 8x16, align r, colour `#F4F7FC` |
| `0x3110` | final_temp | Text Display | 112 | 104 | 64 | 16 | 8 bytes, font 0#, cell 8x16, align r, colour `#9DB0CF` |
| `0x3120` | samples_logged | Text Display | 112 | 124 | 64 | 16 | 10 bytes, font 0#, cell 8x16, align r, colour `#9DB0CF` |
| `0x130A` | audit_state | Icon Display | 18 | 148 | 204 | 16 | library 39, first icon 0; values: 0 saving,1 stored |
| `0x3050` | touch: release | Touch / Return Key Code | 12 | 210 | 216 | 48 | returns `0x0001` (physical key: BTN_UP / BTN_SELECT) |

### Page 9 - Hardware & Network Diagnostics (doc page 0x0020, picture `9.bmp`)
| VP | Name | Widget | x | y | w | h | Settings |
|---|---|---|---|---|---|---|---|
| `0x1310` | dot_ssid | Icon Display | 18 | 52 | 9 | 9 | library 35, first icon 0; values: 0 good,1 suspect,2 bad,3 off |
| `0x3200` | ssid | Text Display | 70 | 48 | 128 | 16 | 16 bytes, font 0#, cell 8x16, align r, colour `#F4F7FC` |
| `0x1311` | dot_ip_address | Icon Display | 18 | 76 | 9 | 9 | library 35, first icon 0; values: 0 good,1 suspect,2 bad,3 off |
| `0x3210` | ip_address | Text Display | 70 | 72 | 128 | 16 | 16 bytes, font 0#, cell 8x16, align r, colour `#F4F7FC` |
| `0x1312` | dot_mqtt_broker | Icon Display | 18 | 100 | 9 | 9 | library 35, first icon 0; values: 0 good,1 suspect,2 bad,3 off |
| `0x3220` | mqtt_broker | Text Display | 70 | 96 | 152 | 16 | 24 bytes, font 0#, cell 8x16, align r, colour `#F4F7FC` |
| `0x1313` | dot_mtls_status | Icon Display | 18 | 124 | 9 | 9 | library 35, first icon 0; values: 0 good,1 suspect,2 bad,3 off |
| `0x3230` | mtls_status | Text Display | 70 | 120 | 152 | 16 | 24 bytes, font 0#, cell 8x16, align r, colour `#F4F7FC` |
| `0x1314` | dot_ntp_status | Icon Display | 18 | 148 | 9 | 9 | library 35, first icon 0; values: 0 good,1 suspect,2 bad,3 off |
| `0x3240` | ntp_status | Text Display | 70 | 144 | 152 | 16 | 20 bytes, font 0#, cell 8x16, align r, colour `#F4F7FC` |
| `0x1315` | dot_rtd_status | Icon Display | 18 | 172 | 9 | 9 | library 35, first icon 0; values: 0 good,1 suspect,2 bad,3 off |
| `0x3250` | rtd_status | Text Display | 70 | 168 | 152 | 16 | 20 bytes, font 0#, cell 8x16, align r, colour `#F4F7FC` |
| `0x1316` | dot_rs232_status | Icon Display | 18 | 196 | 9 | 9 | library 35, first icon 0; values: 0 good,1 suspect,2 bad,3 off |
| `0x3260` | rs232_status | Text Display | 70 | 192 | 152 | 16 | 20 bytes, font 0#, cell 8x16, align r, colour `#F4F7FC` |
| `0x1317` | dot_flash_status | Icon Display | 18 | 220 | 9 | 9 | library 35, first icon 0; values: 0 good,1 suspect,2 bad,3 off |
| `0x3270` | flash_status | Text Display | 70 | 216 | 152 | 16 | 24 bytes, font 0#, cell 8x16, align r, colour `#F4F7FC` |
| `0x1318` | dot_mac_address | Icon Display | 18 | 244 | 9 | 9 | library 35, first icon 0; values: 0 good,1 suspect,2 bad,3 off |
| `0x3280` | mac_address | Text Display | 70 | 240 | 152 | 16 | 18 bytes, font 0#, cell 8x16, align r, colour `#F4F7FC` |
| `0x3060` | touch: return | Touch / Return Key Code | 12 | 272 | 216 | 38 | returns `0x0001` (physical key: BTN_MENU short / BTN_DOWN) |

## 8. Generate and flash
1. **File -> Save**, then **File -> Generate**. This rewrites `13TouchFile.bin`, `14ShowFile.bin`, `22_Config.bin` in DWIN_SET.
2. DWIN_SET must now contain: the three BINs, `32.ICL`, `33-39.ICL`, `0_DWIN_ASC.HZK`, the `T5LCFG*.CFG` and the DWIN OS file. (No loose BMPs.)
3. Copy the **whole DWIN_SET folder** to the SD-card root. Power the display off, insert the card, power on, wait for the update message/beep, power off, remove the card, power on.
4. Do not hand-edit `22_Config.bin` - Generate overwrites it. If you must (Modbus etc.), edit a copy and copy it back afterwards.

## 9. Bench test with no ESP32
Connect USB-TTL (3.3 V, TX->display RX, RX->display TX, common ground), 115200 8N1, hex mode. Open `05_serial_test_frames.txt` and walk every page: send "Go to page", then each variable line. Pass criteria per page: picture matches `04_preview...`, every text aligns and clears, icons switch for each value, no text clipped, no garbage characters.
Special cases: longest strings (`Synthesis Batch B-42`, 17-char analyst name), `---` for a bad reading, every icon value, alarm header toggling 0/1 every second, mute button 0 then 1, `5A A5 04 83 00 14 01` to read the current page.

## 10. Firmware change list (give this to the embedded team)
1. Use the VP addresses in `VP_map.csv`, not the document's section 4.
2. Map page IDs (section 0, item 1). Page switch frame: `5A A5 07 82 00 84 5A 01 00 <page>`.
3. Send only ASCII; units are baked in. Text ends with `FF FF` when shorter than the variable.
4. Drive icon variables (`0x2018, 0x1300, 0x1301, 0x1307, 0x1308, 0x1309, 0x130A, 0x1310-0x1318`) with the values in the table; toggle `0x1308` 0/1 at 1 Hz during an alarm.
5. Parse return-key frames `5A A5 06 83 <VP> 01 <value>` and the optional write-ACK `5A A5 03 82 4F 4B`.
6. Handle the physical keys exactly as printed in the footers (UP accept/start, DOWN reject/cancel, SELECT or MENU silence, UP or SELECT release, MENU hold 3 s diagnostics).
7. Wait 1-2 s after power-up before writing (poll with the page-read frame) and add a heartbeat if you want stale-screen detection (the header has no heartbeat dot in v2.0 - say if you want one).

## 11. Troubleshooting
| Symptom | Likely cause / fix |
|---|---|
| Old picture still showing | Old ICL on the card. Regenerate ICL **and** 13/14/22, delete old DWIN_SET from the card, copy again. |
| Black/white screen | Missing or bad `14ShowFile.bin` or ICL not in DWIN_SET. |
| Wrong picture on a page | Image numbering off (0,1,10,2). Fix order in the ICL tool. |
| Text missing / boxes | Font file missing, wrong font library, or non-ASCII character sent. |
| Text clipped | Box width < chars x cell width, or string longer than the variable's bytes. |
| Text overlaps next field | Two VPs overlapping in memory - re-check addresses. |
| Serial dead | Baud mismatch, TX/RX swapped, 5 V on a 3.3 V line, or a changed DWIN OS file. |
| Colours differ from BMP | Panel colour depth; test dark tones on the real display. |
| Screen rotated | Orientation setting in the CFG. |
| Page will not switch | Frame needs `5A 01` before the 2-byte page number. |

## 12. Open items to confirm
- Touch panel present? (section 0, item 7)
- Exact font cell list in your V7.651 font tool; PNG vs BMP import (BMP is provided).
- ICL file-number range, SD allocation unit, 0xFFFF end-marker option name, Progress Bar widget parameters.
- Where the TF slot is on the module (service-visit flashing).
- Logo files and the final POST wording on page 0 (the three OK lines are static pictures; if a check fails the firmware should jump to page 9).
