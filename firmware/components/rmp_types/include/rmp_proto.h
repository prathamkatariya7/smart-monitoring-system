#pragma once
// Pure parsing helpers for the backend wire contract (docs/integration-guide.md).
// Ported from the Arduino prototype's proto_parse.h, but rewritten against cJSON (bundled
// with ESP-IDF's "json" component) instead of ArduinoJson, since the project no longer
// depends on Arduino. Logic and behaviour are otherwise unchanged; see test_host/test_proto.cpp.
#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>
#include "cJSON.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum { RMP_BOUND_UNKNOWN = 0, RMP_BOUND_BOUND = 1, RMP_BOUND_UNBOUND = 2 } rmp_bound_t;

// 8-4-4-4-12 hex UUID (deviceId and process_attempt are UUIDs on the backend)
bool rmp_looks_uuid(const char *s);

// cfg/desired: "binding": null -> UNBOUND (server drops our telemetry); object -> BOUND;
// key absent (or cfg not an object) -> UNKNOWN.
rmp_bound_t rmp_binding_state(const cJSON *cfg);

// cmd/set_calibration: { id, cmd, version, channel, method, coefficients:{a,b} }
// corrected = a*raw + b. Returns NULL when valid (a/b/ver are written), otherwise the
// rejection reason for ack/cmd (a/b/ver are left untouched).
const char *rmp_parse_calibration(const cJSON *d, float *a, float *b, uint16_t *ver);

// JSON number for a float that may be NaN/Inf (e.g. a failed PT100 read): snprintf would
// otherwise emit the invalid JSON token "nan"/"inf".
void rmp_fnum(char *out, size_t n, float v, const char *fmt);

#ifdef __cplusplus
}
#endif
