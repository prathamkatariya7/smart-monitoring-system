#pragma once
// Read-only RS-232 motor integration for Heidolph Hei-TORQUE and IKA EUROSTAR
// control. Detection never sends START/STOP/RESET or any OUT_* command.
#include <stdint.h>
#include <stddef.h>

namespace rmp {

enum class MotorType : uint8_t { UNKNOWN = 0, HEIDOLPH = 1, IKA = 2 };

enum class MotorProtocol : uint8_t {
  NONE = 0,
  HEIDOLPH_RS232_9600_8N1 = 1,
  IKA_RS232_9600_7E1 = 2,
};

struct MotorIdentity {
  MotorType type = MotorType::UNKNOWN;
  MotorProtocol protocol = MotorProtocol::NONE;
  char manufacturer[16] = "";
  char model[48] = "";
  // IKA's documented command set does not expose the type-plate serial number;
  // keep this empty until a serial is supplied by commissioning metadata.
  char serial[48] = "";
  bool detected = false;
};

struct MotorData {
  float rpm = 0;
  float tq_ncm = 0;
  uint8_t flt = 0;
  bool valid = false;
};

class MotorManager {
 public:
  void begin();
  // Poll the selected motor using read-only commands. If the link is absent or
  // fails repeatedly, the manager re-enters detection and can safely recognize
  // a hot-swapped motor without issuing a control command.
  bool poll(MotorData &d);
  bool detect();
  const MotorIdentity &identity() const { return identity_; }
  bool identityChanged() const { return identity_changed_; }
  void clearIdentityChanged() { identity_changed_ = false; }

 private:
  enum Query : uint8_t { Q_SPEED, Q_TORQUE, Q_FAULT, Q_TYPE, Q_SERIAL, Q__COUNT };
  static constexpr const char *HEI_COMMANDS[Q__COUNT] = {"r", "m", "f", "T", "Q"};

  void configureHeidolph();
  void configureIka();
  size_t queryLine(const char *command, char *out, size_t n);
  bool pollHeidolph(MotorData &d);
  bool pollIka(MotorData &d);
  bool setIdentity(MotorType type, MotorProtocol protocol, const char *model,
                   const char *serial);
  static float firstNumber(const char *s, bool &ok);
  static uint8_t parseFault(const char *s);
  static void copySafe(char *dst, size_t n, const char *src);
  static bool looksLikeIka(const char *s);

  MotorIdentity identity_{};
  uint32_t last_tx_ms_ = 0;
  uint32_t next_detect_ms_ = 0;
  uint8_t consecutive_failures_ = 0;
  bool identity_changed_ = false;
  bool uart_installed_ = false;
};

// Compatibility alias for existing call sites; new code should use MotorManager.
using HeiMotor = MotorManager;

const char *motorTypeName(MotorType type);
const char *motorProtocolName(MotorProtocol protocol);

}  // namespace rmp
