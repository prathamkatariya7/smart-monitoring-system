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

print("--- reboot ---")
send("reboot", wait=4)
time.sleep(8)
ser.reset_input_buffer()
print("--- status (1st, may be garbled) ---")
print(send("status"))
print("--- status (2nd) ---")
print(send("status"))
print("--- rtd ---")
print(send("rtd"))

ser.close()
