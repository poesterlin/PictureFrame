import os, time, select, fcntl, termios
# Open with proper termios config
fd = os.open('/dev/ttyACM0', os.O_RDWR | os.O_NOCTTY)
os.system('stty -F /dev/ttyACM0 115200 raw -echo -echoe -echok -ixon -ixoff clocal 2>/dev/null')
# Reset
TIOCMGET = 0x5415
TIOCMSET = 0x5418
TIOCM_DTR = 0x002
TIOCM_RTS = 0x004
buf = bytearray([0, 0, 0, 0])
fcntl.ioctl(fd, TIOCMGET, buf)
bits = buf[0] | (buf[1] << 8)
bits &= ~TIOCM_DTR
bits |= TIOCM_RTS
buf2 = bytearray([bits & 0xFF, (bits >> 8) & 0xFF, 0, 0])
fcntl.ioctl(fd, TIOCMSET, buf2)
time.sleep(0.1)
bits |= TIOCM_DTR
bits &= ~TIOCM_RTS
buf3 = bytearray([bits & 0xFF, (bits >> 8) & 0xFF, 0, 0])
fcntl.ioctl(fd, TIOCMSET, buf3)
deadline = time.time() + 120
output = b''
while time.time() < deadline:
    r, _, _ = select.select([fd], [], [], 0.5)
    if r:
        try:
            data = os.read(fd, 4096)
            if data:
                output += data
                print(data.decode('utf-8', errors='replace'), end='')
        except:
            break
os.close(fd)
# text = output.decode('utf-8', errors='replace')
# for line in text.split('\n'):
#     print(line)