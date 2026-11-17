. "D:\Pratham\Firmware\Cortex IDE\Smart Monitoring System\firmware\activate-esp-idf.ps1"
Set-Location "D:\Pratham\Firmware\Cortex IDE\Smart Monitoring System\firmware\_gate\10_wifistation"
$env:SDKCONFIG_DEFAULTS = "sdkconfig.defaults;D:\Pratham\Firmware\Cortex IDE\Smart Monitoring System\config\esp32p4_rev1_3.defaults"
idf.py set-target esp32p4
