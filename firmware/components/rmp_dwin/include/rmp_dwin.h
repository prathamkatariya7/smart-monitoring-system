#pragma once
/**
 * Borosil RMP: DWIN T5L DGUS II Display Driver (UART 115200 8N1)
 * Conforms to Specification Version 1.0 (15 Nov 2026).
 *
 * Frame Format:
 *   5A A5 <len> <cmd> <addr_hi> <addr_lo> <data...>
 *
 * Text Variables end with FF FF.
 * Multi-byte values are Big-Endian.
 * Progress bars: 0-100 (%).
 */

#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>

namespace rmp {

// --- Display Pages (0 to 9) ---
constexpr uint8_t DWIN_PAGE_BOOT        = 0;  // 0x0000: Boot / POST
constexpr uint8_t DWIN_PAGE_IDLE        = 1;  // 0x0001: Idle standby
constexpr uint8_t DWIN_PAGE_WIFI_SETUP  = 2;  // 0x0002: SoftAP Wi-Fi setup
constexpr uint8_t DWIN_PAGE_UNBOUND     = 3;  // 0x0003: Device unbound
constexpr uint8_t DWIN_PAGE_ASSIGNMENT  = 4;  // 0x0010: Process assignment
constexpr uint8_t DWIN_PAGE_PRESTART    = 5;  // 0x0011: Pre-start checklist
constexpr uint8_t DWIN_PAGE_RUNNING     = 6;  // 0x0012: Running dashboard
constexpr uint8_t DWIN_PAGE_ALARM       = 7;  // 0x0013: Critical alarm
constexpr uint8_t DWIN_PAGE_COMPLETED   = 8;  // 0x0014: Batch completed
constexpr uint8_t DWIN_PAGE_DIAGNOSTICS = 9;  // 0x0020: System diagnostics

// --- Text Variable VPs ---
constexpr uint16_t VP_FW_VERSION      = 0x1060; // Page 0: max 16 chars
constexpr uint16_t VP_TEMP_VALUE      = 0x1100; // Page 1, 6: max 5 chars (R)
constexpr uint16_t VP_TEMP_RAW        = 0x1110; // Page 1, 6: max 15 chars (L)
constexpr uint16_t VP_CAL_TAG         = 0x1120; // Page 1, 6: max 8 chars (R)
constexpr uint16_t VP_RPM_VALUE       = 0x1130; // Page 1, 6: max 4 chars (L)
constexpr uint16_t VP_TORQUE_VALUE    = 0x1140; // Page 1, 6: max 5 chars (L)
constexpr uint16_t VP_RPM_SET         = 0x1150; // Page 6: max 8 chars (L)
constexpr uint16_t VP_FAULT_CODE      = 0x1160; // Page 6: max 4 chars (L)
constexpr uint16_t VP_ALARM_RATE      = 0x1170; // Page 7: max 6 chars (R)
constexpr uint16_t VP_ALARM_PARAM     = 0x1180; // Page 7: max 26 chars (L)
constexpr uint16_t VP_ALARM_TEMP      = 0x1190; // Page 7: max 6 chars (R)
constexpr uint16_t VP_ALARM_LIMIT     = 0x11A0; // Page 7: max 6 chars (R)
constexpr uint16_t VP_TREND_RATE      = 0x11B0; // Page 6: max 6 chars (R)
constexpr uint16_t VP_DURATION        = 0x11C0; // Page 6: max 8 chars (L)
constexpr uint16_t VP_BATCH_TAG       = 0x11D0; // Page 6: max 12 chars (L)
constexpr uint16_t VP_REACTOR_TITLE   = 0x2000; // Page 1, 6: max 16 chars (L)
constexpr uint16_t VP_LAB_NAME        = 0x2020; // Page 1: max 15 chars (L)
constexpr uint16_t VP_CLOCK           = 0x2040; // Page 1, 6: max 5 chars (R)
constexpr uint16_t VP_DEVICE_UUID     = 0x2050; // Page 3: max 24 chars (L)
constexpr uint16_t VP_ANALYST_NAME    = 0x3000; // Page 4: max 17 chars (L)
constexpr uint16_t VP_PROCESS_NAME    = 0x3020; // Page 4, 5, 8: max 25 chars (L)
constexpr uint16_t VP_SCOPE_TAG       = 0x3070; // Page 4: max 25 chars (L)
constexpr uint16_t VP_MAX_TEMP        = 0x3080; // Page 5: max 8 chars (R)
constexpr uint16_t VP_MAX_SPEED       = 0x3090; // Page 5: max 8 chars (R)
constexpr uint16_t VP_MAX_ROC         = 0x30A0; // Page 5: max 8 chars (R)
constexpr uint16_t VP_TOTAL_DURATION  = 0x3100; // Page 8: max 8 chars (R)
constexpr uint16_t VP_FINAL_TEMP      = 0x3110; // Page 8: max 8 chars (R)
constexpr uint16_t VP_SAMPLES_LOGGED  = 0x3120; // Page 8: max 8 chars (R)
constexpr uint16_t VP_SSID            = 0x3200; // Page 9: max 16 chars (R)
constexpr uint16_t VP_IP_ADDRESS      = 0x3210; // Page 3, 9: max 16 chars
constexpr uint16_t VP_MQTT_BROKER     = 0x3220; // Page 3, 9: max 19 chars
constexpr uint16_t VP_MTLS_STATUS     = 0x3230; // Page 9: max 19 chars (R)
constexpr uint16_t VP_NTP_STATUS      = 0x3240; // Page 9: max 19 chars (R)
constexpr uint16_t VP_RTD_STATUS      = 0x3250; // Page 9: max 19 chars (R)
constexpr uint16_t VP_RS232_STATUS    = 0x3260; // Page 9: max 19 chars (R)
constexpr uint16_t VP_FLASH_STATUS    = 0x3270; // Page 9: max 19 chars (R)
constexpr uint16_t VP_MAC_ADDRESS     = 0x3280; // Page 3, 9: max 17 chars

// --- Icon Variable VPs (16-bit values) ---
constexpr uint16_t VP_CONN_PILL       = 0x2018; // 0=ONLINE, 1=OFFLINE
constexpr uint16_t VP_TEMP_QUAL_DOT   = 0x1300; // 0=good, 1=suspect, 2=bad, 3=off
constexpr uint16_t VP_TEMP_QUAL_PILL  = 0x1301; // 0=GOOD, 1=SUSPECT, 2=BAD
constexpr uint16_t VP_RUN_FOOTER      = 0x1307; // 0=hint, 1=silenced
constexpr uint16_t VP_ALARM_FLASH     = 0x1308; // 0=bright, 1=dim
constexpr uint16_t VP_MUTE_BUTTON     = 0x1309; // 0=SILENCE, 1=SILENCED
constexpr uint16_t VP_AUDIT_STATE     = 0x130A; // 0=saving, 1=stored
constexpr uint16_t VP_DOT_SSID        = 0x1310; // Dot 0..3
constexpr uint16_t VP_DOT_IP          = 0x1311;
constexpr uint16_t VP_DOT_MQTT        = 0x1312;
constexpr uint16_t VP_DOT_MTLS        = 0x1313;
constexpr uint16_t VP_DOT_NTP         = 0x1314;
constexpr uint16_t VP_DOT_RTD         = 0x1315;
constexpr uint16_t VP_DOT_RS232       = 0x1316;
constexpr uint16_t VP_DOT_FLASH       = 0x1317;
constexpr uint16_t VP_DOT_MAC         = 0x1318;

// --- Progress Bar VPs (0 to 100 %) ---
constexpr uint16_t VP_BOOT_PROGRESS   = 0x1306;
constexpr uint16_t VP_TORQUE_LOAD_BAR = 0x1305;

enum DotStatus : uint16_t {
  DOT_GOOD    = 0,
  DOT_SUSPECT = 1,
  DOT_BAD     = 2,
  DOT_OFF     = 3
};

class Dwin {
 public:
  void begin();

  // Basic frame primitives (thread-safe)
  void setPage(uint8_t page);
  uint8_t currentPage() const { return current_page_; }
  void readPageRequest();
  void pollRx();

  void writeText(uint16_t vp, const char *s, size_t maxChars = 32);
  void writeValue(uint16_t vp, uint16_t v);
  void writePowerUpDefaults();
  void sendRaw(const uint8_t *data, size_t len);

  // Page-specific helpers (Section 8)
  void showBootPage(uint8_t progress, const char *fwVersion);
  void showIdlePage(const char *reactorTitle, const char *labName, const char *clockStr,
                    bool online, uint16_t qualDot, float t, float t_raw, bool t_ok,
                    float rpm, float tq, bool motor_ok, const char *calTag = "Cal v1");
  void showUnboundPage(const char *uuid, const char *mac, const char *ip, const char *broker);
  void showAssignmentPage(const char *analyst, const char *scopeTag, const char *processName);
  void showPreStartPage(const char *processName, float maxTemp, float maxSpeed, float maxRoc);
  void showRunningPage(const char *reactorTitle, const char *clockStr, bool online,
                       uint16_t qualPill, float t, float t_raw, bool t_ok,
                       float rpm, float rpmSet, float tq, uint8_t torquePercent, bool motor_ok,
                       float trendRate, const char *batchTag, const char *durationStr,
                       uint8_t faultCode, bool silenced, const char *calTag = "Cal v1");
  void showAlarmPage(const char *paramStr, float alarmRate, float alarmLimit, float currentTemp,
                     bool muted, bool headerFlashDim);
  void showBatchCompletedPage(const char *processName, const char *totalDuration, float finalTemp,
                              uint32_t samplesLogged, bool stored);
  void showDiagnosticsPage(const char *ssid, DotStatus dotSsid,
                           const char *ip, DotStatus dotIp,
                           const char *mqtt, DotStatus dotMqtt,
                           const char *mtls, DotStatus dotMtls,
                           const char *ntp, DotStatus dotNtp,
                           const char *rtd, DotStatus dotRtd,
                           const char *rs232, DotStatus dotRs232,
                           const char *flash, DotStatus dotFlash,
                           const char *mac, DotStatus dotMac);

 private:
  uint8_t current_page_ = DWIN_PAGE_BOOT;
  void *mutex_ = nullptr;
  void lock();
  void unlock();
};

}  // namespace rmp
