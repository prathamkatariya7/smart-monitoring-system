#include "rmp_mqtt.h"
#include <string.h>
#include <math.h>
#include <stdio.h>
#include <inttypes.h>
#include "mqtt_client.h"
#include "esp_log.h"
#include "esp_heap_caps.h"

namespace rmp {

namespace {
constexpr char kTag[] = "rmp_mqtt";
constexpr int kOutboxLimitBytes = 4096;

esp_mqtt_client_handle_t s_client = nullptr;
bool s_connected = false;
char s_device_id[40] = {0};
char s_fw_version[32] = "0.1.0-idf-m1";
AckDataCallback s_on_ack_data = nullptr;
CfgDesiredCallback s_on_cfg_desired = nullptr;

void buildTopic(char *out, size_t n, const char *suffix) {
  snprintf(out, n, "rmp/v1/%s/%s", s_device_id, suffix);
}

// Formats a float as a JSON number, or "null" if not finite.
static int fmtFloat(char *buf, size_t n, float v) {
  if (isfinite(v)) return snprintf(buf, n, "%.2f", v);
  return snprintf(buf, n, "null");
}

void eventHandler(void *, esp_event_base_t, int32_t event_id, void *event_data) {
  auto *event = (esp_mqtt_event_handle_t)event_data;
  switch ((esp_mqtt_event_id_t)event_id) {
    case MQTT_EVENT_CONNECTED: {
      s_connected = true;
      ESP_LOGI(kTag, "connected to broker (free heap: %" PRIu32 ")",
               (uint32_t)esp_get_free_heap_size());
      char topic[64];
      buildTopic(topic, sizeof topic, "cmd/+");
      esp_mqtt_client_subscribe(s_client, topic, 1);
      buildTopic(topic, sizeof topic, "cfg/desired");
      esp_mqtt_client_subscribe(s_client, topic, 1);
      buildTopic(topic, sizeof topic, "ack/data");
      esp_mqtt_client_subscribe(s_client, topic, 1);
      break;
    }
    case MQTT_EVENT_DISCONNECTED:
      s_connected = false;
      ESP_LOGW(kTag, "disconnected from broker");
      break;
    case MQTT_EVENT_DATA: {
      if (event->topic_len > 0 && event->topic) {
        if (event->topic_len >= 8 && strncmp(event->topic + event->topic_len - 8, "ack/data", 8) == 0 && s_on_ack_data) {
          int boot = 0;
          long long upto_seq = 0;
          if (event->data && event->data_len > 0) {
            char payload[128];
            int cplen = event->data_len < (int)sizeof(payload) - 1 ? event->data_len : (int)sizeof(payload) - 1;
            memcpy(payload, event->data, cplen);
            payload[cplen] = '\0';
            const char *b_str = strstr(payload, "\"boot\":");
            const char *s_str = strstr(payload, "\"upto_seq\":");
            if (b_str) sscanf(b_str + 7, "%d", &boot);
            if (s_str) sscanf(s_str + 11, "%lld", &upto_seq);
            if (boot > 0 && upto_seq > 0) {
              s_on_ack_data((uint16_t)boot, (uint32_t)upto_seq);
            }
          }
        } else if (event->topic_len >= 11 && strncmp(event->topic + event->topic_len - 11, "cfg/desired", 11) == 0 && s_on_cfg_desired) {
          s_on_cfg_desired(event->data, event->data_len);
        }
      }
      break;
    }
    case MQTT_EVENT_ERROR:
      ESP_LOGW(kTag, "mqtt error, tls_last_esp_err=0x%x, transport_sock_errno=%d",
               event->error_handle->esp_tls_last_esp_err, event->error_handle->esp_transport_sock_errno);
      break;
    default:
      break;
  }
}

}  // namespace

bool Mqtt::begin(const MqttConfig &cfg) {
  strncpy(s_device_id, cfg.device_id, sizeof(s_device_id) - 1);
  if (cfg.fw_version) strncpy(s_fw_version, cfg.fw_version, sizeof(s_fw_version) - 1);
  s_on_ack_data = cfg.on_ack_data;
  s_on_cfg_desired = cfg.on_cfg_desired;

  char lwt_topic[64];
  buildTopic(lwt_topic, sizeof lwt_topic, "state");

  esp_mqtt_client_config_t mqtt_cfg = {};
  mqtt_cfg.broker.address.uri = cfg.broker_uri;
  mqtt_cfg.broker.verification.certificate = cfg.ca_cert_pem;
  mqtt_cfg.broker.verification.skip_cert_common_name_check = true;
  mqtt_cfg.credentials.authentication.certificate = cfg.client_cert_pem;
  mqtt_cfg.credentials.authentication.key = cfg.client_key_pem;
  mqtt_cfg.credentials.client_id = cfg.device_id;
  mqtt_cfg.session.protocol_ver = MQTT_PROTOCOL_V_5;
  mqtt_cfg.session.disable_clean_session = true;  // clean_start=false (integration guide 6.1)
  mqtt_cfg.session.keepalive = 30;
  mqtt_cfg.session.last_will.topic = lwt_topic;
  mqtt_cfg.session.last_will.msg = "{\"online\":false}";
  mqtt_cfg.session.last_will.qos = 1;
  mqtt_cfg.session.last_will.retain = 1;

  mqtt_cfg.buffer.size = 2048;       // receive buffer
  mqtt_cfg.buffer.out_size = 4096;   // transmit buffer for batches
  mqtt_cfg.outbox.limit = kOutboxLimitBytes;

  s_client = esp_mqtt_client_init(&mqtt_cfg);
  if (!s_client) return false;
  esp_mqtt_client_register_event(s_client, MQTT_EVENT_ANY, eventHandler, nullptr);
  return esp_mqtt_client_start(s_client) == ESP_OK;
}

bool Mqtt::isConnected() const { return s_connected; }

void Mqtt::publishState(const char *link, uint32_t boot) {
  if (!s_connected) return;
  char body[128];
  snprintf(body, sizeof body,
           "{\"online\":true,\"link\":\"%s\",\"boot\":%" PRIu32 ",\"fw\":\"%s\"}",
           link ? link : "wifi", boot, s_fw_version);
  char topic[64];
  buildTopic(topic, sizeof topic, "state");
  esp_mqtt_client_publish(s_client, topic, body, 0, 1, 0);
}

bool Mqtt::publishBatch(const RingStore::View &v, bool backlog, const char *link) {
  if (!s_connected || v.n == 0) return false;

  static char s_batch_buf[4096];
  int pos = 0;
  int rem = sizeof(s_batch_buf);

  char attempt_str[48] = "null";
  if (v.hdr.attempt[0] != '\0') {
    snprintf(attempt_str, sizeof(attempt_str), "\"%s\"", v.hdr.attempt);
  }

  int n = snprintf(s_batch_buf + pos, rem,
    "{\"v\":1,\"boot\":%u,\"attempt\":%s,\"cal\":%u,\"fw\":\"%s\",\"link\":\"%s\",\"tsync\":%u,"
    "\"f\":[\"seq\",\"mono\",\"t\",\"t_raw\",\"rpm\",\"tq\",\"q\",\"flt\",\"fl\"],"
    "\"d\":[",
    (unsigned)v.hdr.boot, attempt_str, (unsigned)v.hdr.cal, s_fw_version,
    link ? link : "wifi", (unsigned)(v.hdr.tsync == 2 ? 1 : 0));

  if (n < 0 || n >= rem) return false;
  pos += n;
  rem -= n;

  for (uint8_t i = 0; i < v.n; i++) {
    const auto &r = v.rec[i];
    char t_str[16], tr_str[16];
    fmtFloat(t_str, sizeof(t_str), r.t);
    fmtFloat(tr_str, sizeof(tr_str), r.t_raw);

    char q_str[4] = "GGG";
    const char q_map[] = {'G', 'S', 'B', '?'};
    q_str[0] = q_map[r.q & 0x03];
    q_str[1] = q_map[(r.q >> 2) & 0x03];
    q_str[2] = q_map[(r.q >> 4) & 0x03];
    q_str[3] = '\0';

    float tq_val = (float)r.tq_x10 / 10.0f;

    n = snprintf(s_batch_buf + pos, rem,
      "%s[%" PRIu32 ",%" PRIu32 ",%s,%s,%u,%.1f,\"%s\",%u,%u]",
      (i == 0 ? "" : ","),
      r.seq, r.mono_ms, t_str, tr_str, (unsigned)r.rpm, tq_val,
      q_str, (unsigned)r.flt, (unsigned)r.flags);

    if (n < 0 || n >= rem) return false;
    pos += n;
    rem -= n;
  }

  if (rem < 3) return false;
  s_batch_buf[pos++] = ']';
  s_batch_buf[pos++] = '}';
  s_batch_buf[pos] = '\0';

  char topic[64];
  buildTopic(topic, sizeof(topic), backlog ? "tele/backlog" : "tele/batch");
  int msg_id = esp_mqtt_client_publish(s_client, topic, s_batch_buf, pos, 1, 0);
  return msg_id >= 0;
}

void Mqtt::publishTeleRow(uint32_t boot, uint32_t seq, uint32_t mono_ms, float t, float t_raw, float rpm, float tq,
                           const char *q, uint8_t flt, uint16_t fl) {
  if (!s_connected) return;
  char body[384];
  char t_str[16], t_raw_str[16];
  fmtFloat(t_str, sizeof t_str, t);
  fmtFloat(t_raw_str, sizeof t_raw_str, t_raw);

  int n = snprintf(body, sizeof body,
    "{\"v\":1,\"boot\":%" PRIu32 ",\"attempt\":null,\"tsync\":0,"
    "\"f\":[\"seq\",\"mono\",\"t\",\"t_raw\",\"rpm\",\"tq\",\"q\",\"flt\",\"fl\"],"
    "\"d\":[[%" PRIu32 ",%" PRIu32 ",%s,%s,%.2f,%.2f,\"%s\",%u,%u]]}",
    boot, seq, mono_ms, t_str, t_raw_str, rpm, tq,
    q ? q : "?", (unsigned)flt, (unsigned)fl);

  if (n < 0 || n >= (int)sizeof body) return;

  char topic[64];
  buildTopic(topic, sizeof topic, "tele/batch");
  esp_mqtt_client_publish(s_client, topic, body, 0, 1, 0);
}

void Mqtt::publishEvent(const char *type, uint32_t boot, uint32_t mono, int64_t ts, bool synced, const char *detailJson) {
  if (!s_connected) return;
  char body[512];
  char ts_str[32] = "null";
  if (synced && ts > 0) {
    snprintf(ts_str, sizeof(ts_str), "%lld", (long long)ts);
  }

  if (detailJson && detailJson[0] == '{') {
    snprintf(body, sizeof(body),
      "{\"type\":\"%s\",\"boot\":%" PRIu32 ",\"mono\":%" PRIu32 ",\"ts\":%s,\"offline_origin\":false,\"detail\":%s}",
      type ? type : "UNKNOWN", boot, mono, ts_str, detailJson);
  } else if (detailJson && detailJson[0] != '\0') {
    snprintf(body, sizeof(body),
      "{\"type\":\"%s\",\"boot\":%" PRIu32 ",\"mono\":%" PRIu32 ",\"ts\":%s,\"offline_origin\":false,%s}",
      type ? type : "UNKNOWN", boot, mono, ts_str, detailJson);
  } else {
    snprintf(body, sizeof(body),
      "{\"type\":\"%s\",\"boot\":%" PRIu32 ",\"mono\":%" PRIu32 ",\"ts\":%s,\"offline_origin\":false}",
      type ? type : "UNKNOWN", boot, mono, ts_str);
  }

  char topic[64];
  buildTopic(topic, sizeof(topic), "event");
  esp_mqtt_client_publish(s_client, topic, body, 0, 1, 0);
}

}  // namespace rmp
