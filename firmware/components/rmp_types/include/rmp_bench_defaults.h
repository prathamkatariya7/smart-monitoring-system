#pragma once
// =============================================================================
// THE ONE FILE TO EDIT for any first-boot / dev-bench default that tends to
// change (Wi-Fi SSID, broker IP, device UUID). If something stops working
// after a reconnect/reboot and the fix is "update an IP/SSID somewhere" --
// it's a line in THIS file, nowhere else.
//
// IMPORTANT -- these are FIRST-BOOT DEFAULTS ONLY. Once a device has been
// provisioned (either through the Wi-Fi captive portal, or the `set wifi` /
// `set broker` / `set devid` serial console commands -- see rmp_prov), the
// values actually used come from NVS, not from this header, and changing
// this file has NO effect on an already-provisioned device. Use the console
// commands for that instead -- no rebuild/reflash needed. This header only
// matters for (a) a brand-new device that has never been provisioned, or
// (b) after `prov reset` wipes the stored NVS values back to these defaults.
//
// THE REAL FIX for the dev-machine-IP-keeps-changing problem: set a static
// DHCP reservation for this machine's MAC address in your Wi-Fi router's
// admin page (reserve whatever IP it has right now). That makes the IP
// permanent with zero firmware/software complexity, so this file (and the
// mosquitto TLS cert's SAN list) never needs touching again. This is a
// one-time, outside-this-repo fix -- do it once and forget about it.
// A custom mDNS responder was considered and rejected: it's another
// long-running process to keep alive on the dev machine, unproven on this
// specific machine, and it still wouldn't remove the need to keep the TLS
// cert's SAN list in sync -- not worth the extra moving part for a problem a
// router setting fixes for good. If the router reservation genuinely isn't
// possible (e.g. no router admin access), fall back to the `set broker`
// console command below -- one command, no rebuild, after any IP change.
// =============================================================================

// --- Wi-Fi (first-boot default only; overridden by NVS after provisioning) ---
// Leave both empty ("") to force every fresh device straight into the
// captive-portal provisioning flow on first boot (recommended for anything
// other than this one bench unit).
#define BENCH_WIFI_SSID "BSL_PUNE"
#define BENCH_WIFI_PASSWORD "BSL@tech2024!"

// --- MQTT broker (first-boot default only; overridden by NVS after `set
// broker`) --- Dev Mosquitto broker, host-mapped port 18883. LAN IP, NOT
// localhost -- the ESP32 is a separate device on the network. See the
// DHCP-reservation note above before just editing this value again.
#define BENCH_MQTT_BROKER_URI "mqtts://172.16.50.141:18883"
#define BENCH_MQTT_BROKER_DEFAULT_PORT                                         \
  18883 // used by the `set broker HOST [PORT]` console command

// --- Device identity (first-boot default only; overridden by NVS after `set
// devid`) --- DEV-0001, already claimed + bound to "Reactor 25" (Hyderabad
// Plant / QC Lab 1) in the dev backend -- see
// infra/mosquitto/certs/device-0001.{crt,key} (CN=dev-device-0001).
#define BENCH_DEVICE_ID "01a1af2d-e705-75aa-b3fc-25b0cebb4882"
