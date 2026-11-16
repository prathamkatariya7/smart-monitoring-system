import re

path = "sdkconfig"
with open(path) as f:
    content = f.read()

content = re.sub(r'CONFIG_ESP_WIFI_SSID=".*"', 'CONFIG_ESP_WIFI_SSID="+"', content)
content = re.sub(r'CONFIG_ESP_WIFI_PASSWORD=".*"', 'CONFIG_ESP_WIFI_PASSWORD=""', content)
content = re.sub(r'CONFIG_ESP_WIFI_AUTH_WPA2_PSK=y', 'CONFIG_ESP_WIFI_AUTH_OPEN=y', content)

with open(path, "w") as f:
    f.write(content)

print("sdkconfig patched")
