// NOR-flash simulator: erase = 0xFF per 4 KB sector; write can only clear bits (flags a violation if it would need a 0->1).
#pragma once
#include "Arduino.h"
typedef int esp_err_t;
#define ESP_OK 0
enum esp_partition_type_t { ESP_PARTITION_TYPE_DATA = 1 };
typedef int esp_partition_subtype_t;
struct esp_partition_t { size_t size; };
struct SimFlash {
  std::vector<uint8_t> mem; esp_partition_t part{}; long norViolations = 0, erases = 0;
  void init(size_t sectors) { mem.assign(sectors * 4096, 0xFF); part.size = mem.size(); norViolations = erases = 0; }
};
extern SimFlash g_flash;
inline const esp_partition_t* esp_partition_find_first(esp_partition_type_t, esp_partition_subtype_t, const char*) { return &g_flash.part; }
inline esp_err_t esp_partition_read(const esp_partition_t*, size_t off, void* dst, size_t n) { if (off + n > g_flash.mem.size()) return -1; memcpy(dst, &g_flash.mem[off], n); return ESP_OK; }
inline esp_err_t esp_partition_write(const esp_partition_t*, size_t off, const void* src, size_t n) {
  if (off + n > g_flash.mem.size()) return -1;
  const uint8_t* s = (const uint8_t*)src;
  for (size_t i = 0; i < n; i++) { uint8_t o = g_flash.mem[off + i]; if ((o & s[i]) != s[i]) g_flash.norViolations++; g_flash.mem[off + i] = o & s[i]; }
  return ESP_OK;
}
inline esp_err_t esp_partition_erase_range(const esp_partition_t*, size_t off, size_t n) {
  if (off % 4096 || n % 4096 || off + n > g_flash.mem.size()) return -1;
  memset(&g_flash.mem[off], 0xFF, n); g_flash.erases += n / 4096; return ESP_OK;
}
