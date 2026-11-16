#pragma once
// Ethernet (internal EMAC + IP101) and Wi-Fi (ESP32-C6 via ESP-Hosted) with ack-based failover (TDD 8.4).
#include <Arduino.h>
#include <WiFi.h>
#include <ETH.h>
#include <Preferences.h>
#include "pins.h"
#include "config.h"

class NetMgr {
 public:
  enum Link : uint8_t { L_NONE, L_ETH, L_WIFI };
  typedef void (*SwitchCb)(const char* type, Link from, Link to);

  void begin(SwitchCb cb) {
    cb_ = cb;
    WiFi.onEvent([this](arduino_event_id_t ev, arduino_event_info_t) { onEvent(ev); });
    // Core ETH.h (P4): begin(type, phy_addr, mdc, mdio, reset, clk_mode). ETH_PHY_IP101 maps to the TLK110/IP101 driver.
    // RMII pins default to TX_EN49/TXD0 34/TXD1 35/RXD0 29/RXD1 30/CRS_DV 28/CLK 50 (matches the schematic).
    // The IP101 supplies the 50 MHz reference on GPIO50 (U7 pins 10+14), so the EMAC takes it as an external input.
    ETH.begin(ETH_PHY_IP101, ETH_PHY_ADDR, PIN_ETH_MDC, PIN_ETH_MDIO, PIN_ETH_RST, EMAC_CLK_EXT_IN);
    Preferences p; p.begin("prov", true); String ssid = p.getString("ssid", ""), pass = p.getString("pass", ""); p.end();
    WiFi.mode(WIFI_STA);
    if (ssid.length()) WiFi.begin(ssid.c_str(), pass.c_str());
  }
  void setWifi(const char* ssid, const char* pass) {
    Preferences p; p.begin("prov", false); p.putString("ssid", ssid); p.putString("pass", pass); p.end();
    WiFi.disconnect(); WiFi.begin(ssid, pass);
  }
  // MQTT layer reports "link is delivering" (acks arriving or nothing outstanding)
  void reportHealth(bool ok) { if (ok) lastGood_ = millis(); }

  void loop() {
    uint32_t now = millis(); bool eu = ethUp_, wu = wifiUp_;
    if (active_ == L_ETH && !eu) { if (wu) switchTo(L_WIFI, "NET_FAILOVER"); else active_ = L_NONE; }
    if (active_ == L_WIFI && !wu) { if (eu) switchTo(L_ETH, "NET_FAILBACK"); else active_ = L_NONE; }
    if (active_ == L_NONE) {
      if (eu && (NET_PREFER_ETH || !wu)) switchTo(L_ETH, nullptr);
      else if (wu) switchTo(L_WIFI, nullptr);
      lastGood_ = now; return;
    }
    Link other = active_ == L_ETH ? L_WIFI : L_ETH; bool otherUp = other == L_ETH ? eu : wu;
    if (otherUp && now - lastGood_ > FAILOVER_NO_ACK_MS && (int32_t)(now - blockFailoverUntil_) >= 0) {   // active path stopped delivering
      switchTo(other, "NET_FAILOVER"); lastGood_ = now; blockFailbackUntil_ = now + FAILBACK_BLOCK_MS;
      blockFailoverUntil_ = now + FAILOVER_MIN_SPACING_MS; return;
    }
    if (NET_PREFER_ETH && active_ == L_WIFI && eu && ethSince_ && now - ethSince_ >= FAILBACK_HEALTHY_MS &&
        (int32_t)(now - blockFailbackUntil_) >= 0) { switchTo(L_ETH, "NET_FAILBACK"); lastGood_ = now; }
  }
  bool online() const { return active_ != L_NONE; }
  uint32_t generation() const { return gen_; }
  Link active() const { return active_; }
  const char* activeName() const { return active_ == L_ETH ? "eth" : active_ == L_WIFI ? "wifi" : "none"; }
  bool ethUp() const { return ethUp_; } bool wifiUp() const { return wifiUp_; }

 private:
  volatile bool ethUp_ = false, wifiUp_ = false; Link active_ = L_NONE; uint32_t gen_ = 0;
  uint32_t lastGood_ = 0, ethSince_ = 0, blockFailbackUntil_ = 0, blockFailoverUntil_ = 0; SwitchCb cb_ = nullptr;
  void onEvent(arduino_event_id_t ev) {
    switch (ev) {
      case ARDUINO_EVENT_ETH_GOT_IP: ethUp_ = true; ethSince_ = millis(); break;
      case ARDUINO_EVENT_ETH_LOST_IP: case ARDUINO_EVENT_ETH_DISCONNECTED: ethUp_ = false; ethSince_ = 0; break;
      case ARDUINO_EVENT_WIFI_STA_GOT_IP: wifiUp_ = true; break;
      case ARDUINO_EVENT_WIFI_STA_LOST_IP: case ARDUINO_EVENT_WIFI_STA_DISCONNECTED: wifiUp_ = false; break;
      default: break;
    }
  }
  void switchTo(Link to, const char* type) {
    Link from = active_;
    if (to == L_ETH) ETH.setDefault(); else WiFi.STA.setDefault();   // lwIP default route
    active_ = to; gen_++;
    if (type && cb_) cb_(type, from, to);
  }
};
