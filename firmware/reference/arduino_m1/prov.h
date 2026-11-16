#pragma once
// Provisioning data in NVS namespace "prov". Factory flow (TDD 3.4) writes these; milestone 1
// lets you set them from the serial console (see RMP_Firmware.ino "help").
#include <Arduino.h>
#include <Preferences.h>

struct Prov {
  String devid, host, ntp, ca, cert, key; uint16_t port = 8883;

  static String getBlobStr(Preferences& p, const char* k) {
    size_t n = p.getBytesLength(k); if (!n) return "";
    char* b = (char*)malloc(n + 1); if (!b) return "";
    p.getBytes(k, b, n); b[n] = 0; String s(b); free(b); return s;
  }
  void load() {
    Preferences p; p.begin("prov", true);
    devid = p.getString("devid", ""); host = p.getString("host", "auto"); port = p.getUShort("port", 8883);
    ntp = p.getString("ntp", ""); ca = getBlobStr(p, "ca"); cert = getBlobStr(p, "cert"); key = getBlobStr(p, "key");
    p.end();
  }
  void setStr(const char* k, const String& v) { Preferences p; p.begin("prov", false); p.putString(k, v); p.end(); }
  void setBlob(const char* k, const String& v) { Preferences p; p.begin("prov", false); p.putBytes(k, v.c_str(), v.length()); p.end(); }
  bool complete() const { return devid.length() && ca.length() && cert.length() && key.length(); }
};
