// Reactor Monitoring Platform - device firmware, milestone 1 (RMP-TDD-001 v1.2)
// Target: Waveshare ESP32-P4-Module-DEV-KIT, Arduino-ESP32 core 3.3.x. See README.md for IDE settings.
#include <Arduino.h>
#include <esp_system.h>
#include "config.h"
#include "pins.h"
#include "rmp_types.h"
#include "app_state.h"
#include "proto_parse.h"
#include "prov.h"
#include "ring_store.h"
#include "time_sync.h"
#include "rtd_max31865.h"
#include "motor_hei.h"
#include "net_mgr.h"
#include "mqtt_link.h"
#include "dwin.h"
#include "buttons.h"
#if ENABLE_AUDIO
#include "audio.h"
Audio audio;
#endif

RingStore ring; TimeSync tsync; NetMgr net; MqttLink mqtt; Max31865 rtd; HeiMotor motor;
Calib cal; Live live; RunCtx run; Prov prov; Dwin dwin; Buttons btn;
static uint16_t bootId = 0; static bool rtdOk = false; static volatile bool benchHold = false;

static void onNetSwitch(const char* type, NetMgr::Link from, NetMgr::Link to) {
  char d[64]; snprintf(d, sizeof d, "{\"from\":%d,\"to\":%d}", (int)from, (int)to);
  mqtt.event(type, d);
}

// ---------------- 1 Hz sampler (core 1) ----------------
static void samplerTask(void*) {
  uint32_t seq = 0, lastMono = 0, idleCnt = 0; uint8_t motorFails = 0;
  if (tsync.state() >= T_ESTIMATED) {   // wall-clock align the first cycle to a whole UTC second
    struct timeval tv; gettimeofday(&tv, nullptr); delay((1000000 - tv.tv_usec) / 1000);
  }
  int64_t next = esp_timer_get_time();
  for (;;) {
    next += (int64_t)SAMPLE_PERIOD_MS * 1000;
    uint32_t mono = TimeSync::monoMs();   // acquisition instant: before the slow RS232 poll
    int64_t utcAtAcq = TimeSync::utcMs();
    uint16_t flags = tsync.flagBits(); uint8_t q = 0;

    float tRaw = NAN, rOhm = 0, tCorr = NAN; uint8_t rf = rtdOk ? rtd.read(tRaw, rOhm) : 0xFF;
    if (rf) { q |= Q_BAD; tRaw = NAN; }
    else { tCorr = cal.apply(tRaw); if (tCorr < -60 || tCorr > 350) q |= Q_SUSPECT; }

    MotorData m; bool held = benchHold, mok = true;   // `motor` console command owns the RS232 port: record "no data", not zeros
    if (!held) mok = motor.poll(m);
    if (held) { q |= (Q_BAD << 2) | (Q_BAD << 4); mok = false; }
    else if (!mok) { if (++motorFails >= 3) flags |= FL_LINK_DOWN; q |= (Q_BAD << 2) | (Q_BAD << 4); m.rpm = 0; m.tq_ncm = 0; }
    else motorFails = 0;

    if (mono < lastMono) ring.forceRotate();   // 32-bit uptime wrapped (49.7 days)
    lastMono = mono;
    char att[40]; bool runActive = run.snapshot(att);   // consistent copy: the net task may start/stop a run at any moment
    ring.setMeta(tsync.state(), utcAtAcq - (int64_t)mono, att, cal.ver);

    if (esp_timer_get_time() > next) flags |= FL_LATE_CYCLE;
    bool store = runActive || (++idleCnt >= IDLE_STORE_INTERVAL_S);
    if (store) {
      idleCnt = 0;
      Rec r{}; r.seq = ++seq; r.mono_ms = mono; r.t = tCorr; r.t_raw = tRaw;
      r.rpm = (uint16_t)constrain((int)lroundf(m.rpm), 0, 65535);
      r.tq_x10 = (int16_t)constrain((int)lroundf(m.tq_ncm * 10.0f), -32768, 32767);
      r.q = q; r.flt = m.flt; r.flags = flags;
      ring.append(r);   // write-ahead: stored before it is ever published
    }
    live.t = tCorr; live.t_raw = tRaw; live.rpm = m.rpm; live.tq = m.tq_ncm; live.q = q; live.flt = m.flt;
    live.flags = flags; live.motorOk = mok; live.seq = seq;

    int64_t slack = next - esp_timer_get_time();
    if (slack > 0) vTaskDelay(pdMS_TO_TICKS(slack / 1000)); else next = esp_timer_get_time();
  }
}

// ---------------- network + MQTT + time (core 0) ----------------
static void netTask(void*) {
  for (;;) { net.loop(); tsync.loop(); mqtt.service(); vTaskDelay(pdMS_TO_TICKS(10)); }
}

// ---------------- DWIN + buttons ----------------
static void uiTask(void*) {
  uint32_t lastUi = 0;
  dwin.begin(); btn.begin(); delay(500); dwin.page(PAGE_RUNNING);
  for (;;) {
    btn.poll();
    BtnMsg b; while (btn.get(b)) Serial.printf("[btn] %u evt %u\n", b.id, (unsigned)b.e);   // milestone 2: UI state machine consumes these
    uint32_t now = millis();
    if (now - lastUi >= 500) {
      lastUi = now;
      dwin.showReadings(live.t, ((live.q & 3) != Q_BAD), live.rpm, live.tq, live.motorOk);
      char s[24]; snprintf(s, sizeof s, "%s %s", net.activeName(), tsync.stateName());
      dwin.writeText(VP_NET_TXT, s);
    }
    vTaskDelay(pdMS_TO_TICKS(5));
  }
}

// ---------------- serial console (bench provisioning) ----------------
static String pemBuf, pemKey; static bool pemMode = false;
static void handleLine(String l) {
  l.trim();
  if (pemMode) {
    if (l == "END") { prov.setBlob(pemKey.c_str(), pemBuf); Serial.printf("saved %s (%u bytes)\n", pemKey.c_str(), (unsigned)pemBuf.length()); pemMode = false; }
    else pemBuf += l + "\n";
    return;
  }
  if (l == "help") Serial.println("status | binding | motor | rtd | time | set devid X | set broker HOST [PORT|auto] | set ntp HOST | set wifi SSID PASS | pem ca|cert|key (paste, then END) | run UUID | stop | reboot");
  else if (l == "status") Serial.printf("fw %s boot %u net %s clock %s rtd %s prov %s run %d fill %u%% T %.2f rpm %.0f seq %u mqtt %d\n", FW_VERSION, bootId,
      net.activeName(), tsync.stateName(), rtdOk ? "ok" : "FAIL", prov.complete() ? "ok" : "incomplete", run.active, ring.fillPercent(), (float)live.t, (float)live.rpm, (unsigned)live.seq, mqtt.connected());
  else if (l == "binding") Serial.printf("server binding: %s\n", mqtt.boundName());
  else if (l.startsWith("set devid ")) {   // the deviceId UUID returned by POST /devices/claim (NOT the serial number)
    String v = l.substring(10); v.trim();
    if (!proto::looksUuid(v.c_str())) Serial.println("devid must be the 36-char UUID from the claim response, not the serial number");
    else { prov.setStr("devid", v); Serial.println("saved devid, reboot to apply"); }
  }
  else if (l.startsWith("set broker ")) { String a = l.substring(11); int sp = a.indexOf(' '); Preferences p; p.begin("prov", false); p.putString("host", sp < 0 ? a : a.substring(0, sp)); if (sp > 0) p.putUShort("port", a.substring(sp + 1).toInt()); p.end(); }
  else if (l.startsWith("set ntp ")) prov.setStr("ntp", l.substring(8));
  else if (l.startsWith("set wifi ")) { String a = l.substring(9); int sp = a.indexOf(' '); if (sp > 0) net.setWifi(a.substring(0, sp).c_str(), a.substring(sp + 1).c_str()); else Serial.println("usage: set wifi SSID PASS"); }
  else if (l == "motor") {   // Phase-0 bench: raw Heidolph replies, read-only allow-listed queries only
    benchHold = true; delay(1200); char b[48];
    const char* names[] = {"speed r", "torque m", "fault f", "motor temp t", "type T", "serial Q"};
    for (int i = 0; i < 6; i++) { bool ok = motor.query((HeiMotor::Query)i, b, sizeof b); Serial.printf("  %-13s -> %s%s\n", names[i], ok ? "'" : "(no reply)", ok ? b : ""); }
    benchHold = false;
  }
  else if (l == "rtd") Serial.println(rtd.regs());
  else if (l == "time") Serial.printf("clock %s  utc_ms %lld  mono_ms %u\n", tsync.stateName(), (long long)TimeSync::utcMs(), (unsigned)TimeSync::monoMs());
  else if (l.startsWith("pem ")) { pemKey = l.substring(4); pemBuf = ""; pemMode = true; }
  else if (l.startsWith("run ")) { String a = l.substring(4); a.trim(); if (proto::looksUuid(a.c_str())) run.start(a.c_str()); else Serial.println("run needs the process_attempt UUID"); }
  else if (l == "stop") run.stop();
  else if (l == "reboot") ESP.restart();
}

void setup() {
  Serial.begin(115200); delay(300);
  { Preferences p; p.begin("sys", false); bootId = p.getUShort("boot", 0) + 1; p.putUShort("boot", bootId); p.end(); }
  Serial.printf("\nRMP firmware %s boot %u reset %d\n", FW_VERSION, bootId, (int)esp_reset_reason());
  prov.load(); cal.load(); run.load();
  if (!ring.begin(bootId)) Serial.println("FATAL: ring partition not found (is partitions.csv in the sketch folder?)");
  tsync.begin(prov.ntp.length() ? prov.ntp.c_str() : (prov.host != "auto" ? prov.host.c_str() : ""));
  rtdOk = rtd.begin(); if (!rtdOk) Serial.println("WARN: MAX31865 not responding");
  motor.begin();
#if ENABLE_AUDIO
  if (!audio.begin()) Serial.println("WARN: audio init failed");
#endif
  net.begin(onNetSwitch);
  mqtt.begin(&ring, &net, &tsync, &cal, &live, &run, &prov, bootId);
  xTaskCreatePinnedToCore(samplerTask, "sampler", 8192, nullptr, 6, nullptr, 1);
  xTaskCreatePinnedToCore(netTask, "net", 16384, nullptr, 4, nullptr, 0);
  xTaskCreatePinnedToCore(uiTask, "ui", 6144, nullptr, 3, nullptr, 1);
}

void loop() {
  static String line;
  while (Serial.available()) { char c = Serial.read(); if (c == '\n') { handleLine(line); line = ""; } else if (c != '\r') line += c; }
  delay(10);
}
