#pragma once
#include <stdint.h>

#define FW_VERSION        "0.1.0-m1"
#define ENABLE_AUDIO      0      // set 1 after the ES8311 bench check (audio.h)

// Acquisition (RMP-TDD-001 8.1)
constexpr uint32_t SAMPLE_PERIOD_MS      = 1000;
constexpr uint32_t IDLE_STORE_INTERVAL_S = 10;   // idle stretching (7.6)
constexpr uint8_t  BATCH_N               = 10;
constexpr uint8_t  BACKLOG_N             = 50;
constexpr uint32_t LIVE_BATCH_MAX_WAIT_MS = 10000;

// MQTT / ack / failover (8.2, 8.4)
constexpr uint32_t ACK_TIMEOUT_MS        = 15000;
constexpr uint32_t HEARTBEAT_MS          = 30000;
constexpr uint32_t FAILOVER_NO_ACK_MS    = 15000;
constexpr uint32_t FAILBACK_HEALTHY_MS   = 60000;
constexpr uint32_t FAILBACK_BLOCK_MS     = 300000;  // stop flapping after a health failover
constexpr uint32_t FAILOVER_MIN_SPACING_MS = 60000; // never health-switch links more often than this
constexpr uint32_t ACK_TIMEOUT_MAX_MS    = 300000;  // resend back-off cap while the server is not acking at all

// Remote commands. The broker has no per-device ACL yet (integration guide, Known gap 1): any holder of a
// CA-signed cert could publish to this device's cmd/ topics, so credential-changing commands are off.
#define CMD_ALLOW_SET_NETWORK 0
#define CMD_ALLOW_REBOOT      1
constexpr bool     NET_PREFER_ETH        = true;    // policy network_priority = eth_then_wifi
constexpr int      ETH_PHY_ADDR          = -1;      // auto-detect the IP101 address (core's EV variant uses 1)

// Time (7.5)
constexpr uint32_t RTC_MAX_UNSYNCED_H    = 24;

// PT100 chain (7.5)
constexpr float    RTD_R0                = 100.0f;
constexpr float    RTD_RREF              = 400.0f;  // must equal the fitted reference resistor
constexpr uint8_t  RTD_WIRES             = 3;       // 2, 3 or 4

// Heidolph RS232 (7.5)
constexpr uint32_t MOTOR_BAUD            = 9600;
constexpr uint32_t MOTOR_MIN_GAP_MS      = 120;
constexpr float    MOTOR_TQ_SCALE_NCM    = 1.0f;    // [VERIFY] per motor model

// DWIN (7.3) [VERIFY] baud + VP addresses against the DGUS project
constexpr uint32_t DWIN_BAUD             = 115200;
constexpr uint16_t VP_TEMP = 0x1000, VP_RPM = 0x1002, VP_TORQUE = 0x1004;
constexpr uint16_t VP_STATUS_TXT = 0x2000, VP_NET_TXT = 0x2020, VP_CLOCK_TXT = 0x2040;
constexpr uint16_t PAGE_BOOT = 0, PAGE_RUNNING = 1;
