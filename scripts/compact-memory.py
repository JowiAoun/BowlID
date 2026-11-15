#!/usr/bin/env python3
"""Make the kernel tidy its memory into large free blocks, without sudo.

The hid-wiimote driver needs one free 1 MB block when a remote connects. On a laptop
that has been on for days, memory is split into small pieces and the driver fails with
"Can't alloc device". Asking for huge pages makes the kernel move things together.
Giving them back right away leaves large free blocks for the driver.

Usage: compact-memory.py [megabytes, default 256]
"""
import mmap
import sys

# The Linux value of MADV_HUGEPAGE. Older Python versions do not name it.
MADV_HUGEPAGE = 14

size = (int(sys.argv[1]) if len(sys.argv) > 1 else 256) * 1024 * 1024
block = mmap.mmap(-1, size, flags=mmap.MAP_PRIVATE | mmap.MAP_ANONYMOUS)
block.madvise(MADV_HUGEPAGE)

# Touch every page so the kernel really hands the memory out.
for offset in range(0, size, 4096):
    block[offset] = 1

huge_kb = 0
with open("/proc/self/smaps_rollup") as rollup:
    for line in rollup:
        if line.startswith("AnonHugePages"):
            huge_kb = int(line.split()[1])

print("Huge pages got: %d kB of %d kB" % (huge_kb, size // 1024))
block.close()
