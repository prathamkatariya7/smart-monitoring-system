#pragma once
// MAX31865 + PT100 (IEC 60751, Callendar-Van Dusen). SPI mode 1, 50 Hz filter, auto-convert.
#include <Arduino.h>
#include <SPI.h>
#include <math.h>
#include "pins.h"
#include "config.h"

class Max31865 {
 public:
  bool begin() {
    pinMode(PIN_RTD_CS, OUTPUT); digitalWrite(PIN_RTD_CS, HIGH);
    pinMode(PIN_RTD_DRDY, INPUT_PULLUP);
    spi_.begin(PIN_RTD_SCK, PIN_RTD_MISO, PIN_RTD_MOSI, -1);   // default SPI host, pins routed through the GPIO matrix
    cfg_ = 0x80 | 0x40 | 0x01 | (RTD_WIRES == 3 ? 0x10 : 0x00);   // bias on, auto, 50 Hz, wires
    wr8(0x00, cfg_ | 0x02);   // clear any latched fault
    delay(100);
    return (rd8(0x00) & 0xD1) == cfg_;   // read-back sanity check
  }
  // returns 0 = OK, 0xFF = no SPI response, otherwise the MAX31865 fault status register
  uint8_t read(float& tC, float& rOhm) {
    uint16_t raw = rd16(0x01);
    if (raw == 0x0000 || raw == 0xFFFF) return 0xFF;
    if (raw & 1) { uint8_t f = rd8(0x07); wr8(0x00, (rd8(0x00) & 0xD1) | 0x02); return f ? f : 0xFE; }
    raw >>= 1; rOhm = (float)raw * RTD_RREF / 32768.0f; tC = cvd(rOhm); return 0;
  }
  static float cvd(float rt) {
    const float A = 3.9083e-3f, B = -5.775e-7f, R0 = RTD_R0;
    float Z1 = -A, Z2 = A * A - 4 * B, Z3 = 4 * B / R0, Z4 = 2 * B;
    float t = (sqrtf(Z2 + Z3 * rt) + Z1) / Z4;
    if (t >= 0) return t;
    float r = rt / R0 * 100.0f, p = r;                                  // below 0 degC: polynomial fit
    t = -242.02f; t += 2.2228f * p; p *= r; t += 2.5859e-3f * p; p *= r; t -= 4.8260e-6f * p;
    p *= r; t -= 2.8183e-8f * p; p *= r; t += 1.5243e-10f * p; return t;
  }
  String regs() {   // bench helper: configuration, raw RTD register and fault status
    char b[96]; snprintf(b, sizeof b, "MAX31865 cfg=0x%02X rtd_raw=0x%04X fault=0x%02X (0x0000/0xFFFF raw = no SPI response)", rd8(0x00), rd16(0x01), rd8(0x07));
    return String(b);
  }
 private:
  SPIClass& spi_ = SPI; uint8_t cfg_ = 0;   // global SPI object: avoids guessing FSPI/HSPI numbering on the P4 core
  uint8_t rd8(uint8_t reg) { uint8_t v; xfer(reg & 0x7F, &v, 1); return v; }
  uint16_t rd16(uint8_t reg) { uint8_t b[2]; xfer(reg & 0x7F, b, 2); return (b[0] << 8) | b[1]; }
  void wr8(uint8_t reg, uint8_t v) {
    spi_.beginTransaction(SPISettings(1000000, MSBFIRST, SPI_MODE1));
    digitalWrite(PIN_RTD_CS, LOW); spi_.transfer(reg | 0x80); spi_.transfer(v); digitalWrite(PIN_RTD_CS, HIGH);
    spi_.endTransaction();
  }
  void xfer(uint8_t reg, uint8_t* out, size_t n) {
    spi_.beginTransaction(SPISettings(1000000, MSBFIRST, SPI_MODE1));
    digitalWrite(PIN_RTD_CS, LOW); spi_.transfer(reg);
    for (size_t i = 0; i < n; i++) out[i] = spi_.transfer(0x00);
    digitalWrite(PIN_RTD_CS, HIGH); spi_.endTransaction();
  }
};
