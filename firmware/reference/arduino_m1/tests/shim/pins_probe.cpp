#include "Arduino.h"
struct HardwareSerial { void begin(...) {} int available() { return 0; } int read() { return 0; } size_t write(const uint8_t*, size_t) { return 0; } size_t readBytesUntil(char, char*, size_t) { return 0; } void setTimeout(int) {} };
static HardwareSerial Serial2;
inline void delay(int) {}
#include "../../pins.h"
#include "../../rmp_types.h"
#include "../../config.h"
#include "../../motor_hei.h"
int main() { return 0; }
