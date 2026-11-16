#pragma once
#include <stdbool.h>
#include <stdint.h>
#include <stddef.h>

// Wi-Fi station connect + captive-portal provisioning. Reuses the esp_hosted/
// esp_wifi_remote path proven in the M0 Wi-Fi gate test (firmware/_gate/10_wifistation)
// for station mode, and adds a router-style SoftAP setup page for Wi-Fi provisioning
// (SPEC.md section 5.5 originally said "SoftAP is compiled out" -- deliberately
// overridden 2026-11-10 at the owner's request; see sdkconfig.defaults for the
// matching CONFIG_ESP_WIFI_SOFTAP_SUPPORT=y change). This is still a *bench* helper,
// not the full M3 dual-interface network manager (docs/SPEC.md section 5) -- no
// Ethernet, no failover state machine. Credentials come from rmp::Prov (NVS), not
// build-time constants.
namespace rmp {

class Net {
 public:
  // (Re)attempts an STA connection with the given credentials. Safe to call more than
  // once (e.g. a retry loop, or right after the portal saves new credentials) --
  // each call re-arms the retry counter and issues a fresh connect attempt. Blocks up
  // to timeout_ms waiting for success or failure.
  bool connect(const char *ssid, const char *password, uint32_t timeout_ms = 20000);
  bool isConnected() const;
  void ipString(char *out, size_t n) const;

  // Calls connect() repeatedly with 1s->60s exponential backoff (SPEC.md section
  // 5.4's Wi-Fi reconnect back-off) until either it succeeds or retry_window_ms has
  // elapsed in total. Returns true as soon as connected; false if the whole window
  // elapsed with no success -- the caller (app_main) then re-opens the provisioning
  // portal.
  bool connectWithRetryWindow(const char *ssid, const char *password, uint32_t retry_window_ms);

  // Brings up a SoftAP ("RMP-Reactor-Setup", open) + a DNS catch-all (so a phone or
  // laptop auto-pops the setup page the way a hotel/home-router hotspot does) + an
  // HTTP page that scans nearby networks and lets the user pick one (or type a
  // hidden SSID) and enter a password. Blocks until a valid SSID/password is
  // submitted, stores it via rmp::Prov, tears the AP/portal down, and returns. Never
  // gives up on its own -- the device waits here until someone configures it. The RTD
  // sampler/buttons/DWIN/alert tasks are unaffected -- only networking blocks.
  void runProvisioningPortal();
};

}  // namespace rmp
