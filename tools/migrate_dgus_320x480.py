#!/usr/bin/env python3
"""Generate the 320x480 DGUS migration artifacts.

The checked-in HMI package is the legacy 240x320 project. This tool scales its
coordinate contract and draft backgrounds without overwriting the originals.
The UI/UX team must replace the draft backgrounds and export final DGUS binary
assets with DGUS Designer before hardware release.
"""
from __future__ import annotations

import csv
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
HMI = ROOT / "RMP_HMI"
ASSETS = HMI / "archive" / "legacy-240x320" / "DGUS_Assets_v2"
BACKGROUND_ASSETS = ASSETS / "01_backgrounds_bmp"
OUT = HMI / "DGUS_Assets_320x480_DRAFT"
OUT.mkdir(parents=True, exist_ok=True)

OLD_W, OLD_H = 240, 320
NEW_W, NEW_H = 320, 480
SX, SY = NEW_W / OLD_W, NEW_H / OLD_H

# Scale the coordinate contract, not text or VP addresses. Rounding uses the
# nearest pixel and clamps dimensions to the new panel bounds.
source_csv = ASSETS / "VP_map.csv"
with source_csv.open(newline="", encoding="utf-8") as f:
    rows = list(csv.DictReader(f))
    fields = rows[0].keys() if rows else []
scaled_rows = []
for row in rows:
    row = dict(row)
    try:
        x, y, w, h = (int(row[k]) for k in ("x", "y", "w", "h"))
        row["x"] = str(max(0, min(NEW_W, round(x * SX))))
        row["y"] = str(max(0, min(NEW_H, round(y * SY))))
        row["w"] = str(max(1, min(NEW_W - int(row["x"]), round(w * SX))))
        row["h"] = str(max(1, min(NEW_H - int(row["y"]), round(h * SY))))
    except (KeyError, ValueError):
        pass
    scaled_rows.append(row)

# Firmware-owned navigation variables. These are intentionally explicit so the
# DGUS highlight is never inferred from physical button timing.
nav_rows = [
    {"vp_hex":"0x1320","name":"hmi_focus","widget":"Variable Icon / highlight","pages":"4,5,8","x":"16","y":"300","w":"288","h":"48","bytes":"2","cell":"","align":"","color":"","max_chars":"","icon_lib":"","values_or_notes":"0=top/primary, 1=bottom/secondary","writer":"ESP32->DWIN","rate":"on navigation","doc_v2.0_vp":"new 320x480"},
    {"vp_hex":"0x1321","name":"diagnostic_window_top","widget":"Variable / list window","pages":"9","x":"288","y":"80","w":"16","h":"320","bytes":"2","cell":"","align":"","color":"","max_chars":"","icon_lib":"","values_or_notes":"0..6, first visible row","writer":"ESP32->DWIN","rate":"on navigation","doc_v2.0_vp":"new 320x480"},
    {"vp_hex":"0x1322","name":"diagnostic_focus","widget":"Variable Icon / highlight","pages":"9","x":"16","y":"80","w":"272","h":"96","bytes":"2","cell":"","align":"","color":"","max_chars":"","icon_lib":"","values_or_notes":"0..2, visible row","writer":"ESP32->DWIN","rate":"on navigation","doc_v2.0_vp":"new 320x480"},
    {"vp_hex":"0x1323","name":"assignment_state","widget":"Variable Icon / status badge","pages":"4","x":"16","y":"188","w":"288","h":"40","bytes":"2","cell":"","align":"","color":"","max_chars":"","icon_lib":"","values_or_notes":"0=unassigned, 1=assigned","writer":"ESP32->DWIN","rate":"on state change","doc_v2.0_vp":"new 320x480"},
]
all_fields = list(fields)
for r in nav_rows:
    for k in all_fields:
        r.setdefault(k, "")
    scaled_rows.append(r)

out_csv = OUT / "VP_map_320x480.csv"
with out_csv.open("w", newline="", encoding="utf-8") as f:
    writer = csv.DictWriter(f, fieldnames=all_fields)
    writer.writeheader()
    writer.writerows(scaled_rows)

pages = [
    (0, "boot"), (1, "idle"), (2, "wifi_setup"), (3, "unbound"),
    (4, "assignment"), (5, "prestart"), (6, "running"), (7, "alarm"),
    (8, "completed"), (9, "diagnostics"),
]
for page, name in pages:
    source = BACKGROUND_ASSETS / f"{page}.bmp"
    target = OUT / f"{page}.bmp"
    if source.exists():
        with Image.open(source) as im:
            im.convert("RGB").resize((NEW_W, NEW_H), Image.Resampling.LANCZOS).save(target)

(OUT / "DWprj_320x480.hmi").write_text(
    "[INIT]\nPICFIX=1\nVARCount=64\nVersion=0\nProVersion=651\n"
    "SCREENDSIZE=320X480\nSPADDRESS=5000\n[IMG]\n"
    + "".join(f"{page}={page}.bmp\n" for page, _ in pages),
    encoding="utf-8",
)

manifest = {
    "panel": {
        "model": "DMG48320C035_03WN",
        "grade": "commercial",
        "width": NEW_W,
        "height": NEW_H,
        "rotation": 0,
        "brightness_nit": 300,
        "interface": "TTL/CMOS UART2, 8N1, 115200 typical",
        "source": "https://www.dwin-global.com/3-5-inch-smart-lcm-dmg48320c035_03wcommercial-grade-product/",
    },
    "legacy_source": {"width": OLD_W, "height": OLD_H, "project": "RMP_HMI/archive/legacy-240x320/DWprj.hmi"},
    "pages": [{"id": p, "name": n, "background": f"{p}.bmp"} for p, n in pages],
    "coordinate_transform": {"x_scale": SX, "y_scale": SY, "rounding": "nearest pixel", "source": "RMP_HMI/archive/legacy-240x320/DGUS_Assets_v2/VP_map.csv"},
    "navigation": {
        "buttons": {"0": "MODE", "1": "UP", "2": "DOWN", "3": "SELECT"},
        "edge_behavior": "stop; no wrap-around",
        "repeat": {"initial_delay_ms": 500, "interval_ms": 150},
        "debounce_ms": 25,
        "diagnostics": {"rows": 9, "visible_rows": 3, "window_top_range": [0, 6], "focus_range": [0, 2]},
        "vp_registers": {"focus": "0x1320", "diagnostic_window_top": "0x1321", "diagnostic_focus": "0x1322", "assignment_state": "0x1323"},
    },
    "release_gate": [
        "Replace the generated draft backgrounds with final 320x480 UI/UX artwork.",
        "Bind the four navigation VPs and all scaled VP coordinates in DGUS Designer.",
        "Configure Return Key Code touch areas only if the final hardware includes touch; physical tactile keys remain firmware-owned.",
        "Export and bench-test a complete DWIN_SET package on the exact DMG48320C035_03WN panel before release.",
    ],
}
(OUT / "layout_320x480.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
(OUT / "README.md").write_text(
    "# DGUS 320x480 migration draft\n\n"
    "Generated from the legacy 240x320 package by `tools/migrate_dgus_320x480.py`.\n"
    "The BMP backgrounds are geometric drafts only; do not release them without UI/UX review.\n"
    "Use `VP_map_320x480.csv` and `layout_320x480.json` to rebuild the final DGUS project in DGUS Designer.\n"
    "The legacy binary `RMP_HMI/archive/legacy-240x320/DWIN_SET` is intentionally not overwritten.\n",
    encoding="utf-8",
)
print(f"generated {OUT}")
