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

print("--- set broker (1st, may be garbled) ---")
print(send("set broker 10.184.237.92 18883"))
print("--- set broker (2nd, confirm) ---")
print(send("set broker 10.184.237.92 18883"))
print("--- show config ---")
print(send("show config"))
print("--- reboot ---")
print(send("reboot", wait=3))

ser.close()
