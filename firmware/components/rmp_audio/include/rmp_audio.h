#pragma once
// ES8311 codec + NS4150B amplifier (I2C GPIO7/8, I2S GPIO9/10/11/12/13, PA enable
// GPIO53). Uses Espressif's official es8311 I2C control driver (esp-bsp) instead of
// hand-porting the Arduino prototype's raw register sequence -- see rmp_audio.cpp.
// Alert tone design (docs/SPEC.md has no spec for this -- see the project's own
// decision log): three priority tiers informed by IEC 60601-1-8's principles
// (distinguish priority by burst count + pitch, keep the fundamental in the
// 150-1000 Hz audible range) without claiming certification to that medical standard.
#include <stdint.h>
#include <stdbool.h>

namespace rmp {

enum class AlertLevel { kOff, kLow, kMedium, kHigh };

class Audio {
 public:
  bool begin();
  void setMuted(bool m);

  // Plays one tone burst, blocking for its duration. Low-level primitive -- alertTask
  // in app_main uses this to build the repeating patterns in setAlert().
  void beep(uint16_t hz, uint16_t ms);

  // Same as beep(), but does NOT touch PA_CTRL -- for bench diagnostics only (console
  // `tone` command), to test PA_CTRL polarity independently via the `pa 0`/`pa 1` command.
  void beepRaw(uint16_t hz, uint16_t ms);
};

}  // namespace rmp
