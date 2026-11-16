#pragma once
#include "Arduino.h"
extern std::map<std::string, uint32_t> g_nvs;   // survives a simulated reboot
class Preferences {
  std::string ns_;
 public:
  bool begin(const char* ns, bool = false) { ns_ = ns; return true; }
  void end() {}
  uint32_t getUInt(const char* k, uint32_t d) { auto it = g_nvs.find(ns_ + "/" + k); return it == g_nvs.end() ? d : it->second; }
  size_t putUInt(const char* k, uint32_t v) { g_nvs[ns_ + "/" + k] = v; return 4; }
};
