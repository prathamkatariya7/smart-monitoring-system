#include "rmp_rtd.h"
#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "rmp_config.h"
#include "rmp_pins.h"
#include <math.h>
#include <stdio.h>
#include <string.h>

// MAX31865 driver for PT100 (2-wire, Rref=430Ω, R0=100Ω) over ESP-IDF spi_master.
//
// The key lesson from bench testing:
//  - Use tx_buffer/rx_buffer pointers (NOT SPI_TRANS_USE_TXDATA/RXDATA) on ESP32-P4
//    with the digital isolator in the signal path.  SPI_TRANS_USE_TXDATA breaks writes
//    through the isolator even though reads appear fine.
//  - Fault recovery: when bit-0 of the RTD register is set, clear the fault registers
//    and retry ONE time before returning the fault code.  This prevents a single transient
//    spike (e.g. at 180 °C) from permanently locking out the driver.
//  - Only unseat g_rtd_ok on a complete SPI-no-response (0xFF), not on every RTD fault.

namespace rmp {

namespace {
constexpr spi_host_device_t kSpiHost = SPI2_HOST;
constexpr int kClockHz = 1000000; // 1 MHz, mode 1 — matches the Arduino prototype
} // namespace

static inline spi_device_handle_t dev(void *p) {
  return static_cast<spi_device_handle_t>(p);
}

// ---------------------------------------------------------------------------
// begin()
// ---------------------------------------------------------------------------
bool Rtd::begin() {
  // Configure DRDY as input with pull-up (active-low, asserted when conversion done)
  gpio_config_t drdy_cfg = {};
  drdy_cfg.pin_bit_mask = 1ULL << PIN_RTD_DRDY;
  drdy_cfg.mode         = GPIO_MODE_INPUT;
  drdy_cfg.pull_up_en   = GPIO_PULLUP_ENABLE;
  gpio_config(&drdy_cfg);

  // Only initialise the SPI bus + device once; guard against repeated begin() calls
  // that happen when the driver auto-retries after a transient fault.
  if (!spi_device_) {
    spi_bus_config_t bus_cfg = {};
    bus_cfg.mosi_io_num   = PIN_RTD_MOSI;
    bus_cfg.miso_io_num   = PIN_RTD_MISO;
    bus_cfg.sclk_io_num   = PIN_RTD_SCK;
    bus_cfg.quadwp_io_num = -1;
    bus_cfg.quadhd_io_num = -1;
    bus_cfg.max_transfer_sz = 16;
    esp_err_t err = spi_bus_initialize(kSpiHost, &bus_cfg, SPI_DMA_DISABLED);
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
      ESP_LOGE("rmp_rtd", "spi_bus_initialize failed: %s (%d)", esp_err_to_name(err), err);
      return false;
    }

    spi_device_interface_config_t dev_cfg = {};
    dev_cfg.mode          = 1; // CPOL=0, CPHA=1 — required by MAX31865
    dev_cfg.clock_speed_hz = kClockHz;
    dev_cfg.spics_io_num  = PIN_RTD_CS;
    dev_cfg.queue_size    = 1;
    dev_cfg.cs_ena_pretrans = 1;  // Give digital isolator 1 clock setup time for CS
    dev_cfg.cs_ena_posttrans = 1; // Give digital isolator 1 clock hold time for CS
    spi_device_handle_t handle = nullptr;
    err = spi_bus_add_device(kSpiHost, &dev_cfg, &handle);
    if (err != ESP_OK) {
      ESP_LOGE("rmp_rtd", "spi_bus_add_device failed: %s (%d)", esp_err_to_name(err), err);
      return false;
    }
    spi_device_ = handle;
    ESP_LOGI("rmp_rtd", "SPI initialized successfully, dev_handle=%p", spi_device_);
  }

  // Fault threshold registers — set to maximum range so only genuine
  // open-circuit / under-voltage faults are ever latched.
  wr8(0x03, 0xFF); // High fault threshold MSB = 0xFF
  wr8(0x04, 0xFF); // High fault threshold LSB = 0xFF
  wr8(0x05, 0x00); // Low  fault threshold MSB = 0x00
  wr8(0x06, 0x00); // Low  fault threshold LSB = 0x00

  // Config: VBIAS on (0x80) | Auto-convert (0x40) | 50 Hz filter (0x01) | 2-wire
  cfg_ = 0x80 | 0x40 | 0x01 | (RTD_WIRES == 3 ? 0x10 : 0x00);
  // Write config with fault-clear bit (0x02) set simultaneously
  wr8(0x00, cfg_ | 0x02);
  vTaskDelay(pdMS_TO_TICKS(100)); // Allow bias + first conversion to settle

  uint8_t c = rd8(0x00);
  ESP_LOGI("rmp_rtd", "begin: cfg readback=0x%02X (expected 0x%02X, masked=0x%02X), h_th=0x%04X",
           c, cfg_, c & 0xD1, rd16(0x03));
  return ((c & 0xD1) == (cfg_ & 0xD1));
}

// ---------------------------------------------------------------------------
// read()  — returns 0 on success, 0xFF on no SPI response, or fault register
// ---------------------------------------------------------------------------
uint8_t Rtd::read(float &tC, float &rOhm) {
  uint16_t raw = rd16(0x01);

  // 0x0000 or 0xFFFF means the SPI lines are not talking to the chip at all
  if (raw == 0x0000 || raw == 0xFFFF)
    return 0xFF;

  if (raw & 1) {
    // Fault bit is set.  Read the fault register, then clear it and retry once.
    uint8_t f = rd8(0x07);
    ESP_LOGW("rmp_rtd",
             "RTD fault 0x%02X at raw=0x%04X — resetting thresholds and clearing",
             f, raw);

    // Re-assert maximum thresholds (may have been corrupted by transient)
    wr8(0x03, 0xFF);
    wr8(0x04, 0xFF);
    wr8(0x05, 0x00);
    wr8(0x06, 0x00);

    // Clear fault bit in config register (write cfg_ | 0x02, then restore cfg_)
    wr8(0x00, cfg_ | 0x02);
    vTaskDelay(pdMS_TO_TICKS(50));
    wr8(0x00, cfg_); // Restore auto-convert + VBIAS without clear bit

    // One retry after clearing
    raw = rd16(0x01);
    if (raw & 1) {
      ESP_LOGW("rmp_rtd", "fault persists after clear (f=0x%02X), reporting", f);
      return f ? f : 0xFE;
    }
  }

  raw >>= 1; // Drop fault bit to get 15-bit ADC code
  rOhm = (float)raw * RTD_RREF / 32768.0f;
  tC   = cvd(rOhm);

  ESP_LOGD("rmp_rtd", "T=%.2f°C  R=%.3fΩ  raw=0x%04X", tC, rOhm, raw);
  return 0;
}

// ---------------------------------------------------------------------------
// Callendar-Van Dusen temperature from resistance (IEC 60751)
// ---------------------------------------------------------------------------
float Rtd::cvd(float rt) {
  const float A = 3.9083e-3f, B = -5.775e-7f, R0 = RTD_R0;
  const float Z1 = -A, Z2 = A*A - 4*B, Z3 = 4*B/R0, Z4 = 2*B;
  float t = (sqrtf(Z2 + Z3*rt) + Z1) / Z4;
  if (t >= 0.0f) return t;

  // Polynomial for sub-zero temperatures
  float r = rt / R0 * 100.0f, p = r;
  t  = -242.02f;
  t +=  2.2228f   * p; p *= r;
  t +=  2.5859e-3f * p; p *= r;
  t -= 4.8260e-6f  * p; p *= r;
  t -= 2.8183e-8f  * p; p *= r;
  t +=  1.5243e-10f * p;
  return t;
}

// ---------------------------------------------------------------------------
// regs() — bench diagnostic: dump key registers
// ---------------------------------------------------------------------------
void Rtd::regs(char *out, size_t n) {
  snprintf(out, n,
           "MAX31865 cfg=0x%02X rtd_raw=0x%04X h_th=0x%04X l_th=0x%04X fault=0x%02X",
           rd8(0x00), rd16(0x01), rd16(0x03), rd16(0x05), rd8(0x07));
}

// ---------------------------------------------------------------------------
// Low-level SPI helpers — always use tx_buffer / rx_buffer pointers.
// SPI_TRANS_USE_TXDATA/RXDATA breaks writes through the digital isolator on
// this board (confirmed by write-test: wrote 0xAA, readback always returned
// the unchanged register value).
// ---------------------------------------------------------------------------

uint8_t Rtd::rd8(uint8_t reg) {
  uint8_t v = 0;
  xfer(reg & 0x7F, &v, 1);
  return v;
}

uint16_t Rtd::rd16(uint8_t reg) {
  uint8_t b[2] = {0, 0};
  xfer(reg & 0x7F, b, 2);
  return (uint16_t)((b[0] << 8) | b[1]);
}

void Rtd::wr8(uint8_t reg, uint8_t v) {
  // Set bit 7 of the address byte to signal a write operation to MAX31865
  uint8_t tx[2] = {(uint8_t)((reg & 0x7F) | 0x80), v};
  uint8_t rx[2] = {0, 0};
  spi_transaction_t t = {};
  t.length    = 8 * 2;   // 16 bits total
  t.tx_buffer = tx;
  t.rx_buffer = rx;
  esp_err_t err = spi_device_transmit(dev(spi_device_), &t);
  if (err != ESP_OK) {
    ESP_LOGE("rmp_rtd", "wr8(0x%02X, 0x%02X) failed: %s (%d)", reg, v, esp_err_to_name(err), err);
  }
}

void Rtd::xfer(uint8_t reg, uint8_t *out, size_t n) {
  // First byte TX = register address (read: bit 7 = 0)
  // Following TX bytes = 0x00 dummy clocks to shift in MISO data
  uint8_t tx[1 + 8] = {0}; // up to 8 data bytes; plenty for rd8/rd16
  uint8_t rx[1 + 8] = {0};
  tx[0] = reg & 0x7F;      // read flag: bit 7 = 0
  spi_transaction_t t = {};
  t.length    = 8 * (1 + n);
  t.tx_buffer = tx;
  t.rx_buffer = rx;
  esp_err_t err = spi_device_transmit(dev(spi_device_), &t);
  if (err != ESP_OK) {
    ESP_LOGE("rmp_rtd", "xfer(0x%02X) failed: %s (%d)", reg, esp_err_to_name(err), err);
  }
  memcpy(out, rx + 1, n);  // Skip the dummy byte at rx[0]
}

} // namespace rmp
