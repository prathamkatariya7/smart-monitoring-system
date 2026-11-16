import serial
import time

port = "COM20"
baud = 115200

ser = serial.Serial(port, baud, timeout=1)
time.sleep(0.3)
ser.reset_input_buffer()

def send(cmd, wait=1.5):
    ser.write((cmd + "\n").encode())
    time.sleep(wait)

send("status")
send("rtd")

time.sleep(0.5)
data = ser.read(ser.in_waiting or 1)
print(data.decode("utf-8", errors="replace"))
ser.close()
