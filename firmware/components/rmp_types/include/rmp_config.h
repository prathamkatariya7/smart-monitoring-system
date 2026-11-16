#pragma once
// Shared tunable constants (SPEC.md section 10 rule 8: "keep one constants header for
// every tunable value, so none is buried in code"). Ported from the Arduino prototype's
// config.h; grows as later milestones add network/MQTT/time constants.
#include <stdint.h>

#define FW_VERSION "0.1.0-idf-m1"

// Acquisition (added in M2 with the sampler/ring; kept here so the single header is complete)
constexpr uint32_t SAMPLE_PERIOD_MS = 1000;
constexpr uint32_t IDLE_STORE_INTERVAL_S = 10;
constexpr uint8_t  BATCH_N = 10;
constexpr uint8_t  BACKLOG_N = 50;
constexpr uint32_t LIVE_BATCH_MAX_WAIT_MS = 10000;

// MQTT / ack / failover (M3)
constexpr uint32_t ACK_TIMEOUT_MS = 15000;
constexpr uint32_t HEARTBEAT_MS = 30000;
constexpr uint32_t FAILOVER_NO_ACK_MS = 15000;
constexpr uint32_t FAILBACK_HEALTHY_MS = 60000;
constexpr uint32_t FAILBACK_BLOCK_MS = 300000;
constexpr uint32_t FAILOVER_MIN_SPACING_MS = 60000;
constexpr uint32_t ACK_TIMEOUT_MAX_MS = 300000;

// Remote commands (M4). The broker has no per-device ACL yet (integration guide, Known
// gap 1): any holder of a CA-signed cert could publish to this device's cmd/ topics, so
// credential-changing commands are off.
#define CMD_ALLOW_SET_NETWORK 0
#define CMD_ALLOW_REBOOT      1
constexpr bool NET_PREFER_ETH = false;  // [CONFIRMED by owner 2026-11-10] Wi-Fi is PRIMARY, Ethernet
                                         // is FALLBACK (SPEC.md section 1/5; overrides the TDD default).
                                         // Most clients only have Wi-Fi connectivity -- do not flip this.
                                         // NOTE: the full dual-interface failover state machine that reads
                                         // this flag (SPEC.md section 5, milestone M3) is not built yet --
                                         // Ethernet hardware hasn't been wired/tested on this unit. Today's
                                         // firmware is Wi-Fi-only (rmp_net/rmp_prov); this constant is here
                                         // so the decision is locked in before that work starts.
constexpr int  ETH_PHY_ADDR = -1;       // auto-detect

// Wi-Fi provisioning (captive-portal, rmp_prov) -- one tunable, kept here with the
// other protocol timing constants. See rmp_bench_defaults.h for the dev-only SSID/
// broker/device-id defaults that get superseded by NVS values once provisioned.
constexpr uint32_t WIFI_PROV_RETRY_WINDOW_MS = 120000;  // 2 min of backoff retries on a
                                                         // known network before re-entering
                                                         // SoftAP provisioning mode.

// Time (M2)
constexpr uint32_t RTC_MAX_UNSYNCED_H = 24;

// PT100 chain (M1)
constexpr float   RTD_R0 = 100.0f;
constexpr float   RTD_RREF = 430.0f;  // [CONFIRMED by owner 2026-11-09] -- NOT the Arduino prototype's 400 default.
constexpr uint8_t RTD_WIRES = 2;      // [CONFIRMED by owner 2026-11-09] -- 2-wire PT100 connection on the robu.in MAX31865 module.

// Heidolph RS232 (M1)
constexpr uint32_t MOTOR_BAUD = 9600;
constexpr uint32_t MOTOR_MIN_GAP_MS = 120;
constexpr float    MOTOR_TQ_SCALE_NCM = 1.0f;  // [VERIFY] per motor model -- bench-confirm with the console `motor` command

// DWIN (M1) -- [VERIFY] baud + VP addresses against the DGUS project; these are the
// Arduino prototype's placeholder values, not yet bench-confirmed.
constexpr uint32_t DWIN_BAUD = 115200;
constexpr uint16_t VP_TEMP = 0x1000, VP_RPM = 0x1002, VP_TORQUE = 0x1004;
constexpr uint16_t VP_STATUS_TXT = 0x2000, VP_NET_TXT = 0x2020, VP_CLOCK_TXT = 0x2040;
constexpr uint16_t PAGE_BOOT = 0, PAGE_RUNNING = 1;

