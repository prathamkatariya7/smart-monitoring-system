#pragma once
// MQTT over mutual TLS to the local Mosquitto. Wire contract: "Firmware Integration Guide" (backend, 2026-11-07).
// Uses PubSubClient (MQTT 3.1.1):
//  - device->server publishes are QoS 0; delivery is guaranteed by the application-level data-ack + replay
//  - MQTT 5 correlation data is replaced by the "id" field in cmd / ack JSON (the guide says both always carry it)
#include <Arduino.h>
#include <esp_system.h>
#include <Preferences.h>
#include <PubSubClient.h>
#include <NetworkClientSecure.h>
#include <ArduinoJson.h>
#include <ESPmDNS.h>
#include "ring_store.h"
#include "time_sync.h"
#include "net_mgr.h"
#include "prov.h"
#include "app_state.h"
#include "proto_parse.h"
#include "config.h"

class MqttLink {
 public:
  void begin(RingStore* r, NetMgr* n, TimeSync* t, Calib* c, Live* l, RunCtx* run, Prov* p, uint16_t boot) {
    ring_ = r; net_ = n; ts_ = t; cal_ = c; live_ = l; run_ = run; prov_ = p; boot_ = boot;
    mqtt_.setClient(tls_); mqtt_.setBufferSize(8192); mqtt_.setKeepAlive(30); mqtt_.setSocketTimeout(5);
    tls_.setHandshakeTimeout(8);   // default is 120 s, which would freeze the net task (failover, NTP) on a dead broker
    mqtt_.setCallback([this](char* t, uint8_t* pl, unsigned n) { onMessage(t, pl, n); });
    snprintf(prefix_, sizeof prefix_, "rmp/v1/%s/", p->devid.c_str());
    esp_reset_reason_t rr = esp_reset_reason();
    char d[40]; snprintf(d, sizeof d, "{\"reset_reason\":%d}", (int)rr);
    enqueue("DEVICE_REBOOT", d, TimeSync::monoMs(), TimeSync::utcMs(), false);
    Preferences pr; pr.begin("cfg", true); cfgVer_ = pr.getInt("ver", -1); pr.end();
  }
  bool connected() { return mqtt_.connected(); }
  const char* boundName() const { return bound_ == proto::B_BOUND ? "bound" : bound_ == proto::B_UNBOUND ? "UNBOUND" : "unknown"; }

  void service() {
    uint32_t now = millis();
    if (!net_->online()) return;
    if (!prov_->complete()) { net_->reportHealth(true); return; }   // not provisioned: nothing to deliver, so do not fail links over
    if (net_->generation() != gen_) { gen_ = net_->generation(); if (mqtt_.connected()) mqtt_.disconnect(); }
    if (!mqtt_.connected()) {
      if (now - lastTry_ < 5000) return;
      lastTry_ = now; if (!connect()) return;
    }
    mqtt_.loop();
    if (!mqtt_.connected()) return;
    if (now - lastHb_ >= HEARTBEAT_MS) { lastHb_ = now; publishState(true); }
    int64_t u; uint32_t m;
    if (ts_->takeAnchor(m, u)) { char d[96]; snprintf(d, sizeof d, "{\"anchor_mono\":%u,\"anchor_utc\":%lld}", (unsigned)m, (long long)u); enqueue("TIME_ANCHOR", d, m, u, true); }
    uint32_t lost = ring_->takeLost();
    if (lost) { char d[64]; snprintf(d, sizeof d, "{\"lost\":%u,\"kind\":\"BUFFER_OVERWRITE\"}", (unsigned)lost); enqueue("GAP", d, TimeSync::monoMs(), TimeSync::utcMs(), ts_->state() == T_SYNCED); }
    flushEvents();

    // Resend what was published but never acked. Back off while the server is not acking at all (e.g. device not bound).
    if (ring_->outstanding() && now - lastAckMs_ > ackTimeout_) {
      ring_->rewindCursor(); lastAckMs_ = now; ackTimeout_ = min<uint32_t>(ackTimeout_ * 2, ACK_TIMEOUT_MAX_MS);
    }
    // Link health for failover: only judge the link by acks when the server is known to ack us.
    bool ackExpected = bound_ == proto::B_BOUND || (bound_ == proto::B_UNKNOWN && everAcked_);
    net_->reportHealth(!ring_->outstanding() || !ackExpected || now - lastAckMs_ < FAILOVER_NO_ACK_MS);
    publishPending(now);
    if (now - lastPersist_ > 60000) { lastPersist_ = now; ring_->persist(); }
  }

  // Events are queued in RAM (8 slots) and sent on the next connection with offline_origin=true when they were late,
  // so NET_FAILOVER (which happens while the old link is dead) is no longer lost. Not yet a durable queue (milestone 2).
  void event(const char* type, const char* detailJson) {
    enqueue(type, detailJson, TimeSync::monoMs(), TimeSync::utcMs(), ts_ && ts_->state() == T_SYNCED);
  }

 private:
  struct QEvt { char type[24]; char detail[112]; uint32_t mono; int64_t utc; bool synced; uint32_t queuedAt; };
  PubSubClient mqtt_; NetworkClientSecure tls_;
  RingStore* ring_ = nullptr; NetMgr* net_ = nullptr; TimeSync* ts_ = nullptr; Calib* cal_ = nullptr;
  Live* live_ = nullptr; RunCtx* run_ = nullptr; Prov* prov_ = nullptr; uint16_t boot_ = 0;
  char prefix_[64]; char buf_[6144]; RingStore::View view_;
  uint32_t gen_ = 0, lastTry_ = 0, lastHb_ = 0, lastAckMs_ = 0, lastBatch_ = 0, lastBacklog_ = 0, lastPersist_ = 0;
  uint32_t ackTimeout_ = ACK_TIMEOUT_MS, connectedAt_ = 0;
  proto::Bound bound_ = proto::B_UNKNOWN; bool everAcked_ = false, cfgSeen_ = false; int32_t cfgVer_ = -1;
  QEvt q_[8]; uint32_t qHead_ = 0, qTail_ = 0;

  void enqueue(const char* type, const char* detail, uint32_t mono, int64_t utc, bool synced) {
    if (qTail_ - qHead_ >= 8) qHead_++;   // full: drop the oldest
    QEvt& e = q_[qTail_++ & 7];
    strlcpy(e.type, type, sizeof e.type);
    if (detail && strlen(detail) < sizeof e.detail) strlcpy(e.detail, detail, sizeof e.detail); else strcpy(e.detail, "{}");
    e.mono = mono; e.utc = utc; e.synced = synced; e.queuedAt = millis();
  }
  void flushEvents() {
    for (int k = 0; k < 4 && qHead_ != qTail_; k++) {
      QEvt& e = q_[qHead_ & 7];
      char ts[40] = ""; if (e.synced) snprintf(ts, sizeof ts, ",\"ts\":%lld", (long long)e.utc);   // guide: omit ts when the clock is not synced
      int n = snprintf(buf_, sizeof buf_, "{\"type\":\"%s\",\"boot\":%u,\"mono\":%u%s,\"offline_origin\":%s,\"detail\":%s}",
                       e.type, (unsigned)boot_, (unsigned)e.mono, ts, (millis() - e.queuedAt > 2000) ? "true" : "false", e.detail);
      if (!pub("event", buf_, n, false)) break;
      qHead_++;
    }
  }

  bool pub(const char* sfx, const char* payload, size_t n, bool retain) {
    char t[112]; snprintf(t, sizeof t, "%s%s", prefix_, sfx);
    return mqtt_.publish(t, (const uint8_t*)payload, n, retain);
  }
  // Only the fields the guide defines for `state` (ts omitted unless the clock is synced).
  void publishState(bool online) {
    char ts[40] = ""; if (ts_->state() == T_SYNCED) snprintf(ts, sizeof ts, ",\"ts\":%lld", (long long)TimeSync::utcMs());
    int n = snprintf(buf_, sizeof buf_, "{\"online\":%s,\"link\":\"%s\",\"boot\":%u,\"fw\":\"%s\"%s}",
                     online ? "true" : "false", net_->activeName(), (unsigned)boot_, FW_VERSION, ts);
    pub("state", buf_, n, true);
  }
  bool connect() {
    String host = prov_->host;
    if (host == "auto") {
      if (!MDNS.begin(prov_->devid.c_str())) return false;
      int n = MDNS.queryService("rmp", "tcp"); if (n <= 0) return false;
      host = MDNS.address(0).toString();
    }
    tls_.setCACert(prov_->ca.c_str()); tls_.setCertificate(prov_->cert.c_str()); tls_.setPrivateKey(prov_->key.c_str());
    mqtt_.setServer(host.c_str(), prov_->port);
    char willT[112]; snprintf(willT, sizeof willT, "%sstate", prefix_);
    bool ok = mqtt_.connect(prov_->devid.c_str(), nullptr, nullptr, willT, 1, true, "{\"online\":false}", false);  // persistent session
    if (!ok) {
      char err[100] = ""; tls_.lastError(err, sizeof err);   // e.g. "certificate is not yet valid" when the clock is still 1970
      Serial.printf("[mqtt] connect to %s:%u failed: rc=%d tls='%s' clock=%s\n", host.c_str(), (unsigned)prov_->port, mqtt_.state(), err, ts_->stateName());
      return false;
    }
    char t[112];
    snprintf(t, sizeof t, "%scmd/#", prefix_); mqtt_.subscribe(t, 1);
    snprintf(t, sizeof t, "%sack/data", prefix_); mqtt_.subscribe(t, 1);
    snprintf(t, sizeof t, "%scfg/desired", prefix_); mqtt_.subscribe(t, 1);
    lastAckMs_ = millis(); lastHb_ = millis(); connectedAt_ = millis(); cfgSeen_ = false;
    publishState(true);
    return true;
  }

  const char* qLetters(uint8_t q, int shift) { uint8_t v = (q >> shift) & 3; return v == 0 ? "G" : v == 1 ? "S" : "B"; }

  void publishRows(const RingStore::View& v, bool backlog) {
    const SectorHdr& h = v.hdr;
    char att[48]; if (h.attempt[0]) snprintf(att, sizeof att, "\"%s\"", h.attempt); else strcpy(att, "null");   // idle samples: attempt null
    int n = snprintf(buf_, sizeof buf_,
      "{\"v\":1,\"boot\":%u,\"attempt\":%s,\"cal\":%u,\"fw\":\"%s\",\"link\":\"%s\",\"tsync\":%u,"
      "\"f\":[\"seq\",\"mono\",\"ts\",\"t\",\"t_raw\",\"rpm\",\"tq\",\"q\",\"flt\",\"fl\"],\"d\":[",
      (unsigned)h.boot, att, (unsigned)h.cal, FW_VERSION, net_->activeName(), (unsigned)(h.tsync == 2));
    for (uint8_t i = 0; i < v.n; i++) {
      const Rec& r = v.rec[i];
      if (n + 160 > (int)sizeof buf_) break;
      long long ts = h.tsync ? h.utcOffMs + (long long)r.mono_ms : 0;
      char t[16], tr[16]; proto::fnum(t, sizeof t, r.t, "%.2f"); proto::fnum(tr, sizeof tr, r.t_raw, "%.2f");   // NaN -> null, never "nan"
      unsigned fl = r.flags & ~(unsigned)(FL_TIME_UNSYNCED | FL_GAP);   // those two bits are server-owned
      n += snprintf(buf_ + n, sizeof buf_ - n, "%s[%u,%u,%lld,%s,%s,%u,%.1f,\"%s%s%s\",%u,%u]", i ? "," : "",
        (unsigned)r.seq, (unsigned)r.mono_ms, ts, t, tr, (unsigned)r.rpm, r.tq_x10 / 10.0f,
        qLetters(r.q, 0), qLetters(r.q, 2), qLetters(r.q, 4), (unsigned)r.flt, fl);
    }
    n += snprintf(buf_ + n, sizeof buf_ - n, "]}");
    if (pub(backlog ? "tele/backlog" : "tele/batch", buf_, n, false)) ring_->commitCursor();
  }
  void publishPending(uint32_t now) {
    if (bound_ == proto::B_UNBOUND) return;                                   // the server would silently drop it: keep it in flash
    if (!cfgSeen_ && now - connectedAt_ < 2000) return;                       // let the retained cfg/desired arrive first
    uint32_t pend = ring_->pendingApprox(); if (!pend) return;
    bool backlog = pend > 12;
    if (!backlog) {
      if (pend < BATCH_N && now - lastBatch_ < LIVE_BATCH_MAX_WAIT_MS) return;
      if (ring_->peek(view_, BATCH_N)) { lastBatch_ = now; publishRows(view_, false); }
    } else {
      if (now - lastBacklog_ < 50) return;   // at most 20 messages per second
      if (ring_->peek(view_, BACKLOG_N)) { lastBacklog_ = now; publishRows(view_, true); }
    }
  }

  void ackCmd(const String& id, const char* cmd, bool ok, const char* reason, int appliedVersion = -1, float selftest = NAN) {
    JsonDocument o; o["id"] = id; o["cmd"] = cmd; o["status"] = ok ? "applied" : "rejected"; o["reason"] = reason ? reason : "";
    if (appliedVersion >= 0) o["applied_version"] = appliedVersion;   // guide 6.3: echo the calibration version applied
    if (!isnan(selftest)) o["selftest"] = serialized(String(selftest, 2));
    size_t n = serializeJson(o, buf_, sizeof buf_);
    pub("ack/cmd", buf_, n, false);
  }
  void onMessage(char* topic, uint8_t* pl, unsigned len) {
    String t(topic), sfx = t.substring(strlen(prefix_));
    JsonDocument d; if (deserializeJson(d, (const char*)pl, len)) return;   // parse fully BEFORE publishing (shared buffer)
    if (sfx == "ack/data") {
      ring_->onAck(d["boot"] | 0, d["upto_seq"] | 0); lastAckMs_ = millis(); ackTimeout_ = ACK_TIMEOUT_MS; everAcked_ = true; return;
    }
    if (sfx == "cfg/desired") {
      bound_ = proto::bindingState(d); cfgSeen_ = true;
      int32_t ver = d["version"] | -1; String s; serializeJson(d, s);
      if (ver != cfgVer_ && s.length() < 3900) {   // retained: it arrives on every connect, so only write flash when it changed
        Preferences p; p.begin("cfg", false); p.putString("desired", s); p.putInt("ver", ver); p.end(); cfgVer_ = ver;
      }
      Serial.printf("[cfg] version %d, device is %s\n", (int)ver, boundName());
      return;
    }
    if (!sfx.startsWith("cmd/")) return;
    String cmd = sfx.substring(4), id = d["id"] | "";
    if (cmd == "set_calibration") {
      float a, b; uint16_t ver;
      const char* why = proto::parseCalibration(d, a, b, ver);
      if (why) { ackCmd(id, "set_calibration", false, why); return; }
      cal_->set(a, b, ver); cal_->save();
      ackCmd(id, "set_calibration", true, "", (int)ver, (float)live_->t);
#if CMD_ALLOW_SET_NETWORK
    } else if (cmd == "set_network") {
      String ssid = d["ssid"] | "", pass = d["pass"] | "";
      if (!ssid.length()) { ackCmd(id, "set_network", false, "no-ssid"); return; }
      net_->setWifi(ssid.c_str(), pass.c_str()); ackCmd(id, "set_network", true, "");
#endif
    } else if (cmd == "set_assignment") {   // milestone 1 bench behaviour: attempt + start/stop
      if (d["stop"] | false) run_->stop();
      else if (d["start"] | false) {
        String a = d["attempt"] | "";
        if (!proto::looksUuid(a.c_str())) { ackCmd(id, cmd.c_str(), false, "bad-attempt-uuid"); return; }
        run_->start(a.c_str());
      }
      ackCmd(id, "set_assignment", true, "");
#if CMD_ALLOW_REBOOT
    } else if (cmd == "reboot") { ackCmd(id, "reboot", true, ""); ring_->persist(); delay(200); ESP.restart();
#endif
    } else { ackCmd(id, cmd.c_str(), false, "not-implemented"); }
  }
};
