#include "rmp_motor.h"
#include "rmp_pins.h"
#include "rmp_config.h"
#include <string.h>
#include <stdlib.h>
#include "driver/uart.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_timer.h"

namespace rmp {

namespace {
constexpr uart_port_t kUart = UART_NUM_2;
constexpr int kRxBufSize = 256;
}  // namespace

static inline uint32_t nowMs() { return (uint32_t)(esp_timer_get_time() / 1000); }

void HeiMotor::begin() {
  uart_config_t cfg = {};
  cfg.baud_rate = MOTOR_BAUD;
  cfg.data_bits = UART_DATA_8_BITS;
  cfg.parity = UART_PARITY_DISABLE;
  cfg.stop_bits = UART_STOP_BITS_1;
  cfg.flow_ctrl = UART_HW_FLOWCTRL_DISABLE;
  cfg.source_clk = UART_SCLK_DEFAULT;
  uart_driver_install(kUart, kRxBufSize, 0, 0, nullptr, 0);
  uart_param_config(kUart, &cfg);
  uart_set_pin(kUart, PIN_RS232_TX, PIN_RS232_RX, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE);
}

bool HeiMotor::poll(MotorData &d) {
  char line[48];
  bool ok = true;
  if (query(Q_SPEED, line, sizeof line)) d.rpm = firstNumber(line, ok); else ok = false;
  bool ok2 = true;
  if (query(Q_TORQUE, line, sizeof line)) d.tq_ncm = firstNumber(line, ok2) * MOTOR_TQ_SCALE_NCM; else ok2 = false;
  if (query(Q_FAULT, line, sizeof line)) d.flt = parseFault(line);
  return ok && ok2;
}

size_t HeiMotor::query(Query q, char *out, size_t n) {
  while (nowMs() - last_tx_ms_ < MOTOR_MIN_GAP_MS) vTaskDelay(pdMS_TO_TICKS(1));
  uart_flush_input(kUart);
  const char *c = CMD_TABLE[q];
  uart_write_bytes(kUart, c, strlen(c));
  uart_write_bytes(kUart, "\r\n", 2);
  last_tx_ms_ = nowMs();

  // Read until '\n' or timeout (60 ms, matches the prototype's Serial2.setTimeout(60)).
  size_t k = 0;
  int64_t deadline = esp_timer_get_time() + 60 * 1000;
  while (k < n - 1 && esp_timer_get_time() < deadline) {
    uint8_t ch = 0;
    int r = uart_read_bytes(kUart, &ch, 1, pdMS_TO_TICKS(5));
    if (r <= 0) continue;
    if (ch == '\n') break;
    if (ch != '\r') out[k++] = (char)ch;
  }
  out[k] = 0;
  return k;
}

float HeiMotor::firstNumber(const char *s, bool &ok) {
  while (*s && !((*s >= '0' && *s <= '9') || *s == '-' || *s == '+' || *s == '.')) s++;
  if (!*s) { ok = false; return 0; }
  return strtof(s, nullptr);
}

uint8_t HeiMotor::parseFault(const char *s) {  // [VERIFY] fault string format
  bool ok = true;
  float v = firstNumber(s, ok);
  if (ok) return (uint8_t)v;
  return (strstr(s, "rr") || strstr(s, "RR")) ? 1 : 0;
}

}  // namespace rmp
