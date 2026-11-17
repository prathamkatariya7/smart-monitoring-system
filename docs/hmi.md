# DWIN HMI guide

## Current target

- Module: DWIN DMG48320C035_03WN commercial-grade 3.5-inch Smart LCM.
- Native resolution: 320×480 portrait.
- Firmware-owned UART: existing DWIN UART at 115200 8N1.
- Source contract: `RMP_HMI/DGUS_Assets_320x480_DRAFT/`.

The draft package contains 320×480 backgrounds, the coordinate/layout manifest, scaled VP map and project metadata. It is the current migration contract for UI/UX review; it is not a final released `DWIN_SET` until generated and bench-tested on the exact display.

## Navigation contract

| Button | Global role |
|---|---|
| UP | Previous focus or earlier scroll window |
| DOWN | Next focus or later scroll window |
| SELECT | Open, confirm, acknowledge or toggle the focused block |
| MODE | Return to the parent screen without saving uncommitted changes |

The firmware owns focus and diagnostics-window VPs and writes them atomically so the display cannot glow a different item from the firmware cursor.

## Release workflow

1. UI/UX updates the current 320×480 source artwork and manifest.
2. Run `python tools/migrate_dgus_320x480.py` only when regenerating migration outputs.
3. Open the project in the approved DGUS tool and generate the final binary package.
4. Validate page geometry, VP addresses, touch-return frames, fonts and text clearing on the exact panel.
5. Test all button paths, safe MODE exit, alarm lockout and power-cycle recovery.
6. Store the exact released package and validation evidence under a versioned release artifact; do not overwrite the legacy archive.

The superseded 240×320 material is retained under `RMP_HMI/archive/legacy-240x320/` for traceability only.
