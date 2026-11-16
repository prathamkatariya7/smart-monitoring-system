. "D:\Pratham\Firmware\Cortex IDE\Smart Monitoring System\firmware\activate-esp-idf.ps1"
Set-Location "D:\Pratham\Firmware\Cortex IDE\Smart Monitoring System\firmware\_gate\10_wifistation"
python "D:\Pratham\Firmware\Cortex IDE\Smart Monitoring System\firmware\_gate\patch_wifi_config.py"
Select-String -Path sdkconfig -Pattern "CONFIG_ESP_WIFI_SSID|CONFIG_ESP_WIFI_AUTH"
