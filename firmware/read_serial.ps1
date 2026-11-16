param([string]$Port = "COM20", [int]$Seconds = 6)
$sp = New-Object System.IO.Ports.SerialPort($Port, 115200, "None", 8, "One")
$sp.ReadTimeout = 1000
$sp.DtrEnable = $true
$sp.RtsEnable = $false
try {
    $sp.Open()
    $end = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $end) {
        try {
            $line = $sp.ReadLine()
            if ($line) { Write-Host $line }
        } catch [System.TimeoutException] {}
    }
} finally {
    if ($sp -and $sp.IsOpen) { $sp.Close() }
}
