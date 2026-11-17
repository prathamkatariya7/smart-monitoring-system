import serial
import time
import sys

port = "COM20"
baud = 115200
duration = 20

ser = serial.Serial(port, baud, timeout=1)
start = time.time()
buf = b""
while time.time() - start < duration:
    chunk = ser.read(ser.in_waiting or 1)
    if chunk:
        buf += chunk
ser.close()

text = buf.decode("utf-8", errors="replace")
print(text)
