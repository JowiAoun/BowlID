#!/usr/bin/env bash
# Fix a Wii remote that is connected over Bluetooth but has no input devices.
# The cause is the kernel log line "wiimote ...: Can't alloc device": the driver could not get
# one large block of memory. This tidies memory and starts the remote's HID link again, so the
# driver gets a second go. No sudo and no button press needed.
# Usage: ./scripts/fix-driver.sh
set -u

cd "$(dirname "$0")/.." || exit 1

HID_UUID="00001124-0000-1000-8000-00805f9b34fb"
TRIES=3

has_input() {
  grep -q 'Name="Nintendo Wii Remote' /proc/bus/input/devices 2>/dev/null
}

connected_mac() {
  bluetoothctl devices Connected 2>/dev/null | grep -i 'Nintendo RVL' | head -1 | awk '{print $2}'
}

wait_for_input() {
  local i
  for i in 1 2 3 4 5 6 7 8 9 10; do
    has_input && return 0
    sleep 0.5
  done
  return 1
}

if has_input; then
  echo "The Wii remote driver is running. Nothing to fix."
  exit 0
fi

MAC="$(connected_mac)"
if [ -z "$MAC" ]; then
  echo "No Wii remote is connected over Bluetooth. Run ./scripts/pair-wiimote.sh first." >&2
  exit 1
fi

# The D-Bus path of the remote, like /org/bluez/hci0/dev_00_24_1E_7E_31_6B.
DEV_PATH="$(busctl --system tree org.bluez --list 2>/dev/null | grep -m1 "/dev_${MAC//:/_}\$")"
if [ -z "$DEV_PATH" ]; then
  echo "Could not find $MAC on the Bluetooth D-Bus service." >&2
  exit 1
fi

PYTHON="$(command -v python3 || true)"

for try in $(seq 1 "$TRIES"); do
  echo "Try $try of $TRIES: tidying memory, then starting the remote's HID link again."
  if [ -n "$PYTHON" ]; then
    "$PYTHON" scripts/compact-memory.py 256 || true
  else
    echo "python3 is missing, so memory was not tidied."
  fi
  busctl --system call org.bluez "$DEV_PATH" org.bluez.Device1 DisconnectProfile s "$HID_UUID" >/dev/null 2>&1
  sleep 0.3
  busctl --system call org.bluez "$DEV_PATH" org.bluez.Device1 ConnectProfile s "$HID_UUID" >/dev/null 2>&1
  if wait_for_input; then
    echo "Fixed. The Wii remote driver is running."
    exit 0
  fi
  if [ -z "$(connected_mac)" ]; then
    echo "The remote disconnected. Press any button on it, then run this script again." >&2
    exit 1
  fi
done

cat >&2 <<EOF
The driver still could not start after $TRIES tries.
Close heavy apps (browsers, editors), then run:
  echo 1 | sudo tee /proc/sys/vm/compact_memory
  ./scripts/fix-driver.sh
A reboot also fixes it.
EOF
exit 1
