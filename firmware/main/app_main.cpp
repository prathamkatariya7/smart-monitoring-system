#include "cJSON.h"
#include "driver/gpio.h"
#include "driver/uart.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "esp_mac.h"
#include "esp_vfs_dev.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "nvs.h"
#include "nvs_flash.h"
#include <inttypes.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "rmp_audio.h"
#include "rmp_buttons.h"
#include "rmp_config.h"
#include "rmp_dwin.h"
#include "rmp_motor.h"
#include "rmp_mqtt.h"
#include "rmp_net.h"
#include "rmp_pins.h"
#include "rmp_prov.h"
#include "rmp_ring.h"
#include "rmp_rtd.h"
#include "rmp_time.h"

using namespace rmp;

// Embedded dev mTLS certs (main/certs/, EMBED_TXTFILES in main/CMakeLists.txt).
extern const uint8_t ca_crt_start[] asm("_binary_ca_crt_start");
extern const uint8_t ca_crt_end[] asm("_binary_ca_crt_end");
extern const uint8_t device_crt_start[] asm("_binary_device_crt_start");
extern const uint8_t device_crt_end[] asm("_binary_device_crt_end");
extern const uint8_t device_key_start[] asm("_binary_device_key_start");
extern const uint8_t device_key_end[] asm("_binary_device_key_end");

static const char *TAG = "rmp_fw";

// Core singletons
static rmp::Rtd g_rtd;
static rmp::HeiMotor g_motor;
static rmp::Dwin g_dwin;
static rmp::Buttons g_buttons;
static rmp::Net g_net;
static rmp::Mqtt g_mqtt;
static rmp::Audio g_audio;
static rmp::RingStore g_ring;
static rmp::TimeSync g_time;

static bool g_rtd_ok = false;
static bool g_audio_ok = false;
static bool g_bound = false;
static bool g_decommissioned = false;
static volatile rmp::AlertLevel g_alert_level = rmp::AlertLevel::kOff;
static uint32_t g_boot = 1;

// HMI Flow State (matches Specification Section 5.1 & 5.2)
enum HmiScreen : uint8_t {
  SCREEN_BOOT = rmp::DWIN_PAGE_BOOT,              // Page 0
  SCREEN_IDLE = rmp::DWIN_PAGE_IDLE,              // Page 1
  SCREEN_WIFI_SETUP = rmp::DWIN_PAGE_WIFI_SETUP,  // Page 2
  SCREEN_UNBOUND = rmp::DWIN_PAGE_UNBOUND,        // Page 3
  SCREEN_ASSIGNMENT = rmp::DWIN_PAGE_ASSIGNMENT,  // Page 4
  SCREEN_PRESTART = rmp::DWIN_PAGE_PRESTART,      // Page 5
  SCREEN_RUNNING = rmp::DWIN_PAGE_RUNNING,        // Page 6
  SCREEN_ALARM = rmp::DWIN_PAGE_ALARM,            // Page 7
  SCREEN_COMPLETED = rmp::DWIN_PAGE_COMPLETED,    // Page 8
  SCREEN_DIAGNOSTICS = rmp::DWIN_PAGE_DIAGNOSTICS // Page 9
};

static volatile HmiScreen g_screen = SCREEN_BOOT;
static volatile HmiScreen s_prev_screen =
    SCREEN_IDLE; // For returning from Page 9

static char g_analyst_name[48] = "";
static char g_process_name[48] = "";
static char g_process_id[40] = "";
static char g_lab_name[32] = "Formulation Lab";
static char g_reactor_title[32] = "Reactor 101";
static char g_scope_tag[80] = "Formulation Lab | FL-101";

// Safety limits & Rate of Change
static float g_max_temp = 85.0f;
static float g_max_temp_roc = 5.0f; // °C/min
static float g_max_rpm = 600.0f;
static float g_max_rpm_roc = 150.0f; // RPM/min
static volatile bool g_alarm_silenced = false;
static float g_current_temp = NAN;
static float g_current_roc = 0.0f;
static int64_t g_attempt_start_ms = 0;
static uint32_t g_samples_logged = 0;

// Calibration correction parameters: T_cal = (T_raw * gain) + offset
static float g_cal_gain = 1.0f;
static float g_cal_offset = 0.0f;
static int g_cal_version = 1;
static bool s_alarm_sent = false;
static volatile bool g_dwin_paused = false;

struct SamplePoint {
  int64_t ts_ms;
  float t;
  float rpm;
};
static SamplePoint s_history[30];
static size_t s_hist_count = 0;

static void formatClock(char *out, size_t n) {
  if (g_time.state() == rmp::T_SYNCED) {
    int64_t ms = rmp::TimeSync::utcMs();
    time_t sec = (time_t)(ms / 1000);
    struct tm tm_buf;
    gmtime_r(&sec, &tm_buf);
    // Indian Standard Time (UTC+5:30) offset
    time_t ist_sec = sec + (5 * 3600 + 30 * 60);
    gmtime_r(&ist_sec, &tm_buf);
    snprintf(out, n, "%02d:%02d", tm_buf.tm_hour, tm_buf.tm_min);
  } else {
    snprintf(out, n, "--:--");
  }
}

static void formatDuration(int64_t duration_ms, char *out, size_t n) {
  if (duration_ms < 0)
    duration_ms = 0;
  uint32_t total_sec = (uint32_t)(duration_ms / 1000);
  uint32_t h = total_sec / 3600;
  uint32_t m = (total_sec % 3600) / 60;
  uint32_t s = total_sec % 60;
  snprintf(out, n, "%02u:%02u:%02u", (unsigned)h, (unsigned)m, (unsigned)s);
}

static void initConsoleUart() {
  uart_config_t cfg = {};
  cfg.baud_rate = 115200;
  cfg.data_bits = UART_DATA_8_BITS;
  cfg.parity = UART_PARITY_DISABLE;
  cfg.stop_bits = UART_STOP_BITS_1;
  cfg.flow_ctrl = UART_HW_FLOWCTRL_DISABLE;
  cfg.source_clk = UART_SCLK_DEFAULT;
  uart_driver_install(UART_NUM_0, 512, 0, 0, nullptr, 0);
  uart_param_config(UART_NUM_0, &cfg);
  esp_vfs_dev_uart_use_driver(UART_NUM_0);
}

static void onServerAckData(uint16_t boot, uint32_t upto_seq) {
  g_ring.onAck(boot, upto_seq);
}

static void onServerCfgDesired(const char *json_data, size_t len) {
  if (!json_data || len == 0)
    return;
  cJSON *root = cJSON_ParseWithLength(json_data, len);
  if (!root)
    return;

  cJSON *decom = cJSON_GetObjectItem(root, "decommissioned");
  cJSON *dev_status = cJSON_GetObjectItem(root, "status");
  bool is_decommissioned = (decom && cJSON_IsTrue(decom)) ||
                           (dev_status && cJSON_IsString(dev_status) &&
                            (strcmp(dev_status->valuestring, "DECOMMISSIONED") == 0 ||
                             strcmp(dev_status->valuestring, "UNREGISTERED") == 0));
  if (is_decommissioned) {
    ESP_LOGW("rmp_fw", "Device is DECOMMISSIONED/UNREGISTERED! Halting telemetry batches.");
    g_decommissioned = true;
    g_bound = false;
    char devid[40] = {0};
    rmp::Prov::getDeviceId(devid, sizeof devid);
    char ip_str[24] = {0};
    g_net.ipString(ip_str, sizeof ip_str);
    uint8_t mac[6] = {0};
    esp_efuse_mac_get_default(mac);
    char mac_str[18] = {0};
    snprintf(mac_str, sizeof mac_str, "%02X:%02X:%02X:%02X:%02X:%02X",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    g_screen = SCREEN_UNBOUND;
    g_dwin.showUnboundPage(devid, mac_str, ip_str, "DECOMMISSIONED (HALTED)");
    g_dwin.setPage(DWIN_PAGE_UNBOUND);
    cJSON_Delete(root);
    return;
  }
  g_decommissioned = false;

  cJSON *binding = cJSON_GetObjectItem(root, "binding");
  if (binding && !cJSON_IsNull(binding)) {
    bool was_unbound = !g_bound;
    g_bound = true;
    cJSON *r_no = cJSON_GetObjectItem(binding, "reactorNumber");
    if (r_no && cJSON_IsString(r_no)) {
      snprintf(g_reactor_title, sizeof(g_reactor_title), "Reactor %s",
               r_no->valuestring);
    }
    if (was_unbound || g_screen == SCREEN_UNBOUND || g_screen == SCREEN_WIFI_SETUP) {
      g_screen = SCREEN_IDLE;
      g_dwin.setPage(DWIN_PAGE_IDLE);
    }
  } else {
    // Device was UNBOUND from reactor by server!
    ESP_LOGI("rmp_fw", "Device unbound from reactor by server! Switching to Page 3 (UNBOUND)");
    g_bound = false;
    char devid[40] = {0};
    rmp::Prov::getDeviceId(devid, sizeof devid);
    char broker[96] = {0};
    rmp::Prov::getBrokerUri(broker, sizeof broker);
    char ip_str[24] = {0};
    g_net.ipString(ip_str, sizeof ip_str);
    uint8_t mac[6] = {0};
    esp_efuse_mac_get_default(mac);
    char mac_str[18] = {0};
    snprintf(mac_str, sizeof mac_str, "%02X:%02X:%02X:%02X:%02X:%02X",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    g_screen = SCREEN_UNBOUND;
    g_dwin.showUnboundPage(devid, mac_str, ip_str, broker);
    g_dwin.setPage(DWIN_PAGE_UNBOUND);
  }

  cJSON *lab = cJSON_GetObjectItem(root, "laboratoryName");
  if (lab && cJSON_IsString(lab)) {
    strncpy(g_lab_name, lab->valuestring, sizeof(g_lab_name) - 1);
  }

  snprintf(g_scope_tag, sizeof(g_scope_tag), "%s | %s", g_lab_name,
           g_reactor_title);

  cJSON *assign = cJSON_GetObjectItem(root, "assignment");
  if (assign && !cJSON_IsNull(assign)) {
    cJSON *p_id = cJSON_GetObjectItem(assign, "processId");
    cJSON *p_name = cJSON_GetObjectItem(assign, "processName");
    cJSON *o_name = cJSON_GetObjectItem(assign, "ownerName");
    cJSON *status = cJSON_GetObjectItem(assign, "status");

    if (p_id && cJSON_IsString(p_id))
      strncpy(g_process_id, p_id->valuestring, sizeof(g_process_id) - 1);
    if (p_name && cJSON_IsString(p_name))
      strncpy(g_process_name, p_name->valuestring, sizeof(g_process_name) - 1);
    if (o_name && cJSON_IsString(o_name))
      strncpy(g_analyst_name, o_name->valuestring, sizeof(g_analyst_name) - 1);

    cJSON *thr = cJSON_GetObjectItem(assign, "thresholds");
    if (thr && !cJSON_IsNull(thr)) {
      cJSON *t_obj = cJSON_GetObjectItem(thr, "temperature");
      if (t_obj) {
        cJSON *mx = cJSON_GetObjectItem(t_obj, "max");
        cJSON *roc = cJSON_GetObjectItem(t_obj, "rate_rise_max");
        if (mx && cJSON_IsNumber(mx))
          g_max_temp = (float)mx->valuedouble;
        if (roc && cJSON_IsNumber(roc))
          g_max_temp_roc = (float)roc->valuedouble;
      }
      cJSON *r_obj = cJSON_GetObjectItem(thr, "rpm");
      if (r_obj) {
        cJSON *mx = cJSON_GetObjectItem(r_obj, "max");
        cJSON *roc = cJSON_GetObjectItem(r_obj, "rate_rise_max");
        if (mx && cJSON_IsNumber(mx))
          g_max_rpm = (float)mx->valuedouble;
        if (roc && cJSON_IsNumber(roc))
          g_max_rpm_roc = (float)roc->valuedouble;
      }
    }

    if (status && cJSON_IsString(status)) {
      if (strcmp(status->valuestring, "SCHEDULED") == 0) {
        if (g_screen != SCREEN_RUNNING && g_screen != SCREEN_ALARM) {
          g_screen = SCREEN_ASSIGNMENT;
          g_dwin.showAssignmentPage(g_analyst_name, g_scope_tag,
                                    g_process_name);
          g_dwin.setPage(DWIN_PAGE_ASSIGNMENT);
        }
      } else if (strcmp(status->valuestring, "ACCEPTED") == 0) {
        if (g_screen == SCREEN_ASSIGNMENT) {
          g_screen = SCREEN_PRESTART;
          g_dwin.showPreStartPage(g_process_name, g_max_temp, g_max_rpm,
                                  g_max_temp_roc);
          g_dwin.setPage(DWIN_PAGE_PRESTART);
        }
      } else if (strcmp(status->valuestring, "RUNNING") == 0) {
        if (g_screen != SCREEN_RUNNING && g_screen != SCREEN_ALARM) {
          g_screen = SCREEN_RUNNING;
          g_dwin.setPage(DWIN_PAGE_RUNNING);
        }
      } else if (strcmp(status->valuestring, "COMPLETED") == 0) {
        if (g_screen == SCREEN_RUNNING) {
          g_screen = SCREEN_COMPLETED;
          char dur_str[16];
          int64_t dur_ms = (esp_timer_get_time() / 1000) - g_attempt_start_ms;
          formatDuration(dur_ms, dur_str, sizeof(dur_str));
          g_dwin.showBatchCompletedPage(g_process_name, dur_str, g_current_temp,
                                        g_samples_logged, true);
          g_dwin.setPage(DWIN_PAGE_COMPLETED);
        }
      } else if (strcmp(status->valuestring, "CANCELLED") == 0 ||
                 strcmp(status->valuestring, "ABORTED") == 0) {
        ESP_LOGI("rmp_fw", "Process was %s by server! Returning to SCREEN_IDLE", status->valuestring);
        g_process_id[0] = '\0';
        g_process_name[0] = '\0';
        if (g_bound && g_screen != SCREEN_ALARM) {
          g_screen = SCREEN_IDLE;
          g_dwin.setPage(DWIN_PAGE_IDLE);
        }
      }
    }
  } else {
    // No active assignment (process cancelled, completed, or none active)
    if (g_process_id[0] != '\0') {
      ESP_LOGI("rmp_fw", "No active process assigned. Returning to SCREEN_IDLE");
      g_process_id[0] = '\0';
      g_process_name[0] = '\0';
    }
    if (g_bound && (g_screen == SCREEN_ASSIGNMENT || g_screen == SCREEN_PRESTART ||
                    g_screen == SCREEN_RUNNING || g_screen == SCREEN_COMPLETED)) {
      g_screen = SCREEN_IDLE;
      g_dwin.setPage(DWIN_PAGE_IDLE);
    }
  }

  // Calibration update from server
  cJSON *cal = cJSON_GetObjectItem(root, "calibration");
  if (cal && !cJSON_IsNull(cal)) {
    cJSON *cv = cJSON_GetObjectItem(cal, "version");
    cJSON *coff = cJSON_GetObjectItem(cal, "offset");
    cJSON *cgn = cJSON_GetObjectItem(cal, "gain");
    if (cv && cJSON_IsNumber(cv))
      g_cal_version = cv->valueint;
    if (coff && cJSON_IsNumber(coff))
      g_cal_offset = (float)coff->valuedouble;
    if (cgn && cJSON_IsNumber(cgn))
      g_cal_gain = (float)cgn->valuedouble;
    ESP_LOGI(TAG, "Calibration updated: v%d, gain=%.4f, offset=%.2f",
             g_cal_version, g_cal_gain, g_cal_offset);
  }

  cJSON_Delete(root);
}

// HMI navigation state. Focus is intentionally firmware-owned; DGUS only renders
// the highlight and the visible diagnostics window from these registers.
static volatile uint8_t g_hmi_focus = 0;
static volatile uint8_t g_diag_window_top = 0;
static volatile uint8_t g_diag_focus = 0;

static void syncNavigationUi() {
  uint16_t assignment_state = (g_screen == SCREEN_ASSIGNMENT) ? 1 : 0;
  g_dwin.writeNavigationState(g_hmi_focus, g_diag_window_top, g_diag_focus,
                              assignment_state);
}

static void resetNavigationForScreen(HmiScreen screen) {
  g_hmi_focus = 0;
  if (screen == SCREEN_DIAGNOSTICS) {
    g_diag_window_top = 0;
    g_diag_focus = 0;
  }
  syncNavigationUi();
}

static void showScreen(HmiScreen screen) {
  g_screen = screen;
  g_dwin.setPage((uint8_t)screen);
  resetNavigationForScreen(screen);
}

static void returnFromDiagnostics() {
  HmiScreen parent = s_prev_screen;
  if (parent == SCREEN_DIAGNOSTICS || parent == SCREEN_BOOT) parent = SCREEN_IDLE;
  showScreen(parent);
}

static void stepFocus(int direction) {
  if (g_screen == SCREEN_DIAGNOSTICS) {
    if (direction > 0) {
      if (g_diag_focus < 2) {
        ++g_diag_focus;
      } else if (g_diag_window_top < 6) {
        ++g_diag_window_top;
      }
    } else {
      if (g_diag_focus > 0) {
        --g_diag_focus;
      } else if (g_diag_window_top > 0) {
        --g_diag_window_top;
      }
    }
    syncNavigationUi();
    return;
  }

  // Standard menus use stop-at-edge behavior. There is deliberately no wrap:
  // wrap-around is unsafe when the next action is a destructive process command.
  if (g_screen == SCREEN_ASSIGNMENT || g_screen == SCREEN_PRESTART) {
    if (direction > 0 && g_hmi_focus < 1) ++g_hmi_focus;
    if (direction < 0 && g_hmi_focus > 0) --g_hmi_focus;
    syncNavigationUi();
  }
}

static void acceptAssignment(uint32_t now_ms, int64_t ts, bool synced) {
  char detail[128];
  snprintf(detail, sizeof(detail), "\"processId\":\"%s\",\"analyst\":\"%s\"",
           g_process_id, g_analyst_name);
  g_mqtt.publishEvent("ASSIGNMENT_ACCEPTED", g_boot, now_ms, ts, synced, detail);
  g_screen = SCREEN_PRESTART;
  g_hmi_focus = 0;
  g_dwin.showPreStartPage(g_process_name, g_max_temp, g_max_rpm, g_max_temp_roc);
  g_dwin.setPage(DWIN_PAGE_PRESTART);
  syncNavigationUi();
}

static void rejectAssignment(uint32_t now_ms, int64_t ts, bool synced) {
  char detail[128];
  snprintf(detail, sizeof(detail), "\"processId\":\"%s\",\"analyst\":\"%s\"",
           g_process_id, g_analyst_name);
  g_mqtt.publishEvent("ASSIGNMENT_REJECTED", g_boot, now_ms, ts, synced, detail);
  g_process_id[0] = '\0';
  g_process_name[0] = '\0';
  showScreen(SCREEN_IDLE);
}

static void startProcess(uint32_t now_ms, int64_t ts, bool synced) {
  char detail[128];
  snprintf(detail, sizeof(detail), "\"processId\":\"%s\",\"analyst\":\"%s\"",
           g_process_id, g_analyst_name);
  g_mqtt.publishEvent("ATTEMPT_STARTED", g_boot, now_ms, ts, synced, detail);
  g_attempt_start_ms = (esp_timer_get_time() / 1000);
  g_samples_logged = 0;
  showScreen(SCREEN_RUNNING);
}

static void cancelProcess(uint32_t now_ms, int64_t ts, bool synced) {
  char detail[128];
  snprintf(detail, sizeof(detail), "\"processId\":\"%s\",\"analyst\":\"%s\"",
           g_process_id, g_analyst_name);
  g_mqtt.publishEvent("PROCESS_CANCELLED", g_boot, now_ms, ts, synced, detail);
  g_process_id[0] = '\0';
  g_process_name[0] = '\0';
  showScreen(SCREEN_IDLE);
}

// Button Task: MODE=back/mode switch, UP/DOWN=focus/scroll, SELECT=confirm.
// A long MODE hold opens diagnostics; active alarms and running processes cannot
// be hidden by MODE because doing so would create an unsafe false-idle display.
static void buttonTask(void *) {
  g_buttons.begin();
  for (;;) {
    g_buttons.poll();
    rmp::BtnMsg m;
    while (g_buttons.get(m)) {
      uint32_t now_ms = (uint32_t)(esp_timer_get_time() / 1000);
      int64_t ts = rmp::TimeSync::utcMs();
      bool synced = (g_time.state() == rmp::T_SYNCED);
      const char *btn_name = (m.id == 0) ? "MODE" : (m.id == 1) ? "UP" : (m.id == 2) ? "DOWN" : "SELECT";
      const char *evt_name = (m.e == rmp::BE_SHORT) ? "SHORT" :
                             (m.e == rmp::BE_LONG) ? "LONG" :
                             (m.e == rmp::BE_HOLD3) ? "HOLD3" : "REPEAT";
      ESP_LOGI("rmp_btn", "Button Event: %s %s on screen %u focus=%u",
               btn_name, evt_name, (unsigned)g_screen, (unsigned)g_hmi_focus);

      if (m.e == rmp::BE_SHORT) g_audio.beep(1046, 50);

      if (m.id == 0) {  // MODE
        if (m.e == rmp::BE_HOLD3 && g_screen != SCREEN_ALARM && g_screen != SCREEN_RUNNING) {
          s_prev_screen = g_screen;
          g_screen = SCREEN_DIAGNOSTICS;
          g_dwin.setPage(DWIN_PAGE_DIAGNOSTICS);
          resetNavigationForScreen(SCREEN_DIAGNOSTICS);
        } else if (m.e == rmp::BE_SHORT) {
          if (g_screen == SCREEN_DIAGNOSTICS) {
            returnFromDiagnostics();
          } else if (g_screen == SCREEN_ASSIGNMENT || g_screen == SCREEN_PRESTART ||
                     g_screen == SCREEN_COMPLETED) {
            // MODE discards the local selection and never publishes a workflow event.
            showScreen(SCREEN_IDLE);
          } else if (g_screen == SCREEN_ALARM) {
            ESP_LOGW("rmp_btn", "MODE ignored while critical alarm is active");
          } else if (g_screen == SCREEN_RUNNING) {
            ESP_LOGW("rmp_btn", "MODE ignored while process is RUNNING; use server abort workflow");
          }
        }
      } else if ((m.id == 1 || m.id == 2) &&
                 (m.e == rmp::BE_SHORT || m.e == rmp::BE_REPEAT)) {
        stepFocus(m.id == 1 ? -1 : 1);
      } else if (m.id == 3 && m.e == rmp::BE_SHORT) {  // SELECT
        if (g_screen == SCREEN_ASSIGNMENT) {
          if (g_hmi_focus == 0) acceptAssignment(now_ms, ts, synced);
          else rejectAssignment(now_ms, ts, synced);
        } else if (g_screen == SCREEN_PRESTART) {
          if (g_hmi_focus == 0) startProcess(now_ms, ts, synced);
          else cancelProcess(now_ms, ts, synced);
        } else if (g_screen == SCREEN_RUNNING) {
          // SELECT is the only local acknowledgement action while running.
          g_alarm_silenced = true;
          g_dwin.writeValue(rmp::VP_RUN_FOOTER, 1);
          if (g_alert_level != rmp::AlertLevel::kOff) {
            g_alert_level = rmp::AlertLevel::kOff;
            g_mqtt.publishEvent("ALERT_MUTED", g_boot, now_ms, ts, synced,
                                "\"parameter\":\"temperature\"");
          }
        } else if (g_screen == SCREEN_ALARM) {
          g_alert_level = rmp::AlertLevel::kOff;
          g_alarm_silenced = true;
          g_dwin.writeValue(rmp::VP_MUTE_BUTTON, 1);
        } else if (g_screen == SCREEN_COMPLETED) {
          showScreen(SCREEN_IDLE);
        } else if (g_screen == SCREEN_DIAGNOSTICS) {
          ESP_LOGI("rmp_btn", "Diagnostics detail acknowledged for row %u",
                   (unsigned)(g_diag_window_top + g_diag_focus + 1));
        }
        syncNavigationUi();
      }
    }
    vTaskDelay(pdMS_TO_TICKS(5));
  }
}

// 1 Hz Sampler Task: acquisition, flash ring storage, RoC safety evaluation,
// DWIN updates
static void samplerTask(void *) {
  TickType_t lastWakeTime = xTaskGetTickCount();
  uint32_t seq = 0;
  bool flash_toggle = false;

  for (;;) {
    vTaskDelayUntil(&lastWakeTime, pdMS_TO_TICKS(1000));
    int64_t now_us = esp_timer_get_time();
    int64_t now_ms = now_us / 1000;

    // Retry RTD init if needed
    if (!g_rtd_ok)
      g_rtd_ok = g_rtd.begin();

    float t = NAN, r = 0;
    uint8_t rf = g_rtd_ok ? g_rtd.read(t, r) : 0xFF;
    if (rf == 0xFF)
      g_rtd_ok = false;

    float t_raw = t;
    float t_cal =
        (rf == 0 && isfinite(t)) ? (t * g_cal_gain + g_cal_offset) : NAN;
    float t_eval = isfinite(t_cal) ? t_cal : t_raw;
    g_current_temp = t_eval;

    rmp::MotorData motor_data{};
    bool motor_ok = g_motor.poll(motor_data);
    float rpm = motor_ok ? motor_data.rpm : 0.0f;
    float tq = motor_ok ? motor_data.tq_ncm : 0.0f;
    float rate = 0.0f;

    if (g_motor.identityChanged() && g_mqtt.isConnected()) {
      const auto &mi = g_motor.identity();
      char detail[256];
      char serial_json[64] = "null";
      if (mi.serial[0])
        snprintf(serial_json, sizeof(serial_json), "\"%s\"", mi.serial);
      snprintf(detail, sizeof(detail),
               "{\"manufacturer\":\"%s\",\"model\":\"%s\",\"protocol\":\"%s\",\"serial\":%s}",
               mi.manufacturer, mi.model, rmp::motorProtocolName(mi.protocol),
               serial_json);
      g_mqtt.publishEvent("MOTOR_IDENTIFIED", g_boot, (uint32_t)now_ms,
                          rmp::TimeSync::utcMs(), g_time.state() == rmp::T_SYNCED,
                          detail);
      g_motor.clearIdentityChanged();
    }

    // Local Rate-of-Change (RoC) & Safety Alarm Check
    if (rf == 0 && isfinite(t_eval)) {
      if (s_hist_count < sizeof(s_history) / sizeof(s_history[0])) {
        s_history[s_hist_count++] = {now_ms, t_eval, rpm};
      } else {
        memmove(&s_history[0], &s_history[1],
                sizeof(SamplePoint) * (s_hist_count - 1));
        s_history[s_hist_count - 1] = {now_ms, t_eval, rpm};
      }

      // Look back ~10s to 30s to compute rate
      if (s_hist_count >= 5) {
        const auto &old_pt = s_history[0];
        float dt_min = (float)(now_ms - old_pt.ts_ms) / 60000.0f;
        if (dt_min > 0.05f) {
          rate = (t_eval - old_pt.t) / dt_min; // °C/min
          g_current_roc = rate;
          if (rate > g_max_temp_roc || t_eval > g_max_temp) {
            // CRITICAL ALARM TRIGGERED!
            if (g_screen != SCREEN_ALARM) {
              s_prev_screen = g_screen;
              g_screen = SCREEN_ALARM;
              g_dwin.showAlarmPage("THERMAL RUNAWAY", rate, g_max_temp_roc,
                                   t_eval, g_alarm_silenced, false);
              g_dwin.setPage(DWIN_PAGE_ALARM);
            }

            if (!g_alarm_silenced) {
              g_alert_level = rmp::AlertLevel::kHigh; // Loud Siren
            }

            if (!s_alarm_sent) {
              s_alarm_sent = true;
              int64_t ts = rmp::TimeSync::utcMs();
              bool synced = (g_time.state() == rmp::T_SYNCED);
              char detail[128];
              snprintf(detail, sizeof(detail),
                       "{\"parameter\":\"temperature\",\"value\":%.1f,\"rate\":"
                       "%.1f,\"limit\":%.1f}",
                       t_eval, rate, g_max_temp_roc);
              g_mqtt.publishEvent("ALARM_TRIGGERED", g_boot, now_ms, ts, synced,
                                  detail);
            }
          } else {
            // Conditions normal
            if (s_alarm_sent) {
              s_alarm_sent = false;
              int64_t ts = rmp::TimeSync::utcMs();
              bool synced = (g_time.state() == rmp::T_SYNCED);
              char detail[128];
              snprintf(detail, sizeof(detail),
                       "{\"parameter\":\"temperature\",\"value\":%.1f}",
                       t_eval);
              g_mqtt.publishEvent("ALARM_CLEARED", g_boot, now_ms, ts, synced,
                                  detail);
            }
            if (g_alert_level != rmp::AlertLevel::kOff && !g_alarm_silenced) {
              g_alert_level = rmp::AlertLevel::kOff;
            }
            g_alarm_silenced = false;

            // Return from alarm to running
            if (g_screen == SCREEN_ALARM) {
              g_dwin.writeValue(rmp::VP_ALARM_FLASH, 0);
              g_screen = SCREEN_RUNNING;
              g_dwin.setPage(DWIN_PAGE_RUNNING);
            }
          }
        }
      }
    }

    char clockStr[8];
    formatClock(clockStr, sizeof(clockStr));
    bool is_online = g_mqtt.isConnected();

    // Mirror to DWIN Display per page (Section 8)
    if (!g_dwin_paused) {
      // Mirror navigation state before page values so the DGUS highlight and
      // firmware cursor remain synchronized after server-driven page changes.
      syncNavigationUi();
      if (g_screen == SCREEN_RUNNING) {
      char durationStr[16];
      int64_t dur_ms = now_ms - g_attempt_start_ms;
      formatDuration(dur_ms, durationStr, sizeof(durationStr));
      uint8_t tq_pct = (uint8_t)lroundf((tq / 50.0f) * 100.0f);
      if (tq_pct > 100)
        tq_pct = 100;
      uint16_t qual_pill = (rf == 0) ? 0 : 2; // 0=GOOD, 2=BAD

      g_dwin.showRunningPage(g_reactor_title, clockStr, is_online, qual_pill,
                             t_eval, t_raw, rf == 0, rpm, g_max_rpm, tq, tq_pct,
                             motor_ok, rate, "BATCH-01", durationStr, rf,
                             g_alarm_silenced);
    } else if (g_screen == SCREEN_IDLE) {
      uint16_t qual_dot = (rf == 0) ? 0 : 2; // 0=good, 2=bad
      g_dwin.showIdlePage(g_reactor_title, g_lab_name, clockStr, is_online,
                          qual_dot, t_eval, t_raw, rf == 0, rpm, tq, motor_ok);
    } else if (g_screen == SCREEN_UNBOUND) {
      char devid[40] = {0};
      rmp::Prov::getDeviceId(devid, sizeof devid);
      char broker[96] = {0};
      rmp::Prov::getBrokerUri(broker, sizeof broker);
      char ip_str[24] = {0};
      g_net.ipString(ip_str, sizeof ip_str);
      uint8_t mac[6] = {0};
      esp_efuse_mac_get_default(mac);
      char mac_str[18] = {0};
      snprintf(mac_str, sizeof mac_str, "%02X:%02X:%02X:%02X:%02X:%02X", mac[0],
               mac[1], mac[2], mac[3], mac[4], mac[5]);
      g_dwin.showUnboundPage(devid, mac_str, ip_str, broker);
    } else if (g_screen == SCREEN_ALARM) {
      // Toggle 1 Hz flash (every 500 ms in a 1Hz sampler, we alternate each
      // second)
      flash_toggle = !flash_toggle;
      g_dwin.showAlarmPage("THERMAL RUNAWAY", rate, g_max_temp_roc, t_eval,
                           g_alarm_silenced, flash_toggle);
    } else if (g_screen == SCREEN_DIAGNOSTICS) {
      char devid[40] = {0};
      rmp::Prov::getDeviceId(devid, sizeof devid);
      char broker[96] = {0};
      rmp::Prov::getBrokerUri(broker, sizeof broker);
      char ssid[33] = {0};
      rmp::Prov::getWifiSsid(ssid, sizeof ssid);
      char ip_str[24] = {0};
      g_net.ipString(ip_str, sizeof ip_str);

      uint8_t mac[6] = {0};
      esp_efuse_mac_get_default(mac);
      char mac_str[18] = {0};
      snprintf(mac_str, sizeof mac_str, "%02X:%02X:%02X:%02X:%02X:%02X", mac[0],
               mac[1], mac[2], mac[3], mac[4], mac[5]);

      char rtd_msg[24];
      if (rf == 0) {
        snprintf(rtd_msg, sizeof(rtd_msg), "ACTIVE (%.1f C)", t_eval);
      } else {
        snprintf(rtd_msg, sizeof(rtd_msg), "FAULT (0x%02X)", (unsigned)rf);
      }

      g_dwin.showDiagnosticsPage(
          ssid[0] ? ssid : "NONE",
          g_net.isConnected() ? rmp::DOT_GOOD : rmp::DOT_BAD,
          ip_str[0] ? ip_str : "0.0.0.0",
          g_net.isConnected() ? rmp::DOT_GOOD : rmp::DOT_BAD, broker,
          is_online ? rmp::DOT_GOOD : rmp::DOT_SUSPECT,
          is_online ? "CONNECTED" : "DISCONNECTED",
          is_online ? rmp::DOT_GOOD : rmp::DOT_BAD,
          (g_time.state() == rmp::T_SYNCED) ? "LOCKED (+/-2 ms)" : "UNLOCKED",
          (g_time.state() == rmp::T_SYNCED) ? rmp::DOT_GOOD : rmp::DOT_SUSPECT,
          rtd_msg, (rf == 0) ? rmp::DOT_GOOD : rmp::DOT_BAD, "STANDBY",
          rmp::DOT_OFF, "Ring 16MB", rmp::DOT_GOOD, mac_str, rmp::DOT_GOOD);
    }
  }

    g_dwin.pollRx();

    // Write-Ahead Append to Flash Ring Buffer
    Rec rec = {};
    rec.seq = ++seq;
    rec.mono_ms = (uint32_t)now_ms;
    rec.t = (rf == 0 ? t_eval : NAN);
    rec.t_raw = (rf == 0 ? t_raw : NAN);
    rec.rpm = (uint16_t)rpm;
    rec.tq_x10 = (int16_t)lroundf(tq * 10.0f);
    rec.q = (rf == 0 ? 0 : 2) | ((motor_ok ? 0 : 2) << 2) |
            ((motor_ok ? 0 : 2) << 4);
    rec.flt = motor_ok ? motor_data.flt : 0;
    rec.flags = 0;
    rec.boot = (uint16_t)g_boot;

    g_ring.append(rec);
    g_samples_logged++;
  }
}

// Network & MQTT Task: connection management, SNTP sync, batch streaming, acks
static void netMqttTask(void *) {
  static char s_ssid[33];
  static char s_pass[65];
  static char s_broker[96];
  static char s_devid[40];

  if (!rmp::Prov::hasWifiCreds()) {
    ESP_LOGW(TAG,
             "No Wi-Fi credentials stored -- starting provisioning portal");
    if (g_screen == SCREEN_BOOT) {
      g_screen = SCREEN_WIFI_SETUP;
      g_dwin.setPage(DWIN_PAGE_WIFI_SETUP);
    }
    g_net.runProvisioningPortal();
  }

  bool wifi_ok = false;
  for (;;) {
    rmp::Prov::getWifiSsid(s_ssid, sizeof s_ssid);
    rmp::Prov::getWifiPass(s_pass, sizeof s_pass);
    wifi_ok =
        g_net.connectWithRetryWindow(s_ssid, s_pass, WIFI_PROV_RETRY_WINDOW_MS);
    if (wifi_ok)
      break;
    ESP_LOGW(TAG, "Could not reach '%s' -- re-opening provisioning portal",
             s_ssid);
    if (g_screen != SCREEN_RUNNING && g_screen != SCREEN_ALARM) {
      g_screen = SCREEN_WIFI_SETUP;
      g_dwin.setPage(DWIN_PAGE_WIFI_SETUP);
    }
    g_net.runProvisioningPortal();
  }

  rmp::Prov::getBrokerUri(s_broker, sizeof s_broker);
  rmp::Prov::getDeviceId(s_devid, sizeof s_devid);
  ESP_LOGI(TAG, "Configuring MQTT client: broker=%s device_id=%s", s_broker,
           s_devid);

  // If Wi-Fi connected, exit Wi-Fi Setup / Boot screen
  if (g_screen == SCREEN_BOOT || g_screen == SCREEN_WIFI_SETUP) {
    if (g_bound) {
      g_screen = SCREEN_IDLE;
      g_dwin.setPage(DWIN_PAGE_IDLE);
    } else {
      char ip_str[24] = {0};
      g_net.ipString(ip_str, sizeof ip_str);
      uint8_t mac[6] = {0};
      esp_efuse_mac_get_default(mac);
      char mac_str[18] = {0};
      snprintf(mac_str, sizeof mac_str, "%02X:%02X:%02X:%02X:%02X:%02X", mac[0],
               mac[1], mac[2], mac[3], mac[4], mac[5]);
      g_screen = SCREEN_UNBOUND;
      g_dwin.showUnboundPage(s_devid, mac_str, ip_str, s_broker);
      g_dwin.setPage(DWIN_PAGE_UNBOUND);
    }
  }

  rmp::MqttConfig cfg = {};
  cfg.device_id = s_devid;
  cfg.broker_uri = s_broker;
  cfg.ca_cert_pem = (const char *)ca_crt_start;
  cfg.client_cert_pem = (const char *)device_crt_start;
  cfg.client_key_pem = (const char *)device_key_start;
  cfg.fw_version = FW_VERSION;
  cfg.on_ack_data = onServerAckData;
  cfg.on_cfg_desired = onServerCfgDesired;

  g_mqtt.begin(cfg);
  g_time.begin("pool.ntp.org");

  int tick_persist = 0;

  for (;;) {
    g_time.poll();

    // Check time anchor
    uint32_t anchor_mono = 0;
    int64_t anchor_utc = 0;
    if (g_time.takeAnchor(anchor_mono, anchor_utc)) {
      char detail[64];
      snprintf(detail, sizeof(detail), "\"drift_ms\":0");
      g_mqtt.publishEvent("TIME_ANCHOR", g_boot, anchor_mono, anchor_utc, true,
                          detail);
    }

    if (g_mqtt.isConnected() && !g_decommissioned) {
      const auto &mi = g_motor.identity();
      g_mqtt.publishState(
          "wifi", g_boot, mi.detected ? mi.manufacturer : nullptr,
          mi.detected ? mi.model : nullptr,
          mi.detected ? rmp::motorProtocolName(mi.protocol) : nullptr,
          mi.detected ? mi.serial : nullptr);

      // Drain live batches from ring buffer
      rmp::RingStore::View view;
      uint8_t n = g_ring.peek(view, 10);
      if (n > 0) {
        bool ok = g_mqtt.publishBatch(view, false, "wifi");
        if (ok) {
          g_ring.commitCursor();
        } else {
          g_ring.rewindCursor();
        }
      }

      // Drain backlog if pending
      if (g_ring.pendingApprox() > 15) {
        n = g_ring.peek(view, 50);
        if (n > 0) {
          bool ok = g_mqtt.publishBatch(view, true, "wifi");
          if (ok) {
            g_ring.commitCursor();
          } else {
            g_ring.rewindCursor();
          }
        }
      }

      // Persist ring tail periodically
      if (++tick_persist >= 12) {
        tick_persist = 0;
        g_ring.persist();
      }
    }
    vTaskDelay(pdMS_TO_TICKS(5000));
  }
}

// Audio Alert Task: drives the NS4150B amplifier and ES8311 speaker
static void alertTask(void *) {
  rmp::AlertLevel last_level = rmp::AlertLevel::kOff;
  int64_t next_fire_ms = 0;
  for (;;) {
    rmp::AlertLevel level = g_alert_level;
    int64_t now_ms = esp_timer_get_time() / 1000;
    if (level != last_level) {
      last_level = level;
      next_fire_ms = 0;
    }
    if (level == rmp::AlertLevel::kHigh) {
      if (now_ms >= next_fire_ms) {
        g_audio.beep(880, 250);
        next_fire_ms = now_ms + 1000;
      }
    } else if (level == rmp::AlertLevel::kMedium) {
      if (now_ms >= next_fire_ms) {
        g_audio.beep(660, 200);
        next_fire_ms = now_ms + 4000;
      }
    } else if (level == rmp::AlertLevel::kLow) {
      if (now_ms >= next_fire_ms) {
        g_audio.beep(440, 150);
        next_fire_ms = now_ms + 8000;
      }
    }
    vTaskDelay(pdMS_TO_TICKS(50));
  }
}

// Console Task
static void consoleTask(void *) {
  char line[128];
  int idx = 0;
  printf("commands: help | status | ring | time | rtd | motor | net | alert "
         "low|med|high|off\n"
         "          set wifi SSID PASS | set broker HOST [PORT] | set devid "
         "UUID | reboot\n");
  printf("rmp> ");
  fflush(stdout);

  for (;;) {
    int c = getchar();
    if (c == EOF || c < 0) {
      vTaskDelay(pdMS_TO_TICKS(20));
      continue;
    }
    if (c == '\r' || c == '\n') {
      if (idx == 0) {
        printf("\nrmp> ");
        fflush(stdout);
        continue;
      }
      line[idx] = '\0';
      printf("\n");
      idx = 0;
    } else if (c == 0x08 || c == 0x7F) {
      if (idx > 0) {
        idx--;
        printf("\b \b");
        fflush(stdout);
      }
      continue;
    } else {
      if (idx < (int)sizeof(line) - 1) {
        line[idx++] = (char)c;
        putchar(c);
        fflush(stdout);
      }
      continue;
    }

    if (strcmp(line, "help") == 0) {
      printf("commands: help | status | ring | time | rtd | motor | net | "
             "alert low|med|high|off\n"
             "          dwin test | dwin resume | dwin page <N> | dwin hex <BYTES>\n"
             "          set wifi SSID PASS | set broker HOST [PORT] | set "
             "devid UUID | reboot\n");
    } else if (strcmp(line, "status") == 0) {
      float t = NAN, r = 0;
      uint8_t rf = g_rtd_ok ? g_rtd.read(t, r) : 0xFF;
      printf("fw %s  rtd %s (T=%.2f C, R=%.2f ohm)\n", FW_VERSION,
             rf == 0 ? "init-ok" : "fault", t, r);
    } else if (strcmp(line, "ring") == 0) {
      printf("ring sectors=%u pending=%u fill=%u%% lost=%" PRIu32 "\n",
             (unsigned)g_ring.sectors(),
             (unsigned)g_ring.pendingApprox(), (unsigned)g_ring.fillPercent(),
             g_ring.takeLost());
    } else if (strcmp(line, "time") == 0) {
      printf("time state=%d utc=%" PRId64 " ms mono=%" PRIu32 " ms\n",
             (int)g_time.state(), rmp::TimeSync::utcMs(),
             (uint32_t)(esp_timer_get_time() / 1000));
    } else if (strcmp(line, "rtd") == 0) {
      float t = NAN, r = 0;
      uint8_t rf = g_rtd.read(t, r);
      printf("rtd raw: fault=0x%02x T=%.2f C R=%.2f ohm\n", rf, t, r);
    } else if (strcmp(line, "net") == 0) {
      char ip[24] = {0};
      g_net.ipString(ip, sizeof ip);
      char broker[96] = {0};
      rmp::Prov::getBrokerUri(broker, sizeof broker);
      char did[40] = {0};
      rmp::Prov::getDeviceId(did, sizeof did);
      printf(
          "net: ip=%s, connected=%d, broker=%s, devid=%s, mqtt_connected=%d\n",
          ip, (int)g_net.isConnected(), broker, did, (int)g_mqtt.isConnected());
    } else if (strncmp(line, "set broker ", 11) == 0) {
      char host[64] = {0};
      int port = 18883;
      if (sscanf(line + 11, "%63s %d", host, &port) >= 1) {
        rmp::Prov::setBroker(host, (uint16_t)port);
        printf("broker updated to %s:%d (reboot to take effect)\n", host, port);
      }
    } else if (strncmp(line, "set wifi ", 9) == 0) {
      char ssid[33] = {0}, pass[65] = {0};
      const char *args = line + 9;
      while (*args == ' ')
        args++;
      if (*args == '"') {
        args++;
        const char *endQuote = strchr(args, '"');
        if (endQuote) {
          size_t sLen = (size_t)(endQuote - args);
          if (sLen >= sizeof(ssid))
            sLen = sizeof(ssid) - 1;
          strncpy(ssid, args, sLen);
          ssid[sLen] = '\0';
          const char *pPass = endQuote + 1;
          while (*pPass == ' ')
            pPass++;
          strncpy(pass, pPass, sizeof(pass) - 1);
          size_t plen = strlen(pass);
          while (plen > 0 &&
                 (pass[plen - 1] == '\r' || pass[plen - 1] == '\n' ||
                  pass[plen - 1] == ' ')) {
            pass[--plen] = '\0';
          }
        }
      } else {
        const char *lastSpace = strrchr(args, ' ');
        if (lastSpace && lastSpace != args) {
          size_t sLen = (size_t)(lastSpace - args);
          if (sLen >= sizeof(ssid))
            sLen = sizeof(ssid) - 1;
          strncpy(ssid, args, sLen);
          ssid[sLen] = '\0';
          strncpy(pass, lastSpace + 1, sizeof(pass) - 1);
          size_t plen = strlen(pass);
          while (plen > 0 &&
                 (pass[plen - 1] == '\r' || pass[plen - 1] == '\n' ||
                  pass[plen - 1] == ' ')) {
            pass[--plen] = '\0';
          }
        } else {
          sscanf(args, "%32s %64s", ssid, pass);
        }
      }
      if (ssid[0] != '\0') {
        rmp::Prov::setWifi(ssid, pass);
        printf("wifi updated to '%s' (pass set) (reboot to take effect)\n",
               ssid);
      } else {
        printf("usage: set wifi <SSID> <PASSWORD> or set wifi \"<SSID WITH "
               "SPACES>\" <PASSWORD>\n");
      }
    } else if (strncmp(line, "set devid ", 10) == 0) {
      char did[40] = {0};
      if (sscanf(line + 10, "%39s", did) == 1) {
        rmp::Prov::setDeviceId(did);
        printf("devid updated to %s\n", did);
      }
    } else if (strncmp(line, "alert ", 6) == 0) {
      const char *lvl = line + 6;
      if (strcmp(lvl, "high") == 0) {
        g_alert_level = rmp::AlertLevel::kHigh;
        printf("alert set to HIGH (880 Hz repeating)\n");
      } else if (strcmp(lvl, "med") == 0 || strcmp(lvl, "medium") == 0) {
        g_alert_level = rmp::AlertLevel::kMedium;
        printf("alert set to MEDIUM (660 Hz repeating)\n");
      } else if (strcmp(lvl, "low") == 0) {
        g_alert_level = rmp::AlertLevel::kLow;
        printf("alert set to LOW (440 Hz repeating)\n");
      } else if (strcmp(lvl, "off") == 0) {
        g_alert_level = rmp::AlertLevel::kOff;
        printf("alert turned OFF\n");
      } else {
        printf("usage: alert low|med|high|off\n");
      }
    } else if (strncmp(line, "beep", 4) == 0) {
      int hz = 880, ms = 300;
      sscanf(line + 4, "%d %d", &hz, &ms);
      printf("playing test beep: %d Hz for %d ms\n", hz, ms);
      g_audio.beep((uint16_t)hz, (uint16_t)ms);
      printf("beep complete\n");
    } else if (strcmp(line, "dwin test") == 0) {
      g_dwin_paused = true;
      printf("[DWIN] Background updates PAUSED.\n");
      printf("[DWIN] Switching to Page 1 (Idle standby)...\n");
      g_dwin.setPage(rmp::DWIN_PAGE_IDLE);
      vTaskDelay(pdMS_TO_TICKS(100));

      // Test frame 1: Writes 'TEST' (4 chars) to VP 0x2000
      // 5A A5 09 82 20 00 54 45 53 54 FF FF
      const uint8_t f1[] = {0x5A, 0xA5, 0x09, 0x82, 0x20, 0x00, 0x54, 0x45, 0x53, 0x54, 0xFF, 0xFF};
      g_dwin.sendRaw(f1, sizeof(f1));
      printf("[DWIN] Sent VP 0x2000: 'TEST' (5A A5 09 82 20 00 54 45 53 54 FF FF)\n");
      vTaskDelay(pdMS_TO_TICKS(100));

      // Test frame 2: Writes '24.8' (4 chars) to VP 0x1100
      // 5A A5 09 82 11 00 32 34 2E 38 FF FF
      const uint8_t f2[] = {0x5A, 0xA5, 0x09, 0x82, 0x11, 0x00, 0x32, 0x34, 0x2E, 0x38, 0xFF, 0xFF};
      g_dwin.sendRaw(f2, sizeof(f2));
      printf("[DWIN] Sent VP 0x1100: '24.8' (5A A5 09 82 11 00 32 34 2E 38 FF FF)\n");
      printf("[DWIN] Test complete. Look at screen:\n");
      printf("       - If 'TEST' and '24.8' render clearly -> font & hardware are GOOD.\n");
      printf("       - If still garbled -> font file 0_DWIN_ASC.HZK on DWIN display must be refreshed via SD card.\n");
    } else if (strcmp(line, "dwin resume") == 0) {
      g_dwin_paused = false;
      printf("[DWIN] Background updates RESUMED.\n");
    } else if (strncmp(line, "dwin page ", 10) == 0) {
      int pg = atoi(line + 10);
      g_dwin.setPage((uint8_t)pg);
      printf("[DWIN] Switched to page %d\n", pg);
    } else if (strncmp(line, "dwin hex ", 9) == 0) {
      const char *p = line + 9;
      uint8_t buf[128];
      size_t blen = 0;
      while (*p && blen < sizeof(buf)) {
        while (*p == ' ') p++;
        if (!*p) break;
        unsigned int b = 0;
        if (sscanf(p, "%02x", &b) == 1) {
          buf[blen++] = (uint8_t)b;
          while (*p && *p != ' ') p++;
        } else {
          break;
        }
      }
      if (blen > 0) {
        g_dwin.sendRaw(buf, blen);
        printf("[DWIN] Sent %u raw hex bytes.\n", (unsigned)blen);
      }
    } else if (strcmp(line, "reboot") == 0) {
      printf("rebooting...\n");
      esp_restart();
    } else {
      printf("unknown command: %s\n", line);
    }
    printf("rmp> ");
    fflush(stdout);
  }
}

extern "C" void app_main() {
  initConsoleUart();
  ESP_LOGI(TAG,
           "=== Reactor Monitoring Platform starting (fw %s) ===", FW_VERSION);

  // Initialize NVS and increment boot counter
  esp_err_t err = nvs_flash_init();
  if (err == ESP_ERR_NVS_NO_FREE_PAGES ||
      err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
    nvs_flash_erase();
    nvs_flash_init();
  }

  nvs_handle_t nvs_h;
  if (nvs_open("rmp_boot", NVS_READWRITE, &nvs_h) == ESP_OK) {
    uint32_t val = 0;
    nvs_get_u32(nvs_h, "boot_count", &val);
    g_boot = val + 1;
    nvs_set_u32(nvs_h, "boot_count", g_boot);
    nvs_commit(nvs_h);
    nvs_close(nvs_h);
  }
  ESP_LOGI(TAG, "Persistent Boot ID: %lu", (unsigned long)g_boot);

  // Initialize DWIN UART first
  g_dwin.begin();

  // Section 7.1: Wait 1.5-2.0 s after display powers up before sending the
  // first frame
  vTaskDelay(pdMS_TO_TICKS(1800));

  // Section 7.3: Write power-up defaults to all icon VPs & progress bars
  g_dwin.writePowerUpDefaults();

  // Section 7.4 & 7.5: Boot/POST sequence on Page 0 with progress bar 0 -> 100%
  g_dwin.setPage(DWIN_PAGE_BOOT);
  g_dwin.showBootPage(0, "FW " FW_VERSION);

  // Step 1: Provisioning / NVS (25%)
  rmp::Prov::begin();
  g_dwin.showBootPage(25, nullptr);
  vTaskDelay(pdMS_TO_TICKS(150));

  // Step 2: RTD Sensor (50%)
  g_rtd_ok = g_rtd.begin();
  g_dwin.showBootPage(50, nullptr);
  vTaskDelay(pdMS_TO_TICKS(150));

  // Step 3: Audio & Flash Ring Buffer (75%)
  g_audio_ok = g_audio.begin();
  g_ring.begin((uint16_t)g_boot);
  g_dwin.showBootPage(75, nullptr);
  vTaskDelay(pdMS_TO_TICKS(150));

  // Step 4: Motor & Communication (100%). Discovery uses only read-only
  // commands; it never starts, stops, resets or changes a motor setpoint.
  g_motor.begin();
  g_dwin.showBootPage(100, nullptr);
  vTaskDelay(pdMS_TO_TICKS(300)); // Brief pause so user sees 100% complete

  // Choose next page by initial state (Section 7.7)
  if (!rmp::Prov::hasWifiCreds()) {
    g_screen = SCREEN_WIFI_SETUP;
    g_dwin.setPage(DWIN_PAGE_WIFI_SETUP);
  } else {
    // Default to Idle page (Page 1) with power-up values
    g_screen = SCREEN_IDLE;
    char clockStr[8];
    formatClock(clockStr, sizeof(clockStr));
    g_dwin.showIdlePage(g_reactor_title, g_lab_name, clockStr, false,
                        rmp::DOT_GOOD, NAN, NAN, false, 0, 0, false);
    g_dwin.setPage(DWIN_PAGE_IDLE);
  }

  // Play pleasant boot chime so user can verify loud and clear audio
  if (g_audio_ok) {
    g_audio.beep(523, 70);  // C5
    vTaskDelay(pdMS_TO_TICKS(20));
    g_audio.beep(659, 70);  // E5
    vTaskDelay(pdMS_TO_TICKS(20));
    g_audio.beep(784, 120); // G5
  }

  // Launch FreeRTOS tasks
  xTaskCreatePinnedToCore(buttonTask, "btn", 3072, nullptr, 5, nullptr, 1);
  xTaskCreatePinnedToCore(samplerTask, "sampler", 4096, nullptr, 10, nullptr,
                          1);
  xTaskCreatePinnedToCore(netMqttTask, "net_mqtt", 8192, nullptr, 6, nullptr,
                          0);
  xTaskCreatePinnedToCore(alertTask, "alert", 3072, nullptr, 7, nullptr, 1);
  xTaskCreatePinnedToCore(consoleTask, "console", 4096, nullptr, 3, nullptr, 0);

  ESP_LOGI(TAG, "All tasks launched successfully");
}
