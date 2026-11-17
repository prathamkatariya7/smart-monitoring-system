#include "rmp_prov.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "nvs.h"
#include "nvs_flash.h"
#include "rmp_bench_defaults.h"
#include <stdio.h>
#include <string.h>

namespace rmp {
namespace {
constexpr char kTag[] = "rmp_prov";
constexpr char kNamespace[] = "rmp_prov";
nvs_handle_t s_handle = 0;
bool s_begun = false;

bool getStr(const char *key, char *out, size_t n) {
  if (!s_begun || n == 0) {
    if (n)
      out[0] = 0;
    return false;
  }
  size_t required = n;
  esp_err_t err = nvs_get_str(s_handle, key, out, &required);
  return err == ESP_OK;
}

void setStr(const char *key, const char *val) {
  if (!s_begun)
    return;
  nvs_set_str(s_handle, key, val ? val : "");
  nvs_commit(s_handle);
}
} // namespace

void Prov::begin() {
  if (s_begun)
    return;
  esp_err_t err = nvs_flash_init();
  if (err == ESP_ERR_NVS_NO_FREE_PAGES ||
      err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
    nvs_flash_erase();
    err = nvs_flash_init();
  }
  if (err != ESP_OK) {
    ESP_LOGE(kTag, "nvs_flash_init failed: %d", (int)err);
    return;
  }
  err = nvs_open(kNamespace, NVS_READWRITE, &s_handle);
  if (err != ESP_OK) {
    ESP_LOGE(kTag, "nvs_open failed: %d", (int)err);
    return;
  }
  s_begun = true;
}

bool Prov::hasWifiCreds() {
  char buf[33];
  if (getStr("wifi_ssid", buf, sizeof buf) && buf[0] != 0) {
    return true;
  }
  return (BENCH_WIFI_SSID[0] != '\0');
}

void Prov::getWifiSsid(char *out, size_t n) {
  if (getStr("wifi_ssid", out, n) && out[0] != '\0') {
    if (strcmp(out, "+") == 0) {
      snprintf(out, n, "%s", BENCH_WIFI_SSID);
      setStr("wifi_ssid", BENCH_WIFI_SSID);
    }
    return;
  }
  snprintf(out, n, "%s", BENCH_WIFI_SSID);
}

void Prov::getWifiPass(char *out, size_t n) {
  if (getStr("wifi_pass", out, n) && out[0] != '\0') {
    char ssid[33] = {0};
    if (getStr("wifi_ssid", ssid, sizeof ssid) && strcmp(ssid, BENCH_WIFI_SSID) == 0 && strcmp(out, "") == 0) {
      snprintf(out, n, "%s", BENCH_WIFI_PASSWORD);
      setStr("wifi_pass", BENCH_WIFI_PASSWORD);
    }
    return;
  }
  snprintf(out, n, "%s", BENCH_WIFI_PASSWORD);
}

void Prov::setWifi(const char *ssid, const char *pass) {
  setStr("wifi_ssid", ssid);
  setStr("wifi_pass", pass);
  ESP_LOGI(kTag, "Wi-Fi credentials updated (SSID '%s')",
           ssid); // never log the password
}

void Prov::getBrokerUri(char *out, size_t n) {
  if (getStr("broker_uri", out, n) && out[0] != '\0') {
    if (strstr(out, "172.16.50.141") || strstr(out, "bslp-lap-pratha.local") || strstr(out, "BSLP-LAP-PRATHA.local")) {
      return;
    }
  }
  snprintf(out, n, "%s", BENCH_MQTT_BROKER_URI);
  setStr("broker_uri", BENCH_MQTT_BROKER_URI);
}

void Prov::setBroker(const char *host, uint16_t port) {
  char uri[96];
  snprintf(uri, sizeof uri, "mqtts://%s:%u", host, (unsigned)port);
  setStr("broker_uri", uri);
  ESP_LOGI(kTag, "broker URI updated to %s", uri);
}

void Prov::setBrokerUri(const char *uri) {
  if (!uri || !uri[0])
    return;
  char buf[96];
  if (strncmp(uri, "mqtt://", 7) != 0 && strncmp(uri, "mqtts://", 8) != 0) {
    snprintf(buf, sizeof buf, "mqtts://%s", uri);
  } else {
    snprintf(buf, sizeof buf, "%s", uri);
  }
  setStr("broker_uri", buf);
  ESP_LOGI(kTag, "broker URI updated to %s", buf);
}

void Prov::getDeviceId(char *out, size_t n) {
  if (getStr("device_id", out, n) && out[0] != '\0') {
    return;
  }
  uint8_t mac[6] = {0};
  esp_err_t err = esp_efuse_mac_get_default(mac);
  if (err != ESP_OK) {
    err = esp_read_mac(mac, ESP_MAC_BASE);
  }
  if (err != ESP_OK) {
    err = esp_read_mac(mac, ESP_MAC_ETH);
  }

  if (err == ESP_OK) {
    if (mac[0] == 0xe8 && mac[1] == 0xf6 && mac[2] == 0x0a &&
        mac[3] == 0xe3 && mac[4] == 0x90 && mac[5] == 0xfb) {
      snprintf(out, n, "%s", BENCH_DEVICE_ID);
    } else {
      snprintf(out, n, "01a1af2d-e705-75aa-b3fc-%02x%02x%02x%02x%02x%02x",
               mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    }
  } else {
    snprintf(out, n, "%s", BENCH_DEVICE_ID);
  }
}

void Prov::setDeviceId(const char *uuid) {
  setStr("device_id", uuid);
  ESP_LOGI(kTag, "device id updated to %s", uuid);
}

void Prov::resetWifi() {
  if (!s_begun)
    return;
  nvs_erase_key(s_handle, "wifi_ssid");
  nvs_erase_key(s_handle, "wifi_pass");
  nvs_commit(s_handle);
  ESP_LOGI(kTag, "stored Wi-Fi credentials cleared");
}

} // namespace rmp
