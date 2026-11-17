// Host test for rmp_proto (components/rmp_types), rewritten against cJSON instead of
// ArduinoJson (see docs/SPEC.md decision: project no longer depends on Arduino).
// Same cases as the Arduino prototype's tests/test_proto.cpp.
// Built/run via test_host/run_tests.ps1.
#include <stdio.h>
#include <string.h>
#include <math.h>
#include "cJSON.h"
#include "rmp_proto.h"

static int fails = 0;
#define CHECK(c) do { if (!(c)) { printf("FAIL line %d: %s\n", __LINE__, #c); fails++; } } while (0)

static cJSON *doc(const char *j) {
  cJSON *d = cJSON_Parse(j);
  if (!d) printf("bad json in test: %s\n", j);
  return d;
}

int main() {
  float a = 0, b = 0;
  uint16_t v = 0;

  // exactly the shape in the integration guide 6.2 (version is a string there)
  cJSON *d = doc("{\"id\":\"x\",\"cmd\":\"set_calibration\",\"version\":\"7\",\"channel\":\"temp1\",\"method\":\"two_point\",\"coefficients\":{\"a\":1.02,\"b\":-0.4}}");
  CHECK(rmp_parse_calibration(d, &a, &b, &v) == NULL);
  CHECK(fabsf(a - 1.02f) < 1e-6 && fabsf(b + 0.4f) < 1e-6 && v == 7);
  cJSON_Delete(d);

  d = doc("{\"version\":3,\"channel\":\"temp1\",\"coefficients\":{\"a\":1,\"b\":0}}");  // integer version, integer coefficients
  CHECK(rmp_parse_calibration(d, &a, &b, &v) == NULL);
  CHECK(a == 1.0f && b == 0.0f && v == 3);
  cJSON_Delete(d);

  d = doc("{\"version\":3,\"a\":1.02,\"b\":-0.4}");  // old flat shape must NOT silently apply
  CHECK(!strcmp(rmp_parse_calibration(d, &a, &b, &v), "no-coefficients"));
  cJSON_Delete(d);

  d = doc("{\"version\":\"3f2a-uuid\",\"coefficients\":{\"a\":1,\"b\":0}}");
  CHECK(!strcmp(rmp_parse_calibration(d, &a, &b, &v), "bad-version"));
  cJSON_Delete(d);

  d = doc("{\"version\":2,\"coefficients\":{\"a\":1.5,\"b\":0}}");
  CHECK(!strcmp(rmp_parse_calibration(d, &a, &b, &v), "out-of-range"));
  cJSON_Delete(d);

  d = doc("{\"version\":2,\"channel\":\"temp2\",\"coefficients\":{\"a\":1,\"b\":0}}");
  CHECK(!strcmp(rmp_parse_calibration(d, &a, &b, &v), "unsupported-channel"));
  cJSON_Delete(d);

  // a failed reject must leave the outputs untouched
  a = 5;
  d = doc("{\"version\":2,\"coefficients\":{\"a\":1.5,\"b\":0}}");
  rmp_parse_calibration(d, &a, &b, &v);
  CHECK(a == 5);
  cJSON_Delete(d);

  // cfg/desired binding
  d = doc("{\"version\":3,\"binding\":{\"equipmentId\":\"e\",\"reactorNumber\":\"R-12\"},\"thresholds\":null}");
  CHECK(rmp_binding_state(d) == RMP_BOUND_BOUND);
  cJSON_Delete(d);

  d = doc("{\"version\":3,\"binding\":null}");
  CHECK(rmp_binding_state(d) == RMP_BOUND_UNBOUND);
  cJSON_Delete(d);

  d = doc("{\"version\":3}");
  CHECK(rmp_binding_state(d) == RMP_BOUND_UNKNOWN);
  cJSON_Delete(d);

  d = doc("[1,2]");
  CHECK(rmp_binding_state(d) == RMP_BOUND_UNKNOWN);
  cJSON_Delete(d);

  CHECK(rmp_looks_uuid("0b9f3c52-7a41-4d0e-9a55-6c1e2f8d7b10"));
  CHECK(!rmp_looks_uuid("0b9f3c52-7a41-4d0e-9a55-6c1e2f8d7b1"));   // 35 chars
  CHECK(!rmp_looks_uuid("0b9f3c527a41-4d0e-9a55-6c1e2f8d7b10-"));  // misplaced hyphens
  CHECK(!rmp_looks_uuid("zb9f3c52-7a41-4d0e-9a55-6c1e2f8d7b10"));
  CHECK(!rmp_looks_uuid("") && !rmp_looks_uuid(NULL));

  // NaN/Inf must never reach the wire as the invalid token "nan"/"inf"
  char o[16];
  rmp_fnum(o, sizeof o, NAN, "%.2f");
  CHECK(!strcmp(o, "null"));
  rmp_fnum(o, sizeof o, INFINITY, "%.2f");
  CHECK(!strcmp(o, "null"));
  rmp_fnum(o, sizeof o, 35.2f, "%.2f");
  CHECK(!strcmp(o, "35.20"));
  {
    char row[64];
    char t[16];
    rmp_fnum(t, sizeof t, NAN, "%.2f");
    snprintf(row, sizeof row, "[1,%s]", t);
    cJSON *r = cJSON_Parse(row);
    CHECK(r != NULL);
    cJSON *elem1 = cJSON_GetArrayItem(r, 1);
    CHECK(cJSON_IsNull(elem1));
    cJSON_Delete(r);
  }

  printf(fails ? "FAILED %d\n" : "ALL PASS\n", fails);
  return fails != 0;
}
