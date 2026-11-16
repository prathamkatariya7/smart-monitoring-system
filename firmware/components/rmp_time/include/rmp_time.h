#pragma once
#include <stdint.h>
#include <stdbool.h>
#include <time.h>
#include <sys/time.h>
#include "rmp_types.h"
#include "rmp_config.h"

namespace rmp {

enum TimeState : uint8_t {
  T_UNSYNCED  = 0,
  T_ESTIMATED = 1,
  T_SYNCED    = 2
};

class TimeSync {
 public:
  TimeSync();

  void begin(const char* primaryNtp);
  void poll();

  TimeState state() const { return state_; }
  const char* stateName() const;
  uint16_t flagBits() const;

  static int64_t utcMs();
  static uint32_t monoMs();

  bool takeAnchor(uint32_t& mono, int64_t& utc);

 private:
  TimeState state_ = T_UNSYNCED;
  bool anchorPending_ = false;
};

}  // namespace rmp

