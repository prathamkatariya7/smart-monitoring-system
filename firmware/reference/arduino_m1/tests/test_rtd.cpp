// Checks Max31865::cvd() (Callendar-Van Dusen) against the IEC 60751 PT100 table, and the raw-code -> resistance path.
#include "Arduino.h"
#define OUTPUT 1
#define INPUT_PULLUP 2
#define HIGH 1
#define LOW 0
#define MSBFIRST 1
#define SPI_MODE1 1
inline void pinMode(int, int) {} inline void digitalWrite(int, int) {} inline int digitalRead(int) { return 0; }
struct SPISettings { SPISettings(long, int, int) {} };
struct SPIClass { void begin(int, int, int, int) {} void beginTransaction(SPISettings) {} void endTransaction() {} uint8_t transfer(uint8_t) { return 0; } };
static SPIClass SPI;
struct String { std::string s; String(const char* c) : s(c) {} };
#include "pins.h"
#include "config.h"
#include "rtd_max31865.h"
int main() {
  struct { float t, r; } tab[] = {{-200, 18.52f}, {-100, 60.26f}, {-50, 80.31f}, {0, 100.00f}, {25, 109.73f}, {50, 119.40f},
                                  {100, 138.51f}, {150, 157.33f}, {200, 175.86f}, {250, 194.10f}, {300, 212.05f}};
  int bad = 0; float worst = 0;
  for (auto& p : tab) { float t = Max31865::cvd(p.r); float e = t - p.t; if (fabsf(e) > worst) worst = fabsf(e);
    bool ok = fabsf(e) <= 0.15f; if (!ok) bad++;
    printf("  R=%7.2f ohm  table %7.1f C  computed %8.3f C  err %+.3f %s\n", p.r, p.t, t, e, ok ? "" : "<-- OUT"); }
  // MAX31865 code path: 15-bit ADC, Rt = code * Rref / 32768. 100 ohm with Rref 400 -> code 8192
  float r = (float)8192 * RTD_RREF / 32768.0f; printf("  code 8192 -> %.3f ohm -> %.3f C (expect 100 ohm / 0 C)\n", r, Max31865::cvd(r));
  printf("worst error %.3f C over the table; %s\n", worst, bad ? "FAIL" : "PASS");
  return bad ? 1 : 0;
}
