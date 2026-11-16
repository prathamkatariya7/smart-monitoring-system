#pragma once
// DWIN DGUS II over UART1. The layout lives in the DWIN project; the P4 only writes VP values and
// switches pages (TDD 7.3). Frame: 5A A5 <len> <cmd> <addrH> <addrL> <data...>. [VERIFY] baud + VPs.
#include <Arduino.h>
#include "pins.h"
#include "config.h"

class Dwin {
 public:
  void begin() { Serial1.begin(DWIN_BAUD, SERIAL_8N1, PIN_DWIN_RX, PIN_DWIN_TX); }
  void page(uint16_t p) {
    uint8_t f[] = {0x5A, 0xA5, 0x07, 0x82, 0x00, 0x84, 0x5A, 0x01, (uint8_t)(p >> 8), (uint8_t)p};
    Serial1.write(f, sizeof f);
  }
  void writeI16(uint16_t vp, int16_t v) {
    uint8_t f[] = {0x5A, 0xA5, 0x05, 0x82, (uint8_t)(vp >> 8), (uint8_t)vp, (uint8_t)((uint16_t)v >> 8), (uint8_t)v};
    Serial1.write(f, sizeof f);
  }
  void writeText(uint16_t vp, const char* s, uint8_t maxLen = 24) {
    uint8_t n = strnlen(s, maxLen), f[5 + 32 + 2];
    f[0] = 0x5A; f[1] = 0xA5; f[2] = 3 + n + 2; f[3] = 0x82; f[4] = vp >> 8; f[5] = vp & 0xFF;
    memcpy(f + 6, s, n); f[6 + n] = 0xFF; f[7 + n] = 0xFF;   // 0xFFFF terminator
    Serial1.write(f, 8 + n);
  }
  // Never show a stale or invalid reading: BAD / missing -> dashes (7.4)
  void showReadings(float t, bool tOk, float rpm, float tq, bool motorOk) {
    char b[16];
    if (tOk) writeI16(VP_TEMP, (int16_t)lroundf(t * 10.0f)); else writeText(VP_TEMP, "---");
    if (motorOk) { writeI16(VP_RPM, (int16_t)lroundf(rpm)); writeI16(VP_TORQUE, (int16_t)lroundf(tq * 10.0f)); }
    else { writeText(VP_RPM, "---"); writeText(VP_TORQUE, "---"); }
    (void)b;
  }
};
