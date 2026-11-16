#pragma once
// ES8311 codec + NS4150B amplifier (I2C GPIO7/8, I2S 9/10/11/12/13, PA enable GPIO53).
// Disabled by default (ENABLE_AUDIO 0): the register sequence follows the common ES8311 slave-mode
// init for 16 kHz / MCLK = 256 x fs and MUST be verified on the bench. Alert logic (silence /
// override gating) sits in one place: Audio::setMuted().
#include <Arduino.h>
#include <Wire.h>
#include <ESP_I2S.h>
#include <math.h>
#include "pins.h"

class Audio {
 public:
  bool begin() {
    pinMode(PIN_PA_CTRL, OUTPUT); digitalWrite(PIN_PA_CTRL, LOW);
    Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL, 400000);
    i2s_.setPins(PIN_I2S_BCLK, PIN_I2S_WS, PIN_I2S_DOUT, PIN_I2S_DIN, PIN_I2S_MCLK);
    if (!i2s_.begin(I2S_MODE_STD, 16000, I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_STEREO, I2S_STD_SLOT_BOTH)) return false;
    return codecInit();
  }
  void setMuted(bool m) { muted_ = m; if (m) digitalWrite(PIN_PA_CTRL, LOW); }
  void beep(uint16_t hz, uint16_t ms) {
    if (muted_) return;
    digitalWrite(PIN_PA_CTRL, HIGH);
    int16_t buf[256]; uint32_t total = 16000UL * ms / 1000, done = 0; static float ph = 0;
    while (done < total) {
      uint32_t n = min<uint32_t>(128, total - done);
      for (uint32_t i = 0; i < n; i++) { int16_t s = (int16_t)(sinf(ph) * 9000); buf[2 * i] = buf[2 * i + 1] = s; ph += 2 * PI * hz / 16000.0f; if (ph > 2 * PI) ph -= 2 * PI; }
      i2s_.write((uint8_t*)buf, n * 4); done += n;
    }
    digitalWrite(PIN_PA_CTRL, LOW);
  }
 private:
  I2SClass i2s_; bool muted_ = false; uint8_t addr_ = 0x18;
  bool w(uint8_t r, uint8_t v) { Wire.beginTransmission(addr_); Wire.write(r); Wire.write(v); return Wire.endTransmission() == 0; }
  bool codecInit() {
    Wire.beginTransmission(addr_); if (Wire.endTransmission() != 0) { addr_ = 0x19; Wire.beginTransmission(addr_); if (Wire.endTransmission() != 0) return false; }
    w(0x00, 0x1F); delay(20); w(0x00, 0x00); w(0x00, 0x80);   // reset, then power on (slave mode)
    w(0x01, 0x3F);                                           // clocks on, MCLK from pin
    w(0x02, 0x00); w(0x03, 0x10); w(0x04, 0x10); w(0x05, 0x00);   // dividers for MCLK 4.096 MHz, fs 16 kHz
    w(0x06, 0x03); w(0x07, 0x00); w(0x08, 0xFF);
    w(0x09, 0x0C); w(0x0A, 0x0C);                            // I2S, 16-bit
    w(0x0D, 0x01); w(0x0E, 0x02); w(0x12, 0x00); w(0x13, 0x10);
    w(0x1C, 0x6A); w(0x37, 0x08); w(0x32, 0xBF);             // ADC EQ bypass, DAC EQ bypass, DAC volume
    return true;
  }
};
