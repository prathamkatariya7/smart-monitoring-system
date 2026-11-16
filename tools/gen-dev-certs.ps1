# Generates a local development CA + server certificate for Mosquitto mTLS,
# and a client certificate for the device simulator (tools/device-simulator).
# Uses a disposable alpine/openssl Docker container so nothing needs to be
# installed on the host. Free/open-source only; nothing phones out.
#
# Usage: ./tools/gen-dev-certs.ps1
# Re-run any time to rotate dev certs; production device certs are issued by
# the real device-CA flow in the devices module, not this script.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$certsDir = Join-Path $root "infra\mosquitto\certs"
New-Item -ItemType Directory -Force -Path $certsDir | Out-Null

$opensslImage = "alpine/openssl:latest"

function Run-Openssl($opensslArgs) {
  docker run --rm -v "${certsDir}:/certs" -w /certs $opensslImage @opensslArgs
}

Write-Host "Generating dev CA..."
Run-Openssl @("genrsa", "-out", "ca.key", "4096")
Run-Openssl @("req", "-x509", "-new", "-nodes", "-key", "ca.key", "-sha256", "-days", "3650",
  "-out", "ca.crt", "-subj", "/O=ReactorMonitoringPlatform-Dev/CN=RMP-Dev-CA",
  "-addext", "basicConstraints=critical,CA:true", "-addext", "keyUsage=critical,keyCertSign,cRLSign")

Write-Host "Generating broker (server) cert..."
Run-Openssl @("genrsa", "-out", "server.key", "2048")
Run-Openssl @("req", "-new", "-key", "server.key", "-out", "server.csr",
  "-subj", "/O=ReactorMonitoringPlatform-Dev/CN=mosquitto",
  "-addext", "subjectAltName=DNS:mosquitto,DNS:localhost,DNS:BSLP-LAP-PRATHA.local,DNS:BSLP-LAP-PRATHA,DNS:rmp-server.local,DNS:rmp-server,IP:127.0.0.1,IP:172.16.50.138,IP:192.168.1.101,IP:10.138.201.92,IP:10.184.237.92")
Run-Openssl @("x509", "-req", "-in", "server.csr", "-CA", "ca.crt", "-CAkey", "ca.key",
  "-CAcreateserial", "-out", "server.crt", "-days", "825", "-sha256", "-copy_extensions", "copy")

Write-Host "Generating a sample device client cert (CN=dev-device-0001)..."
Run-Openssl @("genrsa", "-out", "device-0001.key", "2048")
Run-Openssl @("req", "-new", "-key", "device-0001.key", "-out", "device-0001.csr",
  "-subj", "/O=ReactorMonitoringPlatform-Dev/CN=dev-device-0001")
Run-Openssl @("x509", "-req", "-in", "device-0001.csr", "-CA", "ca.crt", "-CAkey", "ca.key",
  "-CAcreateserial", "-out", "device-0001.crt", "-days", "825", "-sha256")

Write-Host "Generating the backend's own mTLS client cert (CN=rmp-backend)..."
Run-Openssl @("genrsa", "-out", "backend.key", "2048")
Run-Openssl @("req", "-new", "-key", "backend.key", "-out", "backend.csr",
  "-subj", "/O=ReactorMonitoringPlatform-Dev/CN=rmp-backend")
Run-Openssl @("x509", "-req", "-in", "backend.csr", "-CA", "ca.crt", "-CAkey", "ca.key",
  "-CAcreateserial", "-out", "backend.crt", "-days", "825", "-sha256")

Write-Host "Done. Certs written to $certsDir"
Write-Host "NOTE: these are DEV ONLY certs with the private CA key sitting on disk unencrypted."
Write-Host "Never reuse this CA for a real factory/production deployment."

# The openssl container writes keys as root:root mode 600. Mosquitto drops
# privileges to its own "mosquitto" user, which then can't read a 600 file
# owned by root -- it fails with "Permission denied" at startup. Dev-only
# certs, so loosen to 644 rather than fighting container UID mapping.
Write-Host "Fixing key file permissions for the mosquitto container user..."
docker run --rm -v "${certsDir}:/certs" alpine chmod 644 /certs/ca.key /certs/server.key /certs/device-0001.key /certs/backend.key
