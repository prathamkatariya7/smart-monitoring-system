#pragma once
#include <stdint.h>
#include <stdbool.h>
#include "rmp_ring.h"

namespace rmp {

typedef void (*AckDataCallback)(uint16_t boot, uint32_t upto_seq);
typedef void (*CfgDesiredCallback)(const char *json, size_t len);

struct MqttConfig {
  const char *device_id;       // UUID used in every topic (rmp/v1/{deviceId}/...)
  const char *broker_uri;      // e.g. "mqtts://10.138.201.92:18883"
  const char *ca_cert_pem;     // NUL-terminated PEM
  const char *client_cert_pem;
  const char *client_key_pem;
  const char *fw_version;
  AckDataCallback on_ack_data; // called when server sends ack/data
  CfgDesiredCallback on_cfg_desired; // called when server publishes cfg/desired
};

class Mqtt {
 public:
  bool begin(const MqttConfig &cfg);
  bool isConnected() const;

  // state birth/heartbeat message (integration guide 5.1)
  void publishState(const char *link, uint32_t boot);

  // Columnar batch telemetry (integration guide 5.2). Sends to tele/batch or tele/backlog
  bool publishBatch(const RingStore::View &v, bool backlog, const char *link);

  // One-row tele/batch (bench helper)
  void publishTeleRow(uint32_t boot, uint32_t seq, uint32_t mono_ms, float t, float t_raw,
                       float rpm, float tq, const char *q, uint8_t flt, uint16_t fl);

  // Discrete events (e.g. DEVICE_REBOOT, TIME_ANCHOR, GAP)
  void publishEvent(const char *type, uint32_t boot, uint32_t mono, int64_t ts, bool synced, const char *detailJson);
};

}  // namespace rmp
