#pragma once
// Heidolph Hei-TORQUE RS232, READ-ONLY (TDD 7.5). The driver can only send commands from the
// allow-list enum below; there is no API that accepts an arbitrary string. Reply formats are [VERIFY].
#include <Arduino.h>
#include "pins.h"
#include "config.h"

struct MotorData { float rpm = 0, tq_ncm = 0; uint8_t flt = 0; };

class HeiMotor {
 public:
  enum Query : uint8_t { Q_SPEED, Q_TORQUE, Q_FAULT, Q_MOTOR_TEMP, Q_TYPE, Q_SERIAL, Q_TIMER, Q__COUNT };
  static constexpr const char* CMD_TABLE[Q__COUNT] = {"r", "m", "f", "t", "T", "Q", "z"};

  void begin() { Serial2.begin(MOTOR_BAUD, SERIAL_8N1, PIN_RS232_RX, PIN_RS232_TX); Serial2.setTimeout(60); }

  // r + m every cycle, f every cycle if there is time. Returns true when speed AND torque were read.
  bool poll(MotorData& d) {
    char line[48]; bool ok = true;
    if (query(Q_SPEED, line, sizeof line)) d.rpm = firstNumber(line, ok); else ok = false;
    bool ok2 = true;
    if (query(Q_TORQUE, line, sizeof line)) d.tq_ncm = firstNumber(line, ok2) * MOTOR_TQ_SCALE_NCM; else ok2 = false;
    if (query(Q_FAULT, line, sizeof line)) d.flt = parseFault(line);
    return ok && ok2;
  }
  bool query(Query q, char* out, size_t n) {
    while (millis() - lastTx_ < MOTOR_MIN_GAP_MS) delay(1);
    while (Serial2.available()) Serial2.read();
    const char* c = CMD_TABLE[q];
    Serial2.write((const uint8_t*)c, strlen(c)); Serial2.write((const uint8_t*)"\r\n", 2);
    lastTx_ = millis();
    size_t k = Serial2.readBytesUntil('\n', out, n - 1); out[k] = 0;
    return k > 0;
  }
 private:
  uint32_t lastTx_ = 0;
  static float firstNumber(const char* s, bool& ok) {
    while (*s && !((*s >= '0' && *s <= '9') || *s == '-' || *s == '+' || *s == '.')) s++;
    if (!*s) { ok = false; return 0; }
    return strtof(s, nullptr);
  }
  static uint8_t parseFault(const char* s) {   // [VERIFY] fault string format
    bool ok = true; float v = firstNumber(s, ok);
    if (ok) return (uint8_t)v;
    return (strstr(s, "rr") || strstr(s, "RR")) ? 1 : 0;
  }
};

// TDD 7.5 read-only allow-list: r speed, m torque, f fault, t motor temp, T type, Q serial, z timer.
// Compile-time guard: the build FAILS if anything else is ever put in the command table (TDD T-17 "unit test fails the build").
constexpr bool heiTableIsAllowListed() {
  const char allowed[] = {'r', 'm', 'f', 't', 'T', 'Q', 'z'};
  for (int i = 0; i < HeiMotor::Q__COUNT; i++) {
    const char* c = HeiMotor::CMD_TABLE[i];
    if (c[0] == 0 || c[1] != 0) return false;   // exactly one character
    bool ok = false;
    for (char a : allowed) if (c[0] == a) ok = true;
    if (!ok) return false;
  }
  return true;
}
static_assert(heiTableIsAllowListed(), "Heidolph command table contains a command outside the read-only allow-list");
