#pragma once
// Heidolph Hei-TORQUE RS232, READ-ONLY (SPEC.md section 8, rule 5: "the Heidolph driver
// can only send the read-only commands. Do not add a write command"). Ported from the
// Arduino prototype's motor_hei.h (reference/arduino_m1/motor_hei.h), rehosted off
// Arduino's Serial2/HardwareSerial onto ESP-IDF's driver/uart.h. Reply formats and the
// torque scale are [VERIFY] -- see rmp_config.h and the console `motor` command, which
// deliberately prints the raw, unparsed reply alongside the best-effort parse so the
// real format can be captured on the bench.
#include <stdint.h>
#include <stddef.h>

namespace rmp {

struct MotorData {
  float rpm = 0;
  float tq_ncm = 0;
  uint8_t flt = 0;
};

class HeiMotor {
 public:
  enum Query : uint8_t { Q_SPEED, Q_TORQUE, Q_FAULT, Q_MOTOR_TEMP, Q_TYPE, Q_SERIAL, Q_TIMER, Q__COUNT };
  static constexpr const char *CMD_TABLE[Q__COUNT] = {"r", "m", "f", "t", "T", "Q", "z"};

  void begin();

  // r + m every cycle, f every cycle if there is time. Returns true when speed AND torque were read.
  bool poll(MotorData &d);

  // Sends one allow-listed query and returns the raw reply line (not parsed). Returns
  // the reply length, or 0 on timeout/no reply. `out` is NUL-terminated either way.
  size_t query(Query q, char *out, size_t n);

 private:
  uint32_t last_tx_ms_ = 0;
  static float firstNumber(const char *s, bool &ok);
  static uint8_t parseFault(const char *s);
};

}  // namespace rmp

// Compile-time guard: the build FAILS if anything other than the read-only allow-list
// (r speed, m torque, f fault, t motor temp, T type, Q serial, z timer) is ever put in
// the command table. Matches the Arduino prototype's guard byte-for-byte.
constexpr bool rmpHeiTableIsAllowListed() {
  const char allowed[] = {'r', 'm', 'f', 't', 'T', 'Q', 'z'};
  for (int i = 0; i < rmp::HeiMotor::Q__COUNT; i++) {
    const char *c = rmp::HeiMotor::CMD_TABLE[i];
    if (c[0] == 0 || c[1] != 0) return false;  // exactly one character
    bool ok = false;
    for (char a : allowed) if (c[0] == a) ok = true;
    if (!ok) return false;
  }
  return true;
}
static_assert(rmpHeiTableIsAllowListed(), "Heidolph command table contains a command outside the read-only allow-list");
