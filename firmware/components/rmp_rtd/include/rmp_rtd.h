#pragma once
// MAX31865 + PT100 (IEC 60751, Callendar-Van Dusen) over ESP-IDF's native spi_master
// driver. SPI mode 1, 50 Hz filter, auto-convert. Ported from the Arduino prototype's
// rtd_max31865.h (reference/arduino_m1/rtd_max31865.h) -- same register sequence and
// CVD math, rehosted off Arduino's SPIClass onto driver/spi_master.h + driver/gpio.h.
//
// RTD_RREF is 430 ohm on this board (owner-confirmed 2026-11-09), not the prototype's
// 400 ohm default -- see components/rmp_types/include/rmp_config.h.
#include <stdint.h>
#include <stddef.h>
#include "rmp_config.h"

namespace rmp {

class Rtd {
 public:
  // Initializes SPI2 + the CS/DRDY GPIOs and the MAX31865 config register.
  // Returns false if the read-back sanity check fails (no response / wrong config).
  bool begin();

  // Returns 0 = OK, 0xFF = no SPI response, otherwise the MAX31865 fault status register.
  // On success, tC/rOhm are the measured temperature (deg C) and resistance (ohm).
  uint8_t read(float &tC, float &rOhm);

  // Callendar-Van Dusen conversion, resistance (ohm) -> temperature (deg C).
  // Pure math, independent of Rref -- unchanged from the prototype, already host-tested
  // in test_host/test_rtd.cpp against the IEC 60751 table (worst error 0.013 C).
  static float cvd(float rOhm);

  // Bench helper: dumps the configuration, raw RTD register and fault status registers.
  void regs(char *out, size_t n);

 private:
  uint8_t cfg_ = (uint8_t)(0x80 | 0x40 | 0x01 | (RTD_WIRES == 3 ? 0x10 : 0x00));
  void *spi_device_ = nullptr;  // spi_device_handle_t, opaque here to avoid a driver/spi_master.h include in the public header

  uint8_t rd8(uint8_t reg);
  uint16_t rd16(uint8_t reg);
  void wr8(uint8_t reg, uint8_t v);
  void xfer(uint8_t reg, uint8_t *out, size_t n);
};

}  // namespace rmp
