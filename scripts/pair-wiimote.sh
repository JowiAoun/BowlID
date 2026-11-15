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

echo "Scanning for a Wii remote for ${SCAN_SECONDS}s. Press the red SYNC button now."
bluetoothctl --timeout "$SCAN_SECONDS" scan on >/dev/null 2>&1 &
SCAN_PID=$!
trap 'kill "$SCAN_PID" 2>/dev/null' EXIT

END=$((SECONDS + SCAN_SECONDS))
while [ "$SECONDS" -lt "$END" ]; do
  MAC="$(find_remote)"
  if [ -n "$MAC" ]; then
    if is_connected "$MAC"; then
      echo "Wii remote $MAC is connected."
      exit 0
    fi
    echo "Found $MAC. Connecting."
    bluetoothctl trust "$MAC" >/dev/null 2>&1
    # A Wii remote often refuses a normal pair. A plain connect works while it is in sync mode.
    timeout 15 bluetoothctl pair "$MAC" >/dev/null 2>&1
    timeout 15 bluetoothctl connect "$MAC" >/dev/null 2>&1
    if is_connected "$MAC"; then
      echo "Wii remote $MAC is connected."
      exit 0
    fi
  fi
  sleep 1
done

echo "No Wii remote connected after ${SCAN_SECONDS}s." >&2
echo "Try again, and press SYNC right after starting the script." >&2
exit 1
