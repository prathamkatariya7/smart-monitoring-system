# Reactor Monitoring Platform (RMP) — Project Overview

**Audience:** anyone picking this project up for the first time — management,
a new contributor, a client, or future-you after a few months away.
**Purpose:** a single "read this first" map of the whole system. It does not
repeat detail that already lives in a dedicated document — it tells you
*what exists* and *where to go* for the specifics.
**Status:** current as of 2026-11-10 (ties firmware status in this document
to `firmware-esp-idf.md` memory and the bench reality, not just intentions).

---

## 1. What this is, in one paragraph

Borosil Scientific's **Reactor Monitoring Platform**: each physical reactor
gets an ESP32-P4 + ESP32-C6 control box (with a DWIN touch display and an
onboard speaker for alerts) that reports live process telemetry
(temperature, RPM, torque, quality flags) to a **locally-hosted, no-cloud**
server. A web app lets lab staff monitor reactors in real time, run process
"attempts" (recipe runs), manage alarms and overrides, and administer
sites/labs/devices/licensing. Everything is free/open-source and
self-hosted via Docker Desktop — **zero ongoing cost, by design.**

---

## 2. The five parts of the system, and where each is documented

| Part | What it does | Status | Full detail |
|---|---|---|---|
| **Firmware** (ESP32-P4/C6) | On-reactor sampling, display, alerts, telemetry uplink | In progress — see §3 below | [`firmware/docs/SPEC.md`](../firmware/docs/SPEC.md) (build spec), [`firmware/docs/bench-wiring-guide.md`](../firmware/docs/bench-wiring-guide.md) (wiring) |
| **Backend** (NestJS + PostgreSQL/TimescaleDB) | REST API, MQTT ingestion, auth, alarms, licensing, backups | Built and running | [`system-architecture.md`](./system-architecture.md) |
| **Frontend** (React + Vite) | The web app lab staff/admins actually use | Built and running (dev-server only, no production build yet) | [`frontend-manual-test-guide.md`](./frontend-manual-test-guide.md) |
| **Wire contract** (device ⇄ server) | Exact MQTT topics/JSON the firmware and backend agree on | Finalized, both sides implement it | [`firmware-integration-guide.md`](./firmware-integration-guide.md) |
| **Licensing** | Offline signed-licence model gating new device claims | Built and working | [`licence-management-guide.md`](./licence-management-guide.md) |
| **On-device HMI (DWIN)** | What the physical touchscreen should show | Proposed spec, not yet built | [`dwin-hmi-ui-guide.md`](./dwin-hmi-ui-guide.md) |

Everything runs on one machine via `docker-compose.yml` at the repo root:
`postgres` (TimescaleDB), `mosquitto` (MQTT broker, mTLS), `app` (the NestJS
backend), `caddy` (TLS reverse proxy). See `system-architecture.md` §5 for
the exact topology and §2.1 for what each backend module does.

---

## 3. Firmware status — what's actually confirmed on real hardware

This is the part of the system most recently worked on, and the part most
likely to go stale in other docs — this table is the source of truth,
updated each session (cross-check against the `firmware-esp-idf.md` memory
file for full debugging history on any row).

| Area | Status | Notes |
|---|---|---|
| Toolchain (ESP-IDF v5.5.6, esp_hosted/esp_wifi_remote Wi-Fi coprocessor) | ✅ Confirmed on hardware | M0 gate passed, no C6 reflash needed |
| PT100 temperature (MAX31865) | ✅ Confirmed on hardware | 2-wire, Rref=430Ω, stable ~25.7°C reading at room temp |
| Onboard speaker (ES8311 codec + amp, 3 alert levels) | ✅ Confirmed on hardware | Low/Medium/High tones all audible after two bug fixes (see memory) |
| Wi-Fi connect + mTLS MQTT5 → backend telemetry | ✅ Confirmed on hardware | Live rows observed in the `measurement` table |
| Wi-Fi captive-portal provisioning + NVS runtime config (`rmp_prov`) | ✅ Confirmed on hardware | SoftAP boots correctly on fresh NVS; console `set wifi`/`set broker`/`set devid` path fully verified; phone-side auto-popup UX not physically tested (no phone on hand) |
| Heidolph motor (read-only RS232) | 🔶 Built, not yet wired | Reply format still `[VERIFY]` — needs bench data once connected |
| DWIN display output | 🔶 Built, not yet wired | VP addresses/baud still `[VERIFY]` against the DGUS project |
| Buttons | 🔶 Built, not yet wired | — |
| Ethernet fallback (dual-interface failover state machine, SPEC.md §5) | ❌ Not built | Ethernet hardware itself is unwired; decision (Wi-Fi primary, Ethernet fallback) is locked in `rmp_config.h`/`SPEC.md` for whenever this is built |
| Ring buffer / flash-backed sample storage (M2) | ❌ Not built | Sampler currently runs "live only", no offline buffering yet |
| OTA, SoftAP (original "no SoftAP" decision) | N/A | SoftAP was **deliberately re-enabled** 2026-11-10 for the Wi-Fi provisioning portal — see `sdkconfig.defaults` comment |

**How to verify any of this yourself:** flash the firmware (`firmware/build.ps1`
then `firmware/flash.ps1`), connect over the console (115200 baud, UART0),
and use `help` to see available commands (`status`, `rtd`, `motor`, `net`,
`alert low|med|high|off`, `set wifi/broker/devid`, `show config`, `reboot`).

---

## 4. Config that changes often — where to touch it, and the real fix

Two kinds of firmware configuration exist, and they are **not** the same file:

1. **First-boot-only defaults** — `firmware/components/rmp_types/include/rmp_bench_defaults.h`.
   This is the one file to edit if you need a brand-new, never-provisioned
   device to start with a different Wi-Fi SSID/broker IP/device ID out of
   the box. It has **no effect on an already-provisioned device.**
2. **Live, running-device configuration** — stored in NVS, changed via the
   serial console (`set wifi SSID PASS`, `set broker HOST [PORT]`,
   `set devid UUID`, then `reboot`) or, for Wi-Fi specifically, via the
   on-device captive-portal setup page. **This is the one to use for an
   already-flashed device** — no rebuild, no reflash.

**The dev machine's Wi-Fi IP changing on reconnect** (a real, observed
annoyance during bench testing) has one proper fix: set a **static DHCP
reservation** for this machine in your Wi-Fi router's admin page. That
makes the IP permanent, with zero firmware changes ever needed again. Until
that's done, `set broker <newIP>` + `reboot` is the one-command workaround
(see `rmp_bench_defaults.h`'s header comment for the full reasoning,
including why a custom mDNS responder was considered and rejected).

---

## 5. Running the whole stack locally

**Everything in Docker (recommended — closest to a real deployment):**
```powershell
# 1. Generate dev mTLS certificates (once)
./tools/gen-dev-certs.ps1

# 2. Build and start every service: postgres, mosquitto, the backend, the
#    frontend (production nginx build), and Caddy as the single entry point
docker compose up -d --build
docker compose ps        # all five containers should be "Up" (postgres "healthy")

# 3. Seed the first Borosil Admin user (once, fresh install only)
docker compose exec app npm run seed
```
Open **http://localhost** (port 80, through Caddy) — this serves the real
production build of the frontend (`frontend/Dockerfile`, multi-stage:
`vite build` → nginx with SPA fallback), proxied alongside `/api/*`,
`/health`, and `/socket.io/*` to the backend by
`infra/caddy/Caddyfile`'s catch-all route. This is also the easiest way to
confirm something is a *real* bug and not a React StrictMode dev-only
artifact (see `firmware-esp-idf.md`'s sibling memory note on this if it
ever comes up again) — the production build never double-invokes effects,
so if a problem reproduces here, it's real.

**Active frontend development (hot-reload, faster iteration):**
```powershell
docker compose up -d postgres mosquitto app caddy   # backend only
cd frontend
npm install               # first time only
npm run dev                # http://localhost:5173, Vite dev server + HMR
```
This talks to the same dockerized backend via Vite's dev proxy
(`vite.config.ts`). Use this day-to-day; use the full `docker compose up -d
--build` flow above when you want to test the real deployable artifact.

Full step-by-step screen-by-screen walkthrough, including test user
credentials for every role: [`frontend-manual-test-guide.md`](./frontend-manual-test-guide.md).

---

## 6. Security and licensing, in brief

- **Transport:** mTLS for every device↔broker connection, HTTPS for every
  browser↔server connection.
- **AuthN/Z:** Argon2id passwords + optional TOTP MFA, JWT sessions,
  role-based **and** Postgres row-level-security-based authorization (a
  user with no lab scope cannot read that lab's data at the database level,
  not just a hidden UI element).
- **Audit:** every state-changing action is written to a tamper-evident,
  hash-chained audit log.
- **Licensing:** fully offline, RSA-signed licence file, no phone-home,
  gates only *new device claims* — never blocks already-collected data or
  dashboards. Full detail, including how to issue/activate/test a licence:
  [`licence-management-guide.md`](./licence-management-guide.md).

Full detail on all of the above: [`system-architecture.md`](./system-architecture.md) §4.

---

## 7. What's genuinely not built yet (don't assume otherwise)

- Full Ethernet fallback / dual-interface network failover (firmware)
- Ring buffer / offline sample storage, remote calibration apply-with-ack (firmware)
- DWIN on-device UI (proposed spec exists, no implementation)
- PDF process reports, rate-of-change alarm thresholds (backend, documented gaps)
- Nightly backup cron reliability (backend) — missed firing on at least one
  night (2026-11-10/11) with no confirmed root cause; the manual trigger
  and `/health`'s staleness flag both work, so it's visible when it
  happens, but the automatic schedule isn't fully trusted yet

This list is kept in sync with `system-architecture.md` §7 — if the two ever
disagree, trust whichever was updated most recently (check file dates).
