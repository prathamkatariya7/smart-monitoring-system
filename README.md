# Smart Monitoring System — Reactor Monitoring Platform (RMP)

An IoT-based reactor monitoring system with ESP32-P4 firmware, NestJS backend, React dashboard, DWIN HMI display, and Docker-based infrastructure.

## Architecture

```
┌─────────────┐      mTLS/MQTT       ┌──────────────┐      SQL       ┌────────────┐
│  ESP32-P4   │ ─────────────────────▶│  Mosquitto   │◀──────────────▶│ TimescaleDB│
│  Firmware   │      (port 8883)      │   Broker     │                │ (Postgres) │
└─────────────┘                       └──────┬───────┘                └─────┬──────┘
       │                                     │                              │
   UART/SPI                            MQTT subscribe                   TypeORM
       │                                     │                              │
┌─────────────┐                       ┌──────▼───────┐              ┌───────▼──────┐
│  DWIN HMI   │                       │   NestJS     │──Socket.IO──▶│   React 19   │
│  Display    │                       │   Backend    │              │   Frontend   │
└─────────────┘                       └──────────────┘              └──────────────┘
                                             │                              │
                                       ┌─────▼──────┐               ┌──────▼──────┐
                                       │   Caddy     │◀──────────────│  Nginx      │
                                       │ (HTTPS/Rev) │  reverse proxy│ (SPA serve) │
                                       └─────────────┘               └─────────────┘
```

## Quick Start

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows/Mac/Linux)
- [ESP-IDF v5.5.6](https://docs.espressif.com/projects/esp-idf/en/latest/esp32p4/get-started/) (for firmware flashing only)

### 1. Start the Server (Docker)

Double-click **`start-server.bat`** or run:

```bash
docker compose up -d --build
```

This starts all services:

| Service    | URL / Port                |
|------------|---------------------------|
| Frontend   | <http://localhost>          |
| API        | <http://localhost:3000>      |
| MQTT       | mqtts://localhost:18883    |
| PostgreSQL | localhost:5432             |

Database migrations run automatically on first start via the `migration` service.

### 2. Flash the ESP32-P4

Double-click **`flash-esp32.bat`** — it auto-detects the ESP32's COM port and flashes the firmware.

Or manually:

```powershell
cd firmware
. .\activate-esp-idf.ps1
idf.py -p COMxx flash
```

### 3. Build Firmware (without flashing)

```powershell
cd firmware
. .\activate-esp-idf.ps1
idf.py build
```

## Project Structure

```
├── backend/            # NestJS API + MQTT ingestion + WebSocket gateway
│   ├── src/
│   │   ├── database/   # TypeORM data-source, migrations, seed
│   │   ├── mqtt/       # MQTT client service, ingestion
│   │   ├── auth/       # JWT + MFA authentication
│   │   └── ...         # Equipment, devices, alarms, exports, etc.
│   └── Dockerfile
├── frontend/           # React 19 + Vite 8 + Ant Design 6
│   ├── src/
│   └── Dockerfile
├── firmware/           # ESP-IDF (ESP32-P4) firmware
│   ├── main/           # app_main.cpp + embedded certs
│   ├── components/     # rmp_rtd, rmp_mqtt, rmp_dwin, rmp_net, etc.
│   └── _gate/          # Bench-testing helper scripts
├── infra/              # Docker infrastructure configs
│   ├── mosquitto/      # Mosquitto broker config + mTLS certs
│   ├── caddy/          # Caddyfile reverse proxy
│   └── postgres/       # Init SQL (roles, extensions)
├── docs/               # Hardware wiring guides, specs
├── docker-compose.yml  # Full stack orchestration
├── flash-esp32.bat     # One-click ESP32 flasher
└── start-server.bat    # One-click server startup
```

## Configuration

### Backend Environment (`backend/.env`)

Copy the template and fill in your secrets:

- `DB_PASSWORD` — PostgreSQL password for the runtime app user
- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` — Auth token secrets
- `MQTT_*` — Broker connection (mTLS cert paths)

### Firmware Provisioning & Device Claim Flow (Production & Deployment)

1. **Connect to Device Hotspot**:
   - Power on the ESP32-P4 device. If unconfigured or disconnected, it starts a SoftAP hotspot named `RMP-Reactor-Setup`.
   - Connect to `RMP-Reactor-Setup` from a laptop or mobile phone.
2. **View Device Code & Configure Wi-Fi**:
   - The captive setup portal opens automatically (or visit `http://192.168.4.1`).
   - The top card displays the **Serial Number** (e.g. `DEV-XXXXXX`), **Claim Code / Device ID**, and **MAC Address**.
   - Click the **"📋 Copy Serial & Claim Code"** button to copy both details to your clipboard.
   - Select your company/plant Wi-Fi network from the scanned list, enter the password, and click **Save & Connect Device**.
   - *(Optional)* In the **Server Settings** dropdown, verify or update the MQTT Broker URI if running on a custom LAN IP.
3. **Claim in Web Dashboard**:
   - Log in to the web dashboard (`http://localhost` or your server domain) as an Admin.
   - Go to **Devices** &rarr; click **Claim Device**.
   - Paste the **Serial Number** and **Claim Code** copied from the setup page and click **OK**.
   - Bind the device to any reactor (`Equipment`) to begin recording real-time telemetry!

## Security Notes

- All MQTT traffic uses mTLS (mutual TLS) — both broker and device authenticate
- Backend uses Helmet, CORS, JWT auth with refresh tokens, and MFA (TOTP)
- PostgreSQL uses Row-Level Security (RLS) for multi-tenant data isolation
- Passwords hashed with Argon2
