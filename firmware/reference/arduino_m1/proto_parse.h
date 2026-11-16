#pragma once
// Pure parsing helpers for the backend wire contract (Firmware Integration Guide, 2026-11-07).
// Depends only on ArduinoJson, so it is unit-tested on the host (tests/test_proto.cpp).
#include <ArduinoJson.h>
#include <math.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

namespace proto {

enum Bound : uint8_t { B_UNKNOWN = 0, B_BOUND = 1, B_UNBOUND = 2 };

// 8-4-4-4-12 hex UUID (deviceId and process_attempt are UUIDs on the backend)
inline bool looksUuid(const char* s) {
  if (!s || strlen(s) != 36) return false;
  for (int i = 0; i < 36; i++) {
    char c = s[i];
    if (i == 8 || i == 13 || i == 18 || i == 23) { if (c != '-') return false; }
    else if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'))) return false;
  }
  return true;
}

// cfg/desired: "binding": null  -> UNBOUND (server drops our telemetry);  object -> BOUND;  key absent -> UNKNOWN.
inline Bound bindingState(JsonVariantConst cfg) {
  JsonObjectConst o = cfg.as<JsonObjectConst>();
  if (o.isNull()) return B_UNKNOWN;
  for (JsonPairConst kv : o) {
    if (strcmp(kv.key().c_str(), "binding") == 0) return kv.value().is<JsonObjectConst>() ? B_BOUND : B_UNBOUND;
  }
  return B_UNKNOWN;
}

// cmd/set_calibration: { id, cmd, version, channel, method, coefficients:{a,b} }  corrected = a*raw + b
// Returns nullptr when valid, otherwise the rejection reason for ack/cmd.
inline const char* parseCalibration(JsonVariantConst d, float& a, float& b, uint16_t& ver) {
  const char* ch = d["channel"] | "temp1";
  if (strcmp(ch, "temp1") != 0) return "unsupported-channel";          // only one calibrated channel on this device
  JsonVariantConst co = d["coefficients"];
  float ra = co["a"] | NAN, rb = co["b"] | NAN;
  if (!isfinite(ra) || !isfinite(rb)) return "no-coefficients";
  uint32_t v = 0; JsonVariantConst vv = d["version"];                   // guide shows a string, ack wants an integer: accept both
  if (vv.is<uint32_t>()) v = vv.as<uint32_t>();
  else if (vv.is<const char*>()) {                                      // whole string must be numeric ("3f2a-..." is not version 3)
    const char* s = vv.as<const char*>(); char* end = nullptr; unsigned long x = strtoul(s, &end, 10);
    if (*s && end && *end == 0) v = (uint32_t)x;
  }
  if (v == 0 || v > 65535) return "bad-version";
  if (ra < 0.9f || ra > 1.1f || fabsf(rb) > 10.0f) return "out-of-range";
  a = ra; b = rb; ver = (uint16_t)v; return nullptr;
}

// JSON number for a float that may be NaN/Inf (a failed PT100 read): printf would emit the invalid token "nan".
inline void fnum(char* out, size_t n, float v, const char* fmt) {
  if (isnan(v) || isinf(v)) strlcpy(out, "null", n); else snprintf(out, n, fmt, (double)v);
}

}  // namespace proto
