// Host shim: just enough Arduino/FreeRTOS/ESP-IDF surface to compile ring_store.h and friends off-target.
#pragma once
#include <cstdint>
#include <cstring>
#include <cstdio>
#include <cstdlib>
#include <cmath>
#include <algorithm>
#include <string>
#include <map>
#include <vector>
using std::min; using std::max;
typedef void* SemaphoreHandle_t;
#define portMAX_DELAY 0xFFFFFFFFu
inline SemaphoreHandle_t xSemaphoreCreateRecursiveMutex() { return (void*)1; }
#define xSemaphoreTakeRecursive(m, t) ((void)(m), (void)(t))
#define xSemaphoreGiveRecursive(m) ((void)(m))
inline size_t strlcpy(char* d, const char* s, size_t n) { size_t l = strlen(s); if (n) { size_t c = l >= n ? n - 1 : l; memcpy(d, s, c); d[c] = 0; } return l; }
inline uint32_t millis() { return 0; }
#define SERIAL_8N1 0x800001c
struct HardwareSerial { void begin(...) {} int available() { return 0; } int read() { return 0; } size_t write(const uint8_t*, size_t) { return 0; } size_t readBytesUntil(char, char*, size_t) { return 0; } void setTimeout(int) {} };
static HardwareSerial Serial2;
inline void delay(int) {}
