# flash.ps1 — Auto-detect ESP32 COM port and flash firmware.
. "$PSScriptRoot\activate-esp-idf.ps1"
Set-Location $PSScriptRoot

$port = $null

# 1. Try .NET SerialPort enumeration (works without CIM permissions)
$netPorts = [System.IO.Ports.SerialPort]::GetPortNames()
if ($netPorts -and $netPorts.Count -gt 0) {
    # If multiple ports exist, prefer COM20 or USB serial ports if detectable
    if ($netPorts -contains "COM20") {
        $port = "COM20"
    } else {
        $port = $netPorts[0]
    }
}

# 2. Try WMI / CIM if .NET yielded nothing
if (-not $port) {
    $candidates = Get-CimInstance Win32_PnPEntity -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match 'COM\d+' -and ($_.Name -match 'CP210|CH340|CH9102|FTDI|USB.*Serial|JTAG') } |
        ForEach-Object { if ($_.Name -match '(COM\d+)') { $matches[1] } }
    if ($candidates) {
        $port = @($candidates)[0]
    }
}

# 3. Fallback
if (-not $port) {
    $port = "COM20"
    Write-Host "Could not auto-detect ESP32 port, falling back to $port" -ForegroundColor Yellow
} else {
    Write-Host "Detected ESP32 port: $port" -ForegroundColor Green
}

idf.py -p $port flash
