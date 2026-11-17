import serial
import time

ser = serial.Serial("COM20", 115200, timeout=1)
time.sleep(0.3)
ser.reset_input_buffer()
ser.write(b"alert off\n")
time.sleep(0.5)
ser.write(b"alert off\n")
time.sleep(0.5)
buf = ser.read(ser.in_waiting or 1)
print(buf.decode("utf-8", errors="replace").encode("ascii", errors="replace").decode("ascii"))
ser.close()
