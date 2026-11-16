#pragma once
// Four active-low buttons: Menu, Up, Down, Select. 25 ms debounce.
// Events: SHORT (<600 ms, on release), LONG (>=1.5 s, while held), HOLD3 (>=3 s, destructive actions only).
#include <Arduino.h>
#include "pins.h"

enum BtnEvt : uint8_t { BE_SHORT = 1, BE_LONG = 2, BE_HOLD3 = 3 };
struct BtnMsg { uint8_t id; BtnEvt e; };   // id: 0 Menu, 1 Up, 2 Down, 3 Select

class Buttons {
 public:
  void begin() { for (int i = 0; i < 4; i++) pinMode(pins_[i], INPUT_PULLUP); }
  void poll() {   // call every ~5 ms
    uint32_t now = millis();
    for (int i = 0; i < 4; i++) {
      bool raw = digitalRead(pins_[i]) == LOW;
      if (raw != s_[i].raw) { s_[i].raw = raw; s_[i].t = now; }
      if (now - s_[i].t < 25 || raw == s_[i].stable) { if (s_[i].stable) hold(i, now); continue; }
      s_[i].stable = raw;
      if (raw) { s_[i].down = now; s_[i].sentLong = s_[i].sentHold = false; }
      else if (!s_[i].sentLong && !s_[i].sentHold && now - s_[i].down < 600) push(i, BE_SHORT);
    }
  }
  bool get(BtnMsg& m) { if (rd_ == wr_) return false; m = q_[rd_++ & 7]; return true; }
 private:
  struct S { bool raw = false, stable = false, sentLong = false, sentHold = false; uint32_t t = 0, down = 0; };
  const uint8_t pins_[4] = {PIN_BTN_MENU, PIN_BTN_UP, PIN_BTN_DOWN, PIN_BTN_SELECT};
  S s_[4]; BtnMsg q_[8]; uint8_t rd_ = 0, wr_ = 0;
  void push(int i, BtnEvt e) { q_[wr_++ & 7] = {(uint8_t)i, e}; }
  void hold(int i, uint32_t now) {
    uint32_t d = now - s_[i].down;
    if (!s_[i].sentLong && d >= 1500) { s_[i].sentLong = true; push(i, BE_LONG); }
    if (!s_[i].sentHold && d >= 3000) { s_[i].sentHold = true; push(i, BE_HOLD3); }
  }
};
