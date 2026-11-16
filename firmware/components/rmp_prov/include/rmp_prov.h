#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>


// NVS-backed runtime configuration (SPEC.md sections 4 and 10): Wi-Fi
// credentials, MQTT broker URI, and device ID, all changeable via the serial
// console
// ("set wifi", "set broker", "set devid") or the Wi-Fi captive portal
// (rmp_net), WITHOUT a rebuild/reflash. First-boot defaults (before anything
// has ever been provisioned) come from rmp_bench_defaults.h -- see that file's
// header comment for the "one file to edit" convention and why it exists.
namespace rmp {

class Prov {
public:
  static void
  begin(); // opens the NVS namespace; call once at boot before any get/set

  static bool hasWifiCreds(); // true once `set wifi`/the portal has run
  static void getWifiSsid(char *out, size_t n); // falls back to BENCH_WIFI_SSID
  static void getWifiPass(char *out,
                          size_t n); // falls back to BENCH_WIFI_PASSWORD
  static void setWifi(const char *ssid,
                      const char *pass); // persists immediately

  static void getBrokerUri(char *out,
                           size_t n); // falls back to BENCH_MQTT_BROKER_URI
  static void
  setBroker(const char *host,
            uint16_t port); // builds "mqtts://host:port" and persists
  static void setBrokerUri(const char *uri); // persists complete broker URI

  static void getDeviceId(char *out, size_t n); // falls back to BENCH_DEVICE_ID
  static void setDeviceId(const char *uuid);

  static void resetWifi(); // clears stored Wi-Fi creds only (used by the `prov
                           // reset` console command)
};

} // namespace rmp
