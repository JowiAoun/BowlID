#!/usr/bin/env bash
# Scan for a Wii remote and connect it. Press the red SYNC button (or hold 1+2) while this runs.
# Usage: ./scripts/pair-wiimote.sh [seconds to scan, default 120]
set -u

SCAN_SECONDS="${1:-120}"

if ! command -v bluetoothctl >/dev/null; then
  echo "bluetoothctl is missing. Run: sudo apt install bluez" >&2
  exit 2
fi

bluetoothctl power on >/dev/null 2>&1

find_remote() {
  bluetoothctl devices | grep -i 'Nintendo RVL' | head -1 | awk '{print $2}'
}

is_connected() {
  bluetoothctl info "$1" 2>/dev/null | grep -q 'Connected: yes'
}

# Connected over Bluetooth is not enough: the kernel driver must also make the input devices.
# When it could not, fix-driver.sh gives it another go.
finish() {
  echo "Wii remote $1 is connected."
  for _ in 1 2 3 4 5 6; do
    grep -q 'Name="Nintendo Wii Remote' /proc/bus/input/devices 2>/dev/null && exit 0
    sleep 0.5
  done
  echo "The kernel driver did not start for the remote. Trying to fix it."
  "$(dirname "$0")/fix-driver.sh"
  exit $?
}

echo "Scanning for a Wii remote for ${SCAN_SECONDS}s. Press the red SYNC button now."
bluetoothctl --timeout "$SCAN_SECONDS" scan on >/dev/null 2>&1 &
SCAN_PID=$!
trap 'kill "$SCAN_PID" 2>/dev/null' EXIT

END=$((SECONDS + SCAN_SECONDS))
while [ "$SECONDS" -lt "$END" ]; do
  MAC="$(find_remote)"
  if [ -n "$MAC" ]; then
    if is_connected "$MAC"; then
      finish "$MAC"
    fi
    echo "Found $MAC. Connecting."
    bluetoothctl trust "$MAC" >/dev/null 2>&1
    # A Wii remote often refuses a normal pair. A plain connect works while it is in sync mode.
    timeout 15 bluetoothctl pair "$MAC" >/dev/null 2>&1
    timeout 15 bluetoothctl connect "$MAC" >/dev/null 2>&1
    if is_connected "$MAC"; then
      finish "$MAC"
    fi
  fi
  sleep 1
done

echo "No Wii remote connected after ${SCAN_SECONDS}s." >&2
echo "Try again, and press SYNC right after starting the script." >&2
exit 1
