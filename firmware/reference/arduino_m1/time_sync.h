#pragma once
// Internal RTC as a bridge + NTP as the source of truth + TIME_ANCHOR events (TDD 7.5).
#include <Arduino.h>
#include <time.h>
#include <sys/time.h>
#include <esp_sntp.h>
#include <esp_system.h>
#include <esp_timer.h>
#include "rmp_types.h"
#include "config.h"

enum TimeState : uint8_t { T_UNSYNCED = 0, T_ESTIMATED = 1, T_SYNCED = 2 };

RTC_NOINIT_ATTR static uint32_t g_rtcMagic;          // survives software reset / coin-cell power cut
RTC_NOINIT_ATTR static int64_t  g_lastSyncUtcMs;
static volatile bool     g_ntpFlag = false;
static volatile uint32_t g_anchorMono = 0;
static volatile int64_t  g_anchorUtc = 0;
static void ntpSyncCb(struct timeval*) {
  g_anchorMono = (uint32_t)(esp_timer_get_time() / 1000);
  struct timeval tv; gettimeofday(&tv, nullptr);
  g_anchorUtc = (int64_t)tv.tv_sec * 1000 + tv.tv_usec / 1000;
  g_ntpFlag = true;
}

class TimeSync {
 public:
  void begin(const char* primaryNtp) {
    setenv("TZ", "UTC0", 1); tzset();
    if (g_rtcMagic != 0xA5A5C3C3) { g_rtcMagic = 0xA5A5C3C3; g_lastSyncUtcMs = 0; state_ = T_UNSYNCED; }
    else {
      int64_t now = utcMs();
      bool recent = g_lastSyncUtcMs > 0 && now > g_lastSyncUtcMs &&
                    (now - g_lastSyncUtcMs) < (int64_t)RTC_MAX_UNSYNCED_H * 3600000LL;
      state_ = recent ? T_ESTIMATED : T_UNSYNCED;
    }
    sntp_set_time_sync_notification_cb(ntpSyncCb);
    if (primaryNtp && primaryNtp[0]) configTime(0, 0, primaryNtp, "pool.ntp.org"); else configTime(0, 0, "pool.ntp.org");
  }
  void loop() {
    if (g_ntpFlag) {
      g_ntpFlag = false; state_ = T_SYNCED; g_lastSyncUtcMs = g_anchorUtc; anchorPending_ = true;
    }
  }
  TimeState state() const { return state_; }
  const char* stateName() const { return state_ == T_SYNCED ? "NTP" : state_ == T_ESTIMATED ? "RTC" : "UNSYNCED"; }
  uint16_t flagBits() const { return state_ == T_UNSYNCED ? FL_TIME_UNSYNCED : state_ == T_ESTIMATED ? FL_TIME_ESTIMATED : 0; }
  static int64_t utcMs() { struct timeval tv; gettimeofday(&tv, nullptr); return (int64_t)tv.tv_sec * 1000 + tv.tv_usec / 1000; }
  static uint32_t monoMs() { return (uint32_t)(esp_timer_get_time() / 1000); }
  bool takeAnchor(uint32_t& mono, int64_t& utc) {
    if (!anchorPending_) return false;
    anchorPending_ = false; mono = g_anchorMono; utc = g_anchorUtc; return true;
  }
 private:
  TimeState state_ = T_UNSYNCED; volatile bool anchorPending_ = false;
};
