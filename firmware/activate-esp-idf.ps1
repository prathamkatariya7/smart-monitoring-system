# Activates the ESP-IDF v5.5.6 toolchain correctly on this machine.
#
# Why this exists instead of just calling export.ps1 / Initialize-Idf.ps1:
# this machine has multiple Pythons on PATH (a system Python 3.15 resolves
# first). ESP-IDF's own export.ps1 and Initialize-Idf.ps1 both compute the
# expected venv folder name ("idf5.5_py<major.minor>_env") using whatever
# `python` resolves on PATH *at export time*, not the Python actually used
# when the venv was created (3.11.2, bundled by the installer). That
# mismatch produces the confusing "ESP-IDF Python virtual environment ...
# not found" error. It also defaults IDF_TOOLS_PATH to the per-user
# ~/.espressif folder, but this install's tools/python_env/frameworks all
# live under C:\Espressif instead.
#
# Fix: set IDF_TOOLS_PATH explicitly to the real install root, and invoke
# activate.py with the exact bundled Python 3.11.2 interpreter so the venv
# path resolves correctly every time, regardless of what else is on PATH.
#
# Usage (from a PowerShell prompt, in this firmware/ directory or anywhere):
#   . .\activate-esp-idf.ps1
# (the leading ". " is required -- this must be dot-sourced so the
# environment variables and the `idf.py`/`esptool.py` functions persist in
# your current shell, not a child process).

$env:IDF_TOOLS_PATH = "C:\Espressif"
$env:IDF_PATH = "C:\Espressif\frameworks\esp-idf-v5.5.6"
$idfPython = "C:\Espressif\tools\idf-python\3.11.2\python.exe"

$idf_exports = & $idfPython "$env:IDF_PATH\tools\activate.py" --export
if ($LASTEXITCODE -ne 0) {
    Write-Error "ESP-IDF activation failed. See output above."
    return
}
$idf_exports | Out-String | Invoke-Expression

Write-Output "ESP-IDF activated: ESP_IDF_VERSION=$env:ESP_IDF_VERSION, IDF_PYTHON_ENV_PATH=$env:IDF_PYTHON_ENV_PATH"
