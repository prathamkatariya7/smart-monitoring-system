#include "rmp_time.h"
#include <stdlib.h>
#include "esp_log.h"
#include "esp_sntp.h"
#include "esp_timer.h"
#include "esp_attr.h"

namespace rmp {

static const char* TAG = "rmp_time";

RTC_NOINIT_ATTR static uint32_t s_rtcMagic;
RTC_NOINIT_ATTR static int64_t  s_lastSyncUtcMs;

static volatile bool     s_ntpFlag = false;
static volatile uint32_t s_anchorMono = 0;
static volatile int64_t  s_anchorUtc = 0;

static void sntpSyncNotificationCallback(struct timeval *tv) {
  s_anchorMono = (uint32_t)(esp_timer_get_time() / 1000);
  struct timeval cur;
  gettimeofday(&cur, nullptr);
  s_anchorUtc = (int64_t)cur.tv_sec * 1000 + cur.tv_usec / 1000;
  s_ntpFlag = true;
  ESP_LOGI(TAG, "NTP synced: UTC=%" PRId64 " ms (mono=%" PRIu32 " ms)",
           s_anchorUtc, s_anchorMono);
}

TimeSync::TimeSync() = default;

void TimeSync::begin(const char* primaryNtp) {
  setenv("TZ", "UTC0", 1);
  tzset();

  if (s_rtcMagic != 0xA5A5C3C3) {
    s_rtcMagic = 0xA5A5C3C3;
    s_lastSyncUtcMs = 0;
    state_ = T_UNSYNCED;
  } else {
    int64_t now = utcMs();
    bool recent = (s_lastSyncUtcMs > 0 && now > s_lastSyncUtcMs &&
                  (now - s_lastSyncUtcMs) < ((int64_t)RTC_MAX_UNSYNCED_H * 3600000LL));
    state_ = recent ? T_ESTIMATED : T_UNSYNCED;
  }

  ESP_LOGI(TAG, "initial time state: %s", stateName());

  esp_sntp_setoperatingmode(SNTP_OPMODE_POLL);
  if (primaryNtp && primaryNtp[0]) {
    esp_sntp_setservername(0, primaryNtp);
    esp_sntp_setservername(1, "pool.ntp.org");
  } else {
    esp_sntp_setservername(0, "pool.ntp.org");
    esp_sntp_setservername(1, "time.google.com");
  }
  sntp_set_time_sync_notification_cb(sntpSyncNotificationCallback);
  esp_sntp_init();
}

void TimeSync::poll() {
  if (s_ntpFlag) {
    s_ntpFlag = false;
    state_ = T_SYNCED;
    s_lastSyncUtcMs = s_anchorUtc;
    anchorPending_ = true;
  }
}

const char* TimeSync::stateName() const {
  switch (state_) {
    case T_SYNCED:    return "NTP";
    case T_ESTIMATED: return "RTC";
    default:          return "UNSYNCED";
  }
}

uint16_t TimeSync::flagBits() const {
  switch (state_) {
    case T_UNSYNCED:  return FL_TIME_UNSYNCED;
    case T_ESTIMATED: return FL_TIME_ESTIMATED;
    default:          return 0;
  }
}

int64_t TimeSync::utcMs() {
  struct timeval tv;
  gettimeofday(&tv, nullptr);
  return (int64_t)tv.tv_sec * 1000 + tv.tv_usec / 1000;
}

uint32_t TimeSync::monoMs() {
  return (uint32_t)(esp_timer_get_time() / 1000);
}

bool TimeSync::takeAnchor(uint32_t& mono, int64_t& utc) {
  if (!anchorPending_) return false;
  anchorPending_ = false;
  mono = s_anchorMono;
  utc = s_anchorUtc;
  return true;
}

}  // namespace rmp

