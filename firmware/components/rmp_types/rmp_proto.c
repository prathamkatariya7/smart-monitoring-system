#include "rmp_proto.h"
#include <math.h>
#include <string.h>
#include <stdlib.h>
#include <stdio.h>

bool rmp_looks_uuid(const char *s) {
  if (!s || strlen(s) != 36) return false;
  for (int i = 0; i < 36; i++) {
    char c = s[i];
    if (i == 8 || i == 13 || i == 18 || i == 23) {
      if (c != '-') return false;
    } else if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'))) {
      return false;
    }
  }
  return true;
}

rmp_bound_t rmp_binding_state(const cJSON *cfg) {
  if (!cJSON_IsObject(cfg)) return RMP_BOUND_UNKNOWN;
  const cJSON *binding = cJSON_GetObjectItemCaseSensitive(cfg, "binding");
  if (!binding) return RMP_BOUND_UNKNOWN;
  return cJSON_IsObject(binding) ? RMP_BOUND_BOUND : RMP_BOUND_UNBOUND;
}

const char *rmp_parse_calibration(const cJSON *d, float *a, float *b, uint16_t *ver) {
  const cJSON *ch = cJSON_GetObjectItemCaseSensitive(d, "channel");
  const char *chan = (ch && cJSON_IsString(ch)) ? ch->valuestring : "temp1";
  if (strcmp(chan, "temp1") != 0) return "unsupported-channel";  // only one calibrated channel on this device

  const cJSON *co = cJSON_GetObjectItemCaseSensitive(d, "coefficients");
  const cJSON *ca = co ? cJSON_GetObjectItemCaseSensitive(co, "a") : NULL;
  const cJSON *cb = co ? cJSON_GetObjectItemCaseSensitive(co, "b") : NULL;
  float ra = (ca && cJSON_IsNumber(ca)) ? (float)ca->valuedouble : (float)NAN;
  float rb = (cb && cJSON_IsNumber(cb)) ? (float)cb->valuedouble : (float)NAN;
  if (!isfinite(ra) || !isfinite(rb)) return "no-coefficients";

  // guide shows a string, ack wants an integer: accept both
  const cJSON *vv = cJSON_GetObjectItemCaseSensitive(d, "version");
  uint32_t v = 0;
  if (vv && cJSON_IsNumber(vv)) {
    v = (uint32_t)vv->valuedouble;
  } else if (vv && cJSON_IsString(vv) && vv->valuestring) {
    // whole string must be numeric ("3f2a-..." is not version 3)
    const char *s = vv->valuestring;
    char *end = NULL;
    unsigned long x = strtoul(s, &end, 10);
    if (s[0] != '\0' && end && *end == '\0') v = (uint32_t)x;
  }
  if (v == 0 || v > 65535) return "bad-version";
  if (ra < 0.9f || ra > 1.1f || fabsf(rb) > 10.0f) return "out-of-range";

  *a = ra;
  *b = rb;
  *ver = (uint16_t)v;
  return NULL;
}

void rmp_fnum(char *out, size_t n, float v, const char *fmt) {
  if (isnan(v) || isinf(v)) {
    if (n) {
      size_t c = n - 1 < 4 ? n - 1 : 4;
      memcpy(out, "null", c);
      out[c] = 0;
    }
  } else {
    snprintf(out, n, fmt, (double)v);
  }
}
