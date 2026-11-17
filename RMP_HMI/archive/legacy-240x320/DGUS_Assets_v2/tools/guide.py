import json, os, shutil
from PIL import Image, ImageDraw
import spec as SP, render as RN
O='/home/claude/out/DGUS_Assets_v2'
# fallback stepped bars (if Progress Bar widget is not used)
for lib,name,w,h,bg in ((40,'boot_bar_200x6',200,6,SP.C['bg']),(41,'load_bar_90x4',90,4,SP.C['surface'])):
    d=f'{O}/02_icon_libraries/{lib}_FALLBACK_{name}'; os.makedirs(d,exist_ok=True)
    for i in range(11):
        S=4; im=Image.new('RGB',(w*S,h*S),RN.rgb(bg)); dr=ImageDraw.Draw(im)
        dr.rounded_rectangle([0,0,w*S-1,h*S-1],radius=2*S,fill=RN.rgb(SP.C['border']))
        if i: dr.rounded_rectangle([0,0,max(w*S*i//10,4*S)-1,h*S-1],radius=2*S,fill=RN.rgb(SP.C['cyan']))
        im=im.resize((w,h),Image.LANCZOS); im.save(f'{d}/{i}.bmp'); im.save(f'{d}/{i}.png')
# contact sheets
import glob
def sheet(folder,pref,out,scale=1):
    fs=sorted(glob.glob(f'{O}/{folder}/*.png'),key=lambda p:int(os.path.basename(p).split('_')[1]))
    w,h=Image.open(fs[0]).size; w=int(w*scale);h=int(h*scale)
    sh=Image.new('RGB',(5*(w+10)+10,2*(h+10)+10),(30,34,46))
    for i,f in enumerate(fs): sh.paste(Image.open(f).resize((w,h),Image.LANCZOS),(10+(i%5)*(w+10),10+(i//5)*(h+10)))
    sh.save(f'{O}/{out}')
sheet('04_preview_with_sample_values','PREVIEW','contact_sheet_preview.png')
sheet('03_placement_map','MAP','contact_sheet_placement_map.png',0.5)
# ---- guide
rows=[]; 
def pagetable(pid):
    P=SP.S[pid]; seen=set(); L=['| VP | Name | Widget | x | y | w | h | Settings |','|---|---|---|---|---|---|---|---|']
    for e in P['els']:
        if e['t'] not in('slot','islot','pslot','touch'): continue
        key=(e['vp'],e.get('val'))
        if key in seen: continue
        seen.add(key)
        if e['t']=='slot': L.append(f"| `0x{e['vp']:04X}` | {e['name']} | Text Display | {e['x']} | {e['y']} | {e['w']} | {e['h']} | {e['bytes']} bytes, font 0#, cell {e['cell']}x{e['cell']*2}, align {e['al']}, colour `{e['c']}` |")
        elif e['t']=='islot':
            Ls=SP.LIBS[e['lib']]; L.append(f"| `0x{e['vp']:04X}` | {e['name']} | Icon Display | {e['x']} | {e['y']} | {Ls['w']} | {Ls['h']} | library {e['lib']}, first icon 0; values: {e['values']} |")
        elif e['t']=='pslot': L.append(f"| `0x{e['vp']:04X}` | {e['name']} | Progress bar (or stepped icons 40/41) | {e['x']} | {e['y']} | {e['w']} | {e['h']} | 0-100 (widget) or 0-10 (fallback icons), fill `{e['fill']}` |")
        else: L.append(f"| `0x{e['vp']:04X}` | touch: {e['name']} | Touch / Return Key Code | {e['x']} | {e['y']} | {e['w']} | {e['h']} | returns `0x{e['val']:04X}` (physical key: {e['key']}) |")
    return '\n'.join(L)
G=[]
G.append('''# Borosil RMP - DWIN DGUS HMI v2.0: first-timer build guide
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
1. **DGUS Tool V7.651** (Windows). Unzip to a path with no spaces, e.g. `C:\\DWIN\\DGUS`.
2. **Fonts:** install *JetBrains Mono* (free) so the font tool can see it.
3. **SD card:** 4-16 GB, **FAT32, 4096-byte allocation unit**, Class 10 (per your document; DWIN's loader is picky - [VERIFY] in the DWIN guide). Empty except for `DWIN_SET`.
4. **Hardware for testing:** 5 V supply, USB-TTL adapter at **3.3 V**, a serial terminal in hex mode (SSCOM, Realterm).
5. **Hardware-team questions:** where is the TF slot on this module; which UART is wired to the ESP32 (the *DWIN OS file* must match - section 6); is there a buzzer (ESP32 must not drive it; the siren is the ESP32's hardware buzzer).

## 3. Create the project
1. Start DGUS Tool -> **New**. Resolution **240 x 320**, folder `C:\\RMP_HMI\\project`.
2. Save once: this creates `DWprj.hmi` next to an empty `DWIN_SET` folder. Keep the whole folder (including `.hmi`) in Git and tag each release.
3. Copy this package to `C:\\RMP_HMI\\assets`.

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
''')
for pid,P in SP.S.items():
    G.append(f"### Page {pid} - {P['title']} (doc page {P['doc_page']}, picture `{pid}.bmp`)\n{pagetable(pid)}\n")
G.append('''## 8. Generate and flash
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
''')
open(f'{O}/GUIDE_DGUS_V7651_first_timer.md','w').write('\n'.join(G))
open(f'{O}/README.txt','w').write('''RMP DWIN HMI v2.0 - DGUS asset package (10 pages, 240x320)
Start with GUIDE_DGUS_V7651_first_timer.md.
Pages: 0 Boot | 1 Idle | 2 SoftAP | 3 Unbound | 4 Assignment | 5 Pre-start | 6 Running | 7 Alarm | 8 Completed | 9 Diagnostics
Doc IDs -> DGUS pages: 0x0000..0x0003 -> 0..3, 0x0010..0x0014 -> 4..8, 0x0020 -> 9.
Figma: https://www.figma.com/design/9hEyJW6XeMiDn9Xgmu5Mzz (same design; backgrounds here are rendered from the same spec).
''')
os.makedirs(f'{O}/tools',exist_ok=True)
for f in ('spec.py','render.py','export.py','guide.py','spec.json'): shutil.copy(f'/home/claude/build/{f}',f'{O}/tools/{f}')
