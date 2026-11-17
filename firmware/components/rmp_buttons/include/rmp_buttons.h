#pragma once
// Four active-low buttons: MODE, UP, DOWN, SELECT. 25 ms debounce.
// Events: SHORT (<600 ms, on release), LONG (>=1.5 s, while held), HOLD3 (>=3 s, held),
// and REPEAT (after 0.5 s, every 150 ms for UP/DOWN while held).
// Ported from the Arduino prototype's buttons.h (reference/arduino_m1/buttons.h),
// rehosted off Arduino's pinMode/digitalRead onto ESP-IDF's driver/gpio.h. Logic
// unchanged.
#include <stdint.h>

namespace rmp {

enum BtnEvt : uint8_t { BE_SHORT = 1, BE_LONG = 2, BE_HOLD3 = 3, BE_REPEAT = 4 };
struct BtnMsg {
  uint8_t id;  // 0 MODE, 1 UP, 2 DOWN, 3 SELECT
  BtnEvt e;
};

class Buttons {
 public:
  void begin();
  void poll();  // call every ~5 ms
  bool get(BtnMsg &m);

 private:
  struct S {
    bool raw = false, stable = false, sent_long = false, sent_hold = false;
    bool sent_repeat = false;
    uint32_t t = 0, down = 0, next_repeat = 0;
  };
  S s_[4];
  BtnMsg q_[8];
  uint8_t rd_ = 0, wr_ = 0;

  void push(int i, BtnEvt e);
  void hold(int i, uint32_t now);
};

}  // namespace rmp
