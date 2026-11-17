# Builds and runs the RMP host-testable logic: ring buffer, RTD math, and MQTT/cfg JSON
# parsing. These compile and run as plain host (PC) executables via MinGW g++ -- no
# ESP-IDF toolchain or hardware needed. See docs/SPEC.md section 9 (M0 "host tests ported").
#
# Usage: powershell -File .\run_tests.ps1

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$ref = Join-Path (Split-Path $root -Parent) "reference\arduino_m1"
$fails = 0

function Run-Test($name, $cmd) {
    Write-Output "=== $name ==="
    & cmd /c $cmd
    if ($LASTEXITCODE -ne 0) {
        Write-Output "--- $name FAILED (exit $LASTEXITCODE) ---"
        $script:fails++
    } else {
        Write-Output "--- $name passed ---"
    }
    Write-Output ""
}

# 1. Ring buffer (ported unchanged from the Arduino prototype's ring_store.h / rmp_types.h;
#    will be re-hosted onto ESP-IDF's native esp_partition API as components/rmp_ring in M2).
$ringExe = Join-Path $root "test_ring.exe"
Run-Test "test_ring" "g++ -std=c++17 -static -I `"$ref\tests\shim`" -I `"$ref`" `"$ref\tests\test_ring.cpp`" -o `"$ringExe`" && `"$ringExe`""

# 2. RTD / Callendar-Van Dusen math (ported unchanged; will become components/rmp_rtd in M1).
$rtdExe = Join-Path $root "test_rtd.exe"
Run-Test "test_rtd" "g++ -std=c++17 -static -I `"$ref\tests\shim`" -I `"$ref`" `"$ref\tests\test_rtd.cpp`" -o `"$rtdExe`" && `"$rtdExe`""

# 3. Wire-contract JSON parsing (rewritten against cJSON; this is the real components/rmp_types
#    source, not a copy -- see test_proto.cpp).
$rmpTypesInc = Join-Path (Split-Path $root -Parent) "components\rmp_types\include"
$rmpTypesSrc = Join-Path (Split-Path $root -Parent) "components\rmp_types\rmp_proto.c"
$cjson = Join-Path $root "vendor\cjson"
$protoExe = Join-Path $root "test_proto.exe"
Run-Test "test_proto" "g++ -std=c++17 -static -I `"$rmpTypesInc`" -I `"$cjson`" `"$root\test_proto.cpp`" `"$rmpTypesSrc`" `"$cjson\cJSON.c`" -o `"$protoExe`" && `"$protoExe`""

Write-Output "============================="
if ($fails -eq 0) {
    Write-Output "ALL HOST TEST SUITES PASSED"
} else {
    Write-Output "$fails HOST TEST SUITE(S) FAILED"
}
exit $fails
