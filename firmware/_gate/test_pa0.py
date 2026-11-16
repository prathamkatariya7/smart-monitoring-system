import serial
import time

port = "COM20"
baud = 115200

ser = serial.Serial(port, baud, timeout=1)
time.sleep(0.3)
ser.reset_input_buffer()
ser.write(b"pa 0\n")
time.sleep(0.3)
ser.write(b"tone\n")
time.sleep(1.5)

start = time.time()
buf = b""
while time.time() - start < 3:
    chunk = ser.read(ser.in_waiting or 1)
    if chunk:
        buf += chunk

text = buf.decode("utf-8", errors="replace")
print(text.encode("ascii", errors="replace").decode("ascii"))
ser.close()
