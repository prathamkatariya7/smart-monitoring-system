import serial, time
ser = serial.Serial('COM20', 115200, timeout=1)
time.sleep(0.3)
ser.write(b'alert off\n')
time.sleep(0.5)
ser.close()
