#include "rmp_buttons.h"
#include "rmp_pins.h"
#include "driver/gpio.h"
#include "esp_timer.h"

namespace rmp {

namespace {
constexpr gpio_num_t kPins[4] = {(gpio_num_t)PIN_BTN_MENU, (gpio_num_t)PIN_BTN_UP,
                                  (gpio_num_t)PIN_BTN_DOWN, (gpio_num_t)PIN_BTN_SELECT};
}  // namespace

static inline uint32_t nowMs() { return (uint32_t)(esp_timer_get_time() / 1000); }

void Buttons::begin() {
  for (int i = 0; i < 4; i++) {
    gpio_config_t cfg = {};
    cfg.pin_bit_mask = 1ULL << kPins[i];
    cfg.mode = GPIO_MODE_INPUT;
    cfg.pull_up_en = GPIO_PULLUP_ENABLE;  // internal pull-up; harmless where the board already has one (Menu/Up)
    gpio_config(&cfg);
  }
}

void Buttons::poll() {
  uint32_t now = nowMs();
  for (int i = 0; i < 4; i++) {
    bool raw = gpio_get_level(kPins[i]) == 0;  // active-low
    if (raw != s_[i].raw) { s_[i].raw = raw; s_[i].t = now; }
    if (now - s_[i].t < 25) {
      if (s_[i].stable) hold(i, now);
      continue;
    }
    if (raw == s_[i].stable) {
      if (s_[i].stable) hold(i, now);
      continue;
    }
    s_[i].stable = raw;
    if (raw) {
      s_[i].down = now;
      s_[i].sent_long = s_[i].sent_hold = s_[i].sent_repeat = false;
      s_[i].next_repeat = now + 500;
    } else if (!s_[i].sent_long && !s_[i].sent_hold && now - s_[i].down < 600) {
      push(i, BE_SHORT);
    }
  }
}

bool Buttons::get(BtnMsg &m) {
  if (rd_ == wr_) return false;
  m = q_[rd_++ & 7];
  return true;
}

void Buttons::push(int i, BtnEvt e) {
  // Repeated navigation events are best-effort. Never discard a SELECT/MODE
  // edge or a safety hold because a stuck key filled the small queue.
  if ((uint8_t)(wr_ - rd_) >= 8) {
    if (e == BE_REPEAT) return;
    ++rd_;
  }
  q_[wr_++ & 7] = {(uint8_t)i, e};
}

void Buttons::hold(int i, uint32_t now) {
  uint32_t d = now - s_[i].down;
  if ((i == 1 || i == 2) && d >= 500) {
    if (!s_[i].sent_repeat || now >= s_[i].next_repeat) {
      push(i, BE_REPEAT);
      s_[i].sent_repeat = true;
      s_[i].next_repeat = now + 150;
    }
  }
  if (!s_[i].sent_long && d >= 1500) { s_[i].sent_long = true; push(i, BE_LONG); }
  if (!s_[i].sent_hold && d >= 3000) { s_[i].sent_hold = true; push(i, BE_HOLD3); }
}

}  // namespace rmp
