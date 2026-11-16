// g++ -std=c++17 -I /tmp/claude-0/aj/ArduinoJson/src -I .. test_proto.cpp
#include <stdio.h>
#include <string.h>
#include <string>
#include <ArduinoJson.h>
#include "../proto_parse.h"
using namespace proto;
static int fails = 0;
#define CHECK(c) do { if (!(c)) { printf("FAIL line %d: %s\n", __LINE__, #c); fails++; } } while (0)
static JsonDocument doc(const char* j) { JsonDocument d; DeserializationError e = deserializeJson(d, j); if (e) printf("bad json in test\n"); return d; }

int main() {
  float a = 0, b = 0; uint16_t v = 0;
  // exactly the shape in the integration guide 6.2 (version is a string there)
  JsonDocument d = doc("{\"id\":\"x\",\"cmd\":\"set_calibration\",\"version\":\"7\",\"channel\":\"temp1\",\"method\":\"two_point\",\"coefficients\":{\"a\":1.02,\"b\":-0.4}}");
  CHECK(parseCalibration(d, a, b, v) == nullptr); CHECK(fabsf(a - 1.02f) < 1e-6 && fabsf(b + 0.4f) < 1e-6 && v == 7);
  d = doc("{\"version\":3,\"channel\":\"temp1\",\"coefficients\":{\"a\":1,\"b\":0}}");           // integer version, integer coefficients
  CHECK(parseCalibration(d, a, b, v) == nullptr); CHECK(a == 1.0f && b == 0.0f && v == 3);
  d = doc("{\"version\":3,\"a\":1.02,\"b\":-0.4}");                                              // old flat shape must NOT silently apply
  CHECK(!strcmp(parseCalibration(d, a, b, v), "no-coefficients"));
  d = doc("{\"version\":\"3f2a-uuid\",\"coefficients\":{\"a\":1,\"b\":0}}");
  CHECK(!strcmp(parseCalibration(d, a, b, v), "bad-version"));
  d = doc("{\"version\":2,\"coefficients\":{\"a\":1.5,\"b\":0}}");
  CHECK(!strcmp(parseCalibration(d, a, b, v), "out-of-range"));
  d = doc("{\"version\":2,\"channel\":\"temp2\",\"coefficients\":{\"a\":1,\"b\":0}}");
  CHECK(!strcmp(parseCalibration(d, a, b, v), "unsupported-channel"));
  // a failed reject must leave the outputs untouched
  a = 5; d = doc("{\"version\":2,\"coefficients\":{\"a\":1.5,\"b\":0}}"); parseCalibration(d, a, b, v); CHECK(a == 5);

  // cfg/desired binding
  d = doc("{\"version\":3,\"binding\":{\"equipmentId\":\"e\",\"reactorNumber\":\"R-12\"},\"thresholds\":null}");
  CHECK(bindingState(d) == B_BOUND);
  d = doc("{\"version\":3,\"binding\":null}");  CHECK(bindingState(d) == B_UNBOUND);
  d = doc("{\"version\":3}");                   CHECK(bindingState(d) == B_UNKNOWN);
  d = doc("[1,2]");                             CHECK(bindingState(d) == B_UNKNOWN);

  CHECK(looksUuid("0b9f3c52-7a41-4d0e-9a55-6c1e2f8d7b10"));
  CHECK(!looksUuid("0b9f3c52-7a41-4d0e-9a55-6c1e2f8d7b1"));     // 35 chars
  CHECK(!looksUuid("0b9f3c527a41-4d0e-9a55-6c1e2f8d7b10-"));    // misplaced hyphens
  CHECK(!looksUuid("zb9f3c52-7a41-4d0e-9a55-6c1e2f8d7b10"));
  CHECK(!looksUuid("") && !looksUuid(nullptr));

  // NaN must never reach the wire as the invalid token "nan"
  char o[16];
  fnum(o, sizeof o, NAN, "%.2f"); CHECK(!strcmp(o, "null"));
  fnum(o, sizeof o, INFINITY, "%.2f"); CHECK(!strcmp(o, "null"));
  fnum(o, sizeof o, 35.2f, "%.2f"); CHECK(!strcmp(o, "35.20"));
  { char row[64]; char t[16]; fnum(t, sizeof t, NAN, "%.2f"); snprintf(row, sizeof row, "[1,%s]", t);
    JsonDocument r; CHECK(!deserializeJson(r, row)); CHECK(r[0][1].isNull()); }

  printf(fails ? "FAILED %d\n" : "ALL PASS\n", fails); return fails != 0;
}
