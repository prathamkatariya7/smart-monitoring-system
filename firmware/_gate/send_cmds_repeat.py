import serial
import time

port = "COM20"
baud = 115200

ser = serial.Serial(port, baud, timeout=1)
time.sleep(0.3)
ser.reset_input_buffer()

for i in range(6):
    ser.write(b"rtd\n")
    time.sleep(0.8)

time.sleep(0.5)
data = ser.read(ser.in_waiting or 1)
text = data.decode("utf-8", errors="replace")
print(text.encode("ascii", errors="replace").decode("ascii"))
ser.close()
