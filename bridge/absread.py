"""Print the current value of some absolute axes of an input device.

The kernel only sends an axis when it changes, so a device that was just opened does not
say where its axes are. This asks with the EVIOCGABS ioctl, which Node cannot call.

Usage: absread.py /dev/input/eventN CODE [CODE ...]
"""
import fcntl
import os
import struct
import sys

# EVIOCGABS(0): read a 24-byte struct input_absinfo. The axis code is added to it.
EVIOCGABS = 0x80184540

fd = os.open(sys.argv[1], os.O_RDONLY | os.O_NONBLOCK)
values = []
for code in sys.argv[2:]:
    info = fcntl.ioctl(fd, EVIOCGABS + int(code), bytes(24))
    values.append(str(struct.unpack("6i", info)[0]))
os.close(fd)
print(" ".join(values))
