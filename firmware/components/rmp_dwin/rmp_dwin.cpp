#include "rmp_dwin.h"
#include "rmp_pins.h"
#include "rmp_config.h"
#include <math.h>
#include <stdio.h>
#include <string.h>
#include "driver/uart.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "esp_log.h"

namespace rmp {

namespace {
constexpr char kTag[] = "rmp_dwin";
constexpr uart_port_t kUart = UART_NUM_1;
}  // namespace

void Dwin::begin() {
  if (!mutex_) {
    mutex_ = xSemaphoreCreateMutex();
  }

  uart_config_t cfg = {};
  cfg.baud_rate = DWIN_BAUD;
  cfg.data_bits = UART_DATA_8_BITS;
  cfg.parity = UART_PARITY_DISABLE;
  cfg.stop_bits = UART_STOP_BITS_1;
  cfg.flow_ctrl = UART_HW_FLOWCTRL_DISABLE;
  cfg.source_clk = UART_SCLK_DEFAULT;

  uart_driver_install(kUart, 512, 512, 0, nullptr, 0);
  uart_param_config(kUart, &cfg);
  uart_set_pin(kUart, PIN_DWIN_TX, PIN_DWIN_RX, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE);

  ESP_LOGI(kTag, "DWIN UART initialized at %d baud (TX=%d, RX=%d)", DWIN_BAUD, PIN_DWIN_TX, PIN_DWIN_RX);
}

void Dwin::lock() {
  if (mutex_) xSemaphoreTake((SemaphoreHandle_t)mutex_, portMAX_DELAY);
}

void Dwin::unlock() {
  if (mutex_) xSemaphoreGive((SemaphoreHandle_t)mutex_);
}

void Dwin::sendRaw(const uint8_t *data, size_t len) {
  lock();
  uart_write_bytes(kUart, data, len);
  unlock();
  // Small delay to ensure inter-frame spacing >= 5ms (Section 4.7)
  vTaskDelay(pdMS_TO_TICKS(5));
}

void Dwin::pollRx() {
  size_t available = 0;
  uart_get_buffered_data_len(kUart, &available);
  if (available > 0) {
    uint8_t buf[64];
    int read = uart_read_bytes(kUart, buf, sizeof(buf), 0);
    if (read >= 7 && buf[0] == 0x5A && buf[1] == 0xA5) {
      // 5A A5 06 83 00 14 01 00 <page>
      if (buf[3] == 0x83 && buf[4] == 0x00 && buf[5] == 0x14) {
        current_page_ = buf[8];
        ESP_LOGD(kTag, "Read current page confirmed: %d", current_page_);
      }
    }
  }
}

void Dwin::readPageRequest() {
  uint8_t f[] = {0x5A, 0xA5, 0x04, 0x83, 0x00, 0x14, 0x01};
  sendRaw(f, sizeof(f));
}

void Dwin::setPage(uint8_t page) {
  current_page_ = page;
  // 5A A5 07 82 00 84 5A 01 00 <page>
  uint8_t f[] = {0x5A, 0xA5, 0x07, 0x82, 0x00, 0x84, 0x5A, 0x01, 0x00, page};
  sendRaw(f, sizeof(f));
  ESP_LOGI(kTag, "Switched to page %d", page);
}

void Dwin::writeValue(uint16_t vp, uint16_t v) {
  // 5A A5 05 82 <vp_hi> <vp_lo> <val_hi> <val_lo>
  uint8_t f[] = {
    0x5A, 0xA5, 0x05, 0x82,
    (uint8_t)(vp >> 8), (uint8_t)(vp & 0xFF),
    (uint8_t)(v >> 8), (uint8_t)(v & 0xFF)
  };
  sendRaw(f, sizeof(f));
}

void Dwin::writeText(uint16_t vp, const char *s, size_t maxChars) {
  if (!s) s = "";
  uint8_t f[128];
  size_t n = 0;
  f[n++] = 0x5A;
  f[n++] = 0xA5;
  f[n++] = 0; // length placeholder (index 2)
  f[n++] = 0x82;
  f[n++] = (uint8_t)(vp >> 8);
  f[n++] = (uint8_t)(vp & 0xFF);

  // Copy ASCII characters into the frame (data payload starts at byte 6)
  size_t char_count = 0;
  for (size_t i = 0; s[i] != '\0' && i < maxChars && n < sizeof(f) - 4; ++i) {
    char c = s[i];
    // ASCII printable range only (0x20-0x7E); anything else becomes a space
    f[n++] = (c >= 0x20 && c <= 0x7E) ? (uint8_t)c : (uint8_t)' ';
    char_count++;
  }

  // DGUS II VP memory is 16-bit word addressed.
  // The 0xFFFF string terminator MUST land on an even byte offset inside the
  // VP data region (i.e. the number of character bytes must be even).
  // If we have written an odd number of character bytes, pad with 0x00 so that
  // the two 0xFF bytes below form a properly-aligned 16-bit word 0xFFFF.
  if (char_count & 1u) {
    f[n++] = 0x00; // alignment pad
  }

  // 16-bit end-of-string marker (Section 4.2)
  f[n++] = 0xFF;
  f[n++] = 0xFF;

  // Length field = number of bytes that follow the length byte (i.e. n - 3)
  f[2] = (uint8_t)(n - 3);

  sendRaw(f, n);
}

void Dwin::writePowerUpDefaults() {
  // Power-up values from Section 6.2 & 6.3
  writeValue(VP_CONN_PILL, 1);       // 1 = OFFLINE (red)
  writeValue(VP_TEMP_QUAL_DOT, 3);   // 3 = off
  writeValue(VP_TEMP_QUAL_PILL, 2);  // 2 = BAD
  writeValue(VP_RUN_FOOTER, 0);      // 0 = hint
  writeValue(VP_ALARM_FLASH, 0);     // 0 = bright
  writeValue(VP_MUTE_BUTTON, 0);     // 0 = SILENCE
  writeValue(VP_AUDIT_STATE, 0);     // 0 = saving

  writeValue(VP_DOT_SSID, 3);
  writeValue(VP_DOT_IP, 3);
  writeValue(VP_DOT_MQTT, 3);
  writeValue(VP_DOT_MTLS, 3);
  writeValue(VP_DOT_NTP, 3);
  writeValue(VP_DOT_RTD, 3);
  writeValue(VP_DOT_RS232, 3);
  writeValue(VP_DOT_FLASH, 3);
  writeValue(VP_DOT_MAC, 3);

  writeValue(VP_BOOT_PROGRESS, 0);
  writeValue(VP_TORQUE_LOAD_BAR, 0);
}

void Dwin::showBootPage(uint8_t progress, const char *fwVersion) {
  if (fwVersion) writeText(VP_FW_VERSION, fwVersion, 16);
  if (progress > 100) progress = 100;
  writeValue(VP_BOOT_PROGRESS, progress);
}

void Dwin::showIdlePage(const char *reactorTitle, const char *labName, const char *clockStr,
                        bool online, uint16_t qualDot, float t, float t_raw, bool t_ok,
                        float rpm, float tq, bool motor_ok, const char *calTag) {
  if (reactorTitle) writeText(VP_REACTOR_TITLE, reactorTitle, 16);
  if (labName) writeText(VP_LAB_NAME, labName, 15);
  if (clockStr) writeText(VP_CLOCK, clockStr, 5);
  writeValue(VP_CONN_PILL, online ? 0 : 1);
  writeValue(VP_TEMP_QUAL_DOT, qualDot <= 3 ? qualDot : 3);
  if (calTag) writeText(VP_CAL_TAG, calTag, 8);

  // Temperature (1 decimal, no unit, max 5 chars or "---")
  if (t_ok && isfinite(t)) {
    char buf[16];
    snprintf(buf, sizeof(buf), "%.1f", t);
    writeText(VP_TEMP_VALUE, buf, 5);
  } else {
    writeText(VP_TEMP_VALUE, "---", 5);
  }

  // Raw temperature (e.g. "Raw 24.9 C")
  if (isfinite(t_raw)) {
    char buf[20];
    snprintf(buf, sizeof(buf), "Raw %.1f C", t_raw);
    writeText(VP_TEMP_RAW, buf, 15);
  } else {
    writeText(VP_TEMP_RAW, "Raw ---", 15);
  }

  // RPM and Torque
  if (motor_ok && isfinite(rpm)) {
    char buf[16];
    snprintf(buf, sizeof(buf), "%d", (int)lroundf(rpm));
    writeText(VP_RPM_VALUE, buf, 4);
  } else {
    writeText(VP_RPM_VALUE, "---", 4);
  }

  if (motor_ok && isfinite(tq)) {
    char buf[16];
    snprintf(buf, sizeof(buf), "%.1f", tq);
    writeText(VP_TORQUE_VALUE, buf, 5);
  } else {
    writeText(VP_TORQUE_VALUE, "---", 5);
  }
}

void Dwin::showUnboundPage(const char *uuid, const char *mac, const char *ip, const char *broker) {
  if (uuid) writeText(VP_DEVICE_UUID, uuid, 24);
  if (mac) writeText(VP_MAC_ADDRESS, mac, 17);
  if (ip) writeText(VP_IP_ADDRESS, ip, 16);
  if (broker) writeText(VP_MQTT_BROKER, broker, 19);
}

void Dwin::showAssignmentPage(const char *analyst, const char *scopeTag, const char *processName) {
  if (analyst) writeText(VP_ANALYST_NAME, analyst, 17);
  if (scopeTag) writeText(VP_SCOPE_TAG, scopeTag, 25);
  if (processName) writeText(VP_PROCESS_NAME, processName, 25);
}

void Dwin::showPreStartPage(const char *processName, float maxTemp, float maxSpeed, float maxRoc) {
  if (processName) writeText(VP_PROCESS_NAME, processName, 25);

  char buf[16];
  if (isfinite(maxTemp)) snprintf(buf, sizeof(buf), "%.1f", maxTemp); else snprintf(buf, sizeof(buf), "---");
  writeText(VP_MAX_TEMP, buf, 8);

  if (isfinite(maxSpeed)) snprintf(buf, sizeof(buf), "%d", (int)lroundf(maxSpeed)); else snprintf(buf, sizeof(buf), "---");
  writeText(VP_MAX_SPEED, buf, 8);

  if (isfinite(maxRoc)) snprintf(buf, sizeof(buf), "%+.1f", maxRoc); else snprintf(buf, sizeof(buf), "---");
  writeText(VP_MAX_ROC, buf, 8);
}

void Dwin::showRunningPage(const char *reactorTitle, const char *clockStr, bool online,
                           uint16_t qualPill, float t, float t_raw, bool t_ok,
                           float rpm, float rpmSet, float tq, uint8_t torquePercent, bool motor_ok,
                           float trendRate, const char *batchTag, const char *durationStr,
                           uint8_t faultCode, bool silenced, const char *calTag) {
  if (reactorTitle) writeText(VP_REACTOR_TITLE, reactorTitle, 16);
  if (clockStr) writeText(VP_CLOCK, clockStr, 5);
  writeValue(VP_CONN_PILL, online ? 0 : 1);
  writeValue(VP_TEMP_QUAL_PILL, qualPill <= 2 ? qualPill : 2);
  if (calTag) writeText(VP_CAL_TAG, calTag, 8);

  // Temperature
  if (t_ok && isfinite(t)) {
    char buf[16];
    snprintf(buf, sizeof(buf), "%.1f", t);
    writeText(VP_TEMP_VALUE, buf, 5);
  } else {
    writeText(VP_TEMP_VALUE, "---", 5);
  }

  // Raw temperature
  if (isfinite(t_raw)) {
    char buf[20];
    snprintf(buf, sizeof(buf), "Raw %.1f C", t_raw);
    writeText(VP_TEMP_RAW, buf, 15);
  } else {
    writeText(VP_TEMP_RAW, "Raw ---", 15);
  }

  // RPM and Setpoint
  if (motor_ok && isfinite(rpm)) {
    char buf[16];
    snprintf(buf, sizeof(buf), "%d", (int)lroundf(rpm));
    writeText(VP_RPM_VALUE, buf, 4);
  } else {
    writeText(VP_RPM_VALUE, "---", 4);
  }

  if (motor_ok && isfinite(rpmSet)) {
    char buf[16];
    snprintf(buf, sizeof(buf), "Set:%d", (int)lroundf(rpmSet));
    writeText(VP_RPM_SET, buf, 8);
  }

  // Torque and Progress Bar
  if (motor_ok && isfinite(tq)) {
    char buf[16];
    snprintf(buf, sizeof(buf), "%.1f", tq);
    writeText(VP_TORQUE_VALUE, buf, 5);
  } else {
    writeText(VP_TORQUE_VALUE, "---", 5);
  }
  if (torquePercent > 100) torquePercent = 100;
  writeValue(VP_TORQUE_LOAD_BAR, torquePercent);

  // Trend rate: always signed (+0.4, -1.2)
  if (isfinite(trendRate)) {
    char buf[16];
    snprintf(buf, sizeof(buf), "%+.1f", trendRate);
    writeText(VP_TREND_RATE, buf, 6);
  }

  // Batch tag and duration
  if (batchTag) writeText(VP_BATCH_TAG, batchTag, 12);
  if (durationStr) writeText(VP_DURATION, durationStr, 8);

  // Fault code
  char fault_buf[16];
  snprintf(fault_buf, sizeof(fault_buf), "%u", (unsigned)faultCode);
  writeText(VP_FAULT_CODE, fault_buf, 4);

  // Footer: 0 = hint, 1 = silenced
  writeValue(VP_RUN_FOOTER, silenced ? 1 : 0);
}

void Dwin::showAlarmPage(const char *paramStr, float alarmRate, float alarmLimit, float currentTemp,
                         bool muted, bool headerFlashDim) {
  if (paramStr) writeText(VP_ALARM_PARAM, paramStr, 26);

  char buf[16];
  if (isfinite(alarmRate)) snprintf(buf, sizeof(buf), "%+.1f", alarmRate); else snprintf(buf, sizeof(buf), "---");
  writeText(VP_ALARM_RATE, buf, 6);

  if (isfinite(alarmLimit)) snprintf(buf, sizeof(buf), "%+.1f", alarmLimit); else snprintf(buf, sizeof(buf), "---");
  writeText(VP_ALARM_LIMIT, buf, 6);

  if (isfinite(currentTemp)) snprintf(buf, sizeof(buf), "%.1f", currentTemp); else snprintf(buf, sizeof(buf), "---");
  writeText(VP_ALARM_TEMP, buf, 6);

  writeValue(VP_MUTE_BUTTON, muted ? 1 : 0);
  writeValue(VP_ALARM_FLASH, headerFlashDim ? 1 : 0);
}

void Dwin::showBatchCompletedPage(const char *processName, const char *totalDuration, float finalTemp,
                                  uint32_t samplesLogged, bool stored) {
  if (processName) writeText(VP_PROCESS_NAME, processName, 25);
  if (totalDuration) writeText(VP_TOTAL_DURATION, totalDuration, 8);

  if (isfinite(finalTemp)) {
    char buf[16];
    snprintf(buf, sizeof(buf), "%.1f", finalTemp);
    writeText(VP_FINAL_TEMP, buf, 8);
  } else {
    writeText(VP_FINAL_TEMP, "---", 8);
  }

  char smp_buf[16];
  snprintf(smp_buf, sizeof(smp_buf), "%lu", (unsigned long)samplesLogged);
  writeText(VP_SAMPLES_LOGGED, smp_buf, 8);

  writeValue(VP_AUDIT_STATE, stored ? 1 : 0);
}

void Dwin::showDiagnosticsPage(const char *ssid, DotStatus dotSsid,
                               const char *ip, DotStatus dotIp,
                               const char *mqtt, DotStatus dotMqtt,
                               const char *mtls, DotStatus dotMtls,
                               const char *ntp, DotStatus dotNtp,
                               const char *rtd, DotStatus dotRtd,
                               const char *rs232, DotStatus dotRs232,
                               const char *flash, DotStatus dotFlash,
                               const char *mac, DotStatus dotMac) {
  if (ssid) writeText(VP_SSID, ssid, 16);
  writeValue(VP_DOT_SSID, dotSsid);

  if (ip) writeText(VP_IP_ADDRESS, ip, 16);
  writeValue(VP_DOT_IP, dotIp);

  if (mqtt) writeText(VP_MQTT_BROKER, mqtt, 19);
  writeValue(VP_DOT_MQTT, dotMqtt);

  if (mtls) writeText(VP_MTLS_STATUS, mtls, 19);
  writeValue(VP_DOT_MTLS, dotMtls);

  if (ntp) writeText(VP_NTP_STATUS, ntp, 19);
  writeValue(VP_DOT_NTP, dotNtp);

  if (rtd) writeText(VP_RTD_STATUS, rtd, 19);
  writeValue(VP_DOT_RTD, dotRtd);

  if (rs232) writeText(VP_RS232_STATUS, rs232, 19);
  writeValue(VP_DOT_RS232, dotRs232);

  if (flash) writeText(VP_FLASH_STATUS, flash, 19);
  writeValue(VP_DOT_FLASH, dotFlash);

  if (mac) writeText(VP_MAC_ADDRESS, mac, 17);
  writeValue(VP_DOT_MAC, dotMac);
}

}  // namespace rmp
