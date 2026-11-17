#include "rmp_net.h"
#include <string.h>
#include <stdio.h>
#include <stdlib.h>
#include <string>
#include <vector>
#include "esp_system.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_http_server.h"
#include "nvs_flash.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/event_groups.h"
#include "lwip/err.h"
#include "lwip/sockets.h"
#include "rmp_prov.h"
#include "rmp_config.h"

namespace rmp {

namespace {
constexpr int kMaxRetry = 5;
constexpr char kTag[] = "rmp_net";
constexpr char kApSsid[] = "RMP-Reactor-Setup";

EventGroupHandle_t s_event_group = nullptr;
constexpr int kConnectedBit = BIT0;
constexpr int kFailBit = BIT1;
int s_retry = 0;
bool s_connected = false;
esp_ip4_addr_t s_ip = {};

bool s_hw_ready = false;      // nvs/netif/event-loop/esp_wifi_init done
bool s_wifi_started = false;  // esp_wifi_start() called at least once
bool s_ap_netif_created = false;

httpd_handle_t s_httpd = nullptr;
volatile bool s_dns_running = false;
volatile bool s_portal_done = false;
char s_new_ssid[33] = {0};
char s_new_pass[65] = {0};

void wifiEventHandler(void *, esp_event_base_t base, int32_t id, void *data) {
  if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
    s_connected = false;
    if (s_retry < kMaxRetry) {
      esp_wifi_connect();
      s_retry++;
      ESP_LOGI(kTag, "retry to connect to the AP (%d/%d)", s_retry, kMaxRetry);
    } else {
      xEventGroupSetBits(s_event_group, kFailBit);
    }
  } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
    ip_event_got_ip_t *event = (ip_event_got_ip_t *)data;
    s_ip = event->ip_info.ip;
    s_retry = 0;
    s_connected = true;
    xEventGroupSetBits(s_event_group, kConnectedBit);
  }
}

// One-time bring-up of the shared Wi-Fi hardware/stack. Safe to call repeatedly.
void ensureHw() {
  if (s_hw_ready) return;
  esp_err_t nvs_err = nvs_flash_init();
  if (nvs_err == ESP_ERR_NVS_NO_FREE_PAGES || nvs_err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
    nvs_flash_erase();
    nvs_flash_init();
  }
  s_event_group = xEventGroupCreate();
  ESP_ERROR_CHECK(esp_netif_init());
  ESP_ERROR_CHECK(esp_event_loop_create_default());
  esp_netif_create_default_wifi_sta();

  esp_event_handler_instance_t h_any, h_ip;
  ESP_ERROR_CHECK(esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &wifiEventHandler, nullptr, &h_any));
  ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &wifiEventHandler, nullptr, &h_ip));

  wifi_init_config_t wifi_cfg = WIFI_INIT_CONFIG_DEFAULT();
  ESP_ERROR_CHECK(esp_wifi_init(&wifi_cfg));
  s_hw_ready = true;
}

// Switches mode (STA / AP / APSTA may be changed freely while the driver is
// running) and starts the driver on the very first call only.
void startOrRestart(wifi_mode_t mode) {
  ensureHw();
  ESP_ERROR_CHECK(esp_wifi_set_mode(mode));
  if (!s_wifi_started) {
    ESP_ERROR_CHECK(esp_wifi_start());
    s_wifi_started = true;
  }
}

// --- Captive-portal DNS catch-all: answers every query with the AP's own IP
// (192.168.4.1, the ESP-IDF AP default), so phones/laptops auto-pop the setup page
// the same way a hotel/home-router hotspot does. ---
void dnsHijackTask(void *) {
  int sock = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
  if (sock < 0) { ESP_LOGE(kTag, "dns hijack socket() failed"); vTaskDelete(nullptr); return; }
  struct timeval tv = {1, 0};  // 1s receive timeout so we can re-check s_dns_running
  setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof tv);
  struct sockaddr_in addr = {};
  addr.sin_family = AF_INET;
  addr.sin_port = htons(53);
  addr.sin_addr.s_addr = htonl(INADDR_ANY);
  if (bind(sock, (struct sockaddr *)&addr, sizeof addr) != 0) {
    ESP_LOGE(kTag, "dns hijack bind() failed");
    close(sock);
    vTaskDelete(nullptr);
    return;
  }
  uint8_t buf[512];
  while (s_dns_running) {
    struct sockaddr_in src = {};
    socklen_t slen = sizeof src;
    int len = recvfrom(sock, buf, sizeof buf, 0, (struct sockaddr *)&src, &slen);
    if (len < 12) continue;  // timeout or too-short packet
    uint8_t reply[512];
    int rlen = len;
    if (rlen + 16 > (int)sizeof reply) continue;
    memcpy(reply, buf, len);
    reply[2] = 0x81; reply[3] = 0x80;  // flags: standard response, no error
    reply[6] = 0; reply[7] = 1;        // ANCOUNT = 1
    reply[rlen++] = 0xC0; reply[rlen++] = 0x0C;              // NAME: pointer to the question
    reply[rlen++] = 0x00; reply[rlen++] = 0x01;              // TYPE A
    reply[rlen++] = 0x00; reply[rlen++] = 0x01;              // CLASS IN
    reply[rlen++] = 0x00; reply[rlen++] = 0x00; reply[rlen++] = 0x00; reply[rlen++] = 0x3C;  // TTL 60s
    reply[rlen++] = 0x00; reply[rlen++] = 0x04;              // RDLENGTH 4
    reply[rlen++] = 192; reply[rlen++] = 168; reply[rlen++] = 4; reply[rlen++] = 1;  // 192.168.4.1
    sendto(sock, reply, rlen, 0, (struct sockaddr *)&src, slen);
  }
  close(sock);
  vTaskDelete(nullptr);
}

// --- Captive-portal HTTP setup page ---
const char kPortalHtmlHead[] =
    "<!DOCTYPE html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>"
    "<title>Smart Monitoring System — Device Setup</title>"
    "<style>"
    "* { box-sizing: border-box; }"
    "body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 440px; margin: 16px auto; padding: 0 16px; background: #f8fafc; color: #1e293b; line-height: 1.5; }"
    ".card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }"
    "h1 { font-size: 1.25em; margin: 0 0 4px 0; color: #0f172a; }"
    ".subtitle { font-size: 0.85em; color: #64748b; margin-bottom: 14px; }"
    ".badge { display: inline-block; padding: 2px 8px; background: #e0f2fe; color: #0369a1; border-radius: 999px; font-size: 0.72em; font-weight: 600; text-transform: uppercase; float: right; }"
    ".code-box { background: #f1f5f9; border: 1px dashed #cbd5e1; border-radius: 8px; padding: 12px; margin: 12px 0; }"
    ".code-row { display: flex; justify-content: space-between; align-items: center; margin: 5px 0; font-size: 0.88em; }"
    ".code-label { color: #64748b; font-weight: 500; }"
    ".code-val { font-family: monospace; font-weight: 700; color: #0958d9; font-size: 1.02em; word-break: break-all; }"
    ".copy-btn { width: 100%; padding: 8px; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 0.85em; font-weight: 600; color: #334155; cursor: pointer; margin-top: 8px; transition: all 0.2s; }"
    ".copy-btn:hover { background: #e2e8f0; }"
    ".notice { font-size: 0.8em; color: #475569; background: #fffbeb; border: 1px solid #fef3c7; border-radius: 6px; padding: 8px 10px; margin-top: 10px; line-height: 1.4; }"
    "h2 { font-size: 1.05em; margin: 14px 0 8px 0; color: #1e293b; }"
    "ul { padding: 0; margin: 8px 0 14px 0; max-height: 170px; overflow-y: auto; }"
    "li { list-style: none; margin: 6px 0; }"
    "a.ssid { display: block; padding: 10px 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; text-decoration: none; color: #1e293b; font-weight: 500; font-size: 0.9em; }"
    "a.ssid:hover { border-color: #0958d9; background: #f0f7ff; }"
    "label { font-size: 0.85em; font-weight: 600; color: #475569; display: block; margin-top: 8px; }"
    "input { width: 100%; padding: 9px 12px; margin: 4px 0 8px 0; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 0.95em; outline: none; }"
    "input:focus { border-color: #0958d9; }"
    "details { margin-top: 10px; font-size: 0.85em; border-top: 1px solid #f1f5f9; padding-top: 8px; }"
    "summary { cursor: pointer; color: #64748b; font-weight: 500; }"
    "button.submit { width: 100%; padding: 12px; background: #0958d9; color: #fff; border: 0; border-radius: 8px; font-size: 1em; font-weight: 600; cursor: pointer; margin-top: 12px; }"
    "button.submit:hover { background: #0847b0; }"
    "</style>"
    "<script>"
    "function copyDetails() {"
    "  var s = document.getElementById('sn').innerText;"
    "  var c = document.getElementById('cc').innerText;"
    "  var t = 'Serial: ' + s + '\\nClaim Code: ' + c;"
    "  if (navigator.clipboard && navigator.clipboard.writeText) {"
    "    navigator.clipboard.writeText(t).then(function() {"
    "      var b = document.getElementById('cpbtn');"
    "      b.innerText = 'Copied to Clipboard!';"
    "      setTimeout(function() { b.innerText = 'Copy Serial & Claim Code'; }, 2000);"
    "    }).catch(function() { alert(t); });"
    "  } else { alert(t); }"
    "}"
    "</script>"
    "</head><body>"
    "<div class='card'>"
    "<span class='badge'>Setup Mode</span>"
    "<h1>Reactor Monitor</h1>"
    "<div class='subtitle'>Hardware Configuration &amp; Provisioning</div>"
    "<div class='code-box'>"
    "<div class='code-row'><span class='code-label'>Serial Number:</span><span class='code-val' id='sn'>";

void urlDecode(const char *src, char *dst, size_t dstSize) {
  size_t di = 0;
  for (size_t si = 0; src[si] && di + 1 < dstSize; si++) {
    char c = src[si];
    if (c == '+') {
      dst[di++] = ' ';
    } else if (c == '%' && src[si + 1] && src[si + 2]) {
      char hex[3] = {src[si + 1], src[si + 2], 0};
      dst[di++] = (char)strtol(hex, nullptr, 16);
      si += 2;
    } else {
      dst[di++] = c;
    }
  }
  dst[di] = 0;
}

bool extractField(const char *body, const char *key, char *out, size_t outSize) {
  char needle[32];
  snprintf(needle, sizeof needle, "%s=", key);
  const char *p = strstr(body, needle);
  if (!p) { out[0] = 0; return false; }
  p += strlen(needle);
  const char *amp = strchr(p, '&');
  size_t len = amp ? (size_t)(amp - p) : strlen(p);
  char raw[128];
  if (len >= sizeof raw) len = sizeof raw - 1;
  memcpy(raw, p, len);
  raw[len] = 0;
  urlDecode(raw, out, outSize);
  return true;
}

void appendNetworkList(std::string &html) {
  wifi_scan_config_t scan_cfg = {};
  esp_err_t err = esp_wifi_scan_start(&scan_cfg, true);  // blocking
  if (err != ESP_OK) { ESP_LOGW(kTag, "scan failed: %d", (int)err); return; }
  uint16_t num = 0;
  esp_wifi_scan_get_ap_num(&num);
  if (num > 16) num = 16;
  if (num == 0) return;
  std::vector<wifi_ap_record_t> recs(num);
  esp_wifi_scan_get_ap_records(&num, recs.data());
  html += "<ul>";
  for (uint16_t i = 0; i < num; i++) {
    std::string ssid(reinterpret_cast<const char *>(recs[i].ssid));
    if (ssid.empty()) continue;
    html += "<li><a class='ssid' href='#' onclick=\"document.getElementById('s').value=this.innerText;return false\">" +
            ssid + "</a></li>";
  }
  html += "</ul>";
}

esp_err_t rootHandler(httpd_req_t *req) {
  uint8_t mac[6] = {0};
  esp_wifi_get_mac(WIFI_IF_STA, mac);
  char mac_str[18] = {0};
  snprintf(mac_str, sizeof mac_str, "%02X:%02X:%02X:%02X:%02X:%02X",
           mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);

  char serial_no[24] = {0};
  snprintf(serial_no, sizeof serial_no, "DEV-%02X%02X%02X", mac[3], mac[4], mac[5]);

  char devid[40] = {0};
  rmp::Prov::getDeviceId(devid, sizeof devid);

  char broker[96] = {0};
  rmp::Prov::getBrokerUri(broker, sizeof broker);

  std::string html = kPortalHtmlHead;
  html += serial_no;
  html += "</span></div>";
  html += "<div class='code-row'><span class='code-label'>Claim Code / Device ID:</span><span class='code-val' id='cc'>";
  html += devid;
  html += "</span></div>";
  html += "<div class='code-row'><span class='code-label'>MAC Address:</span><span style='font-family:monospace;font-size:0.85em;color:#64748b'>";
  html += mac_str;
  html += "</span></div>";
  html += "<div class='code-row'><span class='code-label'>Firmware Version:</span><span style='font-family:monospace;font-size:0.85em;color:#64748b'>";
  html += FW_VERSION;
  html += "</span></div>";
  html += "<button type='button' id='cpbtn' class='copy-btn' onclick='copyDetails()'>📋 Copy Serial &amp; Claim Code</button>";
  html += "</div>";
  html += "<div class='notice'>";
  html += "<strong>Company Admins:</strong> Enter this <b>Serial Number</b> and <b>Claim Code</b> in your Dashboard under <em>Devices &rarr; Claim Device</em> to connect this reactor.";
  html += "</div></div>";

  html += "<div class='card'>";
  html += "<h2>1. Select Wi-Fi Network</h2>";
  html += "<p style='font-size:0.85em;color:#64748b;margin:0 0 10px 0'>Tap a discovered network below or type the name manually:</p>";
  appendNetworkList(html);

  html += "<h2>2. Wi-Fi Credentials</h2>";
  html += "<form method='POST' action='/save'>";
  html += "<label for='s'>Network Name (SSID):</label>";
  html += "<input id='s' name='ssid' placeholder='e.g. Plant-WiFi' maxlength='32' required>";
  html += "<label for='p'>Password:</label>";
  html += "<input id='p' name='pass' type='password' placeholder='Leave blank if open' maxlength='64'>";

  html += "<details>";
  html += "<summary>⚙️ Server Settings (Optional / Advanced)</summary>";
  html += "<div style='margin-top:8px'>";
  html += "<label for='brk'>MQTT Broker URI:</label>";
  html += "<input id='brk' name='broker' value='";
  html += broker;
  html += "' placeholder='mqtts://host:18883' maxlength='95'>";
  html += "<label for='did'>Device UUID (Auto-derived from MAC):</label>";
  html += "<input id='did' name='devid' value='";
  html += devid;
  html += "' readonly style='background:#f1f5f9;color:#64748b;cursor:not-allowed'>";
  html += "</div></details>";

  html += "<button type='submit' class='submit'>Save &amp; Connect Device</button>";
  html += "</form></div></body></html>";

  httpd_resp_set_type(req, "text/html");
  httpd_resp_sendstr(req, html.c_str());
  return ESP_OK;
}

esp_err_t saveHandler(httpd_req_t *req) {
  char body[1024] = {0};
  int len = httpd_req_recv(req, body, sizeof body - 1);
  if (len <= 0) { httpd_resp_send_500(req); return ESP_FAIL; }
  body[len] = 0;

  char ssid[33] = {0}, pass[65] = {0}, broker[96] = {0}, devid[40] = {0};
  extractField(body, "ssid", ssid, sizeof ssid);
  extractField(body, "pass", pass, sizeof pass);
  extractField(body, "broker", broker, sizeof broker);
  extractField(body, "devid", devid, sizeof devid);

  if (!ssid[0]) {
    httpd_resp_set_type(req, "text/html");
    httpd_resp_sendstr(req, "<html><body><p>Network name can't be empty. <a href='/'>Go back</a></p></body></html>");
    return ESP_OK;
  }

  snprintf(s_new_ssid, sizeof s_new_ssid, "%s", ssid);
  snprintf(s_new_pass, sizeof s_new_pass, "%s", pass);

  if (broker[0]) {
    rmp::Prov::setBrokerUri(broker);
  }
  if (devid[0]) {
    rmp::Prov::setDeviceId(devid);
  }

  httpd_resp_set_type(req, "text/html");
  httpd_resp_sendstr(req,
                      "<!DOCTYPE html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>"
                      "<title>Saved</title>"
                      "<style>body{font-family:-apple-system,sans-serif;max-width:420px;margin:40px auto;padding:0 16px;text-align:center;color:#1e293b}"
                      ".card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px;box-shadow:0 2px 4px rgba(0,0,0,0.05)}"
                      "h2{color:#0958d9;margin-top:0}.btn{display:inline-block;padding:10px 20px;background:#0958d9;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;margin-top:16px}"
                      "</style></head><body>"
                      "<div class='card'>"
                      "<h2>✅ Configuration Saved!</h2>"
                      "<p>The reactor monitor is connecting to your Wi-Fi network now.</p>"
                      "<p style='font-size:0.9em;color:#64748b'>This setup hotspot will turn off once connected.<br>You can now monitor this device on the web dashboard.</p>"
                      "</div></body></html>");
  s_portal_done = true;
  return ESP_OK;
}

esp_err_t notFoundHandler(httpd_req_t *req, httpd_err_code_t) {
  // Captive-portal catch-all: every unrecognized path (including the probe URLs
  // phones/laptops use to detect a captive portal, e.g. /generate_204,
  // /hotspot-detect.html) redirects to the setup page.
  httpd_resp_set_status(req, "302 Found");
  httpd_resp_set_hdr(req, "Location", "/");
  httpd_resp_send(req, nullptr, 0);
  return ESP_OK;
}

void startHttpServer() {
  httpd_config_t cfg = HTTPD_DEFAULT_CONFIG();
  cfg.max_open_sockets = 4;
  ESP_ERROR_CHECK(httpd_start(&s_httpd, &cfg));
  static httpd_uri_t root_uri = {"/", HTTP_GET, &rootHandler, nullptr};
  static httpd_uri_t save_uri = {"/save", HTTP_POST, &saveHandler, nullptr};
  httpd_register_uri_handler(s_httpd, &root_uri);
  httpd_register_uri_handler(s_httpd, &save_uri);
  httpd_register_err_handler(s_httpd, HTTPD_404_NOT_FOUND, &notFoundHandler);
}

void stopHttpServer() {
  if (s_httpd) { httpd_stop(s_httpd); s_httpd = nullptr; }
}

}  // namespace

bool Net::connect(const char *ssid, const char *password, uint32_t timeout_ms) {
  startOrRestart(WIFI_MODE_STA);
  xEventGroupClearBits(s_event_group, kConnectedBit | kFailBit);
  s_retry = 0;
  s_connected = false;

  wifi_config_t wifi_config = {};
  strncpy((char *)wifi_config.sta.ssid, ssid, sizeof(wifi_config.sta.ssid) - 1);
  strncpy((char *)wifi_config.sta.password, password, sizeof(wifi_config.sta.password) - 1);
  wifi_config.sta.threshold.authmode = WIFI_AUTH_OPEN;  // Accept any AP security (Open, WPA2, WPA3)
  ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
  esp_wifi_connect();  // ignore return value -- harmless if a connect is already in flight

  EventBits_t bits = xEventGroupWaitBits(s_event_group, kConnectedBit | kFailBit, pdFALSE, pdFALSE,
                                          pdMS_TO_TICKS(timeout_ms));
  if (bits & kConnectedBit) {
    ESP_LOGI(kTag, "connected to ap SSID:%s", ssid);
    return true;
  }
  ESP_LOGW(kTag, "failed to connect to SSID:%s", ssid);
  return false;
}

bool Net::connectWithRetryWindow(const char *ssid, const char *password, uint32_t retry_window_ms) {
  uint32_t waited = 0;
  while (waited < retry_window_ms) {
    if (connect(ssid, password, 10000)) return true;
    vTaskDelay(pdMS_TO_TICKS(2000));
    waited += 12000;
  }
  return false;
}

bool Net::isConnected() const { return s_connected; }

void Net::ipString(char *out, size_t n) const {
  if (!s_connected) { if (n) out[0] = 0; return; }
  snprintf(out, n, IPSTR, IP2STR(&s_ip));
}

void Net::runProvisioningPortal() {
  startOrRestart(WIFI_MODE_APSTA);  // APSTA so we can scan for nearby networks while the AP is up
  if (!s_ap_netif_created) {
    esp_netif_create_default_wifi_ap();
    s_ap_netif_created = true;
  }

  wifi_config_t ap_cfg = {};
  strncpy((char *)ap_cfg.ap.ssid, kApSsid, sizeof(ap_cfg.ap.ssid) - 1);
  ap_cfg.ap.ssid_len = strlen(kApSsid);
  ap_cfg.ap.channel = 1;
  ap_cfg.ap.max_connection = 4;
  ap_cfg.ap.authmode = WIFI_AUTH_OPEN;  // short-lived local setup network, not a permanent AP
  ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP, &ap_cfg));

  s_new_ssid[0] = 0;
  s_new_pass[0] = 0;
  s_portal_done = false;
  s_dns_running = true;
  xTaskCreate(dnsHijackTask, "dns_hijack", 3072, nullptr, 3, nullptr);
  startHttpServer();

  ESP_LOGI(kTag, "provisioning portal up -- connect to Wi-Fi '%s' (open), then visit 192.168.4.1 if "
                 "the setup page doesn't open automatically",
           kApSsid);

  while (!s_portal_done) {
    vTaskDelay(pdMS_TO_TICKS(200));
  }

  s_dns_running = false;
  vTaskDelay(pdMS_TO_TICKS(1100));  // let dnsHijackTask's 1s recv timeout notice and exit cleanly
  stopHttpServer();
  Prov::setWifi(s_new_ssid, s_new_pass);
  ESP_LOGI(kTag, "Wi-Fi credentials saved, leaving provisioning mode");
}

}  // namespace rmp
