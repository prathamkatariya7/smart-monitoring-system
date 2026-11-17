#include "rmp_motor.h"
#include "rmp_pins.h"
#include "rmp_config.h"
#include <ctype.h>
#include <stdlib.h>
#include <string.h>
#include "driver/uart.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_timer.h"

namespace rmp {
namespace {
constexpr uart_port_t kUart = UART_NUM_2;
constexpr int kRxBufSize = 256;
constexpr uint32_t kReplyTimeoutMs = 120;
constexpr uint8_t kRedetectAfterFailures = 3;
}
static inline uint32_t nowMs() { return (uint32_t)(esp_timer_get_time() / 1000); }

const char *motorTypeName(MotorType type) {
  switch (type) { case MotorType::HEIDOLPH: return "HEIDOLPH"; case MotorType::IKA: return "IKA"; default: return "UNKNOWN"; }
}
const char *motorProtocolName(MotorProtocol protocol) {
  switch (protocol) { case MotorProtocol::HEIDOLPH_RS232_9600_8N1: return "HEIDOLPH_RS232_9600_8N1"; case MotorProtocol::IKA_RS232_9600_7E1: return "IKA_RS232_9600_7E1"; default: return "NONE"; }
}
void MotorManager::begin() {
  if (!uart_installed_) {
    uart_driver_install(kUart, kRxBufSize, 0, 0, nullptr, 0);
    uart_set_pin(kUart, PIN_RS232_TX, PIN_RS232_RX, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE);
    uart_installed_ = true;
  }
  identity_ = {};
  identity_changed_ = false;
  consecutive_failures_ = 0;
  detect();
}
void MotorManager::configureHeidolph() {
  uart_config_t cfg = {};
  cfg.baud_rate = 9600; cfg.data_bits = UART_DATA_8_BITS; cfg.parity = UART_PARITY_DISABLE;
  cfg.stop_bits = UART_STOP_BITS_1; cfg.flow_ctrl = UART_HW_FLOWCTRL_DISABLE; cfg.source_clk = UART_SCLK_DEFAULT;
  uart_param_config(kUart, &cfg); uart_flush_input(kUart);
}
void MotorManager::configureIka() {
  uart_config_t cfg = {};
  cfg.baud_rate = 9600; cfg.data_bits = UART_DATA_7_BITS; cfg.parity = UART_PARITY_EVEN;
  cfg.stop_bits = UART_STOP_BITS_1; cfg.flow_ctrl = UART_HW_FLOWCTRL_DISABLE; cfg.source_clk = UART_SCLK_DEFAULT;
  uart_param_config(kUart, &cfg); uart_flush_input(kUart);
}
size_t MotorManager::queryLine(const char *command, char *out, size_t n) {
  if (!command || !out || n < 2) return 0;
  while ((uint32_t)(nowMs() - last_tx_ms_) < MOTOR_MIN_GAP_MS) vTaskDelay(pdMS_TO_TICKS(1));
  uart_flush_input(kUart); uart_write_bytes(kUart, command, strlen(command)); uart_write_bytes(kUart, "\r\n", 2); last_tx_ms_ = nowMs();
  size_t k = 0; int64_t deadline = esp_timer_get_time() + (int64_t)kReplyTimeoutMs * 1000;
  while (k < n - 1 && esp_timer_get_time() < deadline) {
    uint8_t ch = 0; int r = uart_read_bytes(kUart, &ch, 1, pdMS_TO_TICKS(5));
    if (r <= 0) continue; if (ch == '\n') break;
    if (ch >= 0x20 && ch <= 0x7E && ch != '"' && ch != '\\') out[k++] = (char)ch;
  }
  out[k] = 0; return k;
}
bool MotorManager::looksLikeIka(const char *s) {
  if (!s) return false; char lower[64] = {}; size_t i = 0;
  for (; s[i] && i < sizeof(lower) - 1; ++i) lower[i] = (char)tolower((unsigned char)s[i]);
  lower[i] = 0; return strstr(lower, "ika") != nullptr || strstr(lower, "eurostar") != nullptr;
}
void MotorManager::copySafe(char *dst, size_t n, const char *src) {
  if (!dst || n == 0) return; size_t i = 0; if (src) for (; src[i] && i < n - 1; ++i) dst[i] = src[i]; dst[i] = 0;
}
bool MotorManager::setIdentity(MotorType type, MotorProtocol protocol, const char *model, const char *serial) {
  MotorIdentity next{}; next.type = type; next.protocol = protocol; next.detected = true;
  copySafe(next.manufacturer, sizeof(next.manufacturer), motorTypeName(type));
  copySafe(next.model, sizeof(next.model), model && model[0] ? model : "UNKNOWN_MODEL");
  copySafe(next.serial, sizeof(next.serial), serial ? serial : "");
  bool changed = !identity_.detected || identity_.type != next.type || identity_.protocol != next.protocol || strcmp(identity_.model, next.model) != 0 || strcmp(identity_.serial, next.serial) != 0;
  identity_ = next; if (changed) identity_changed_ = true; return true;
}
bool MotorManager::detect() {
  if (!uart_installed_) return false; char line[80] = {};
  // IKA EUROSTAR documented read-only interface: 9600 7E1, IN_NAME and IN_PV_4/5.
  configureIka();
  if (queryLine("IN_NAME", line, sizeof(line)) && looksLikeIka(line)) {
    char speed[48] = {}, torque[48] = {}; bool speedOk = queryLine("IN_PV_4", speed, sizeof(speed)) > 0; bool torqueOk = queryLine("IN_PV_5", torque, sizeof(torque)) > 0; bool n1 = false, n2 = false;
    firstNumber(speed, n1); firstNumber(torque, n2);
    if (speedOk && torqueOk && n1 && n2) { setIdentity(MotorType::IKA, MotorProtocol::IKA_RS232_9600_7E1, line, ""); consecutive_failures_ = 0; next_detect_ms_ = nowMs() + 5000; return true; }
  }
  // Heidolph read-only T (type) and Q (serial) probe.
  configureHeidolph(); char model[80] = {}, serial[80] = {};
  if (queryLine(HEI_COMMANDS[Q_TYPE], model, sizeof(model)) && queryLine(HEI_COMMANDS[Q_SERIAL], serial, sizeof(serial))) {
    setIdentity(MotorType::HEIDOLPH, MotorProtocol::HEIDOLPH_RS232_9600_8N1, model, serial); consecutive_failures_ = 0; next_detect_ms_ = nowMs() + 5000; return true;
  }
  identity_ = {}; next_detect_ms_ = nowMs() + 5000; return false;
}
bool MotorManager::poll(MotorData &d) {
  d = {};
  if (!identity_.detected && (int32_t)(nowMs() - next_detect_ms_) >= 0)
    if (!detect()) return false;
  bool ok = identity_.type == MotorType::IKA ? pollIka(d) : pollHeidolph(d);
  if (ok) { consecutive_failures_ = 0; d.valid = true; return true; }
  if (++consecutive_failures_ >= kRedetectAfterFailures) { identity_ = {}; next_detect_ms_ = nowMs(); }
  return false;
}
bool MotorManager::pollIka(MotorData &d) {
  char line[80] = {}; bool rpmOk = false, torqueOk = false;
  if (queryLine("IN_PV_4", line, sizeof(line))) d.rpm = firstNumber(line, rpmOk);
  if (queryLine("IN_PV_5", line, sizeof(line))) d.tq_ncm = firstNumber(line, torqueOk);
  d.flt = 0; return rpmOk && torqueOk;
}
bool MotorManager::pollHeidolph(MotorData &d) {
  char line[80] = {}; bool rpmOk = false, torqueOk = false;
  if (queryLine(HEI_COMMANDS[Q_SPEED], line, sizeof(line))) d.rpm = firstNumber(line, rpmOk);
  if (queryLine(HEI_COMMANDS[Q_TORQUE], line, sizeof(line))) d.tq_ncm = firstNumber(line, torqueOk) * MOTOR_TQ_SCALE_NCM;
  if (queryLine(HEI_COMMANDS[Q_FAULT], line, sizeof(line))) d.flt = parseFault(line);
  return rpmOk && torqueOk;
}
float MotorManager::firstNumber(const char *s, bool &ok) {
  while (*s && !((*s >= '0' && *s <= '9') || *s == '-' || *s == '+' || *s == '.')) ++s;
  if (!*s) { ok = false; return 0; } char *end = nullptr; float value = strtof(s, &end); ok = end != s; return ok ? value : 0;
}
uint8_t MotorManager::parseFault(const char *s) { bool ok = true; float v = firstNumber(s, ok); if (ok) return (uint8_t)v; return (strstr(s, "rr") || strstr(s, "RR")) ? 1 : 0; }
}  // namespace rmp
