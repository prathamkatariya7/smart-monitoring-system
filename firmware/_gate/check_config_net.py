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
    buf = ser.read(ser.in_waiting or 1)
    return buf.decode("utf-8", errors="replace")

print("--- show config (1st, may be garbled) ---")
print(send("show config"))
print("--- show config (2nd) ---")
print(send("show config"))
print("--- net ---")
print(send("net"))

ser.close()
