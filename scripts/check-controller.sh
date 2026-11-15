#!/usr/bin/env bash
# Check the Wii remote: Bluetooth, buttons, accelerometer, MotionPlus and the IR camera.
# It reads the real sensors for a few seconds, so press buttons and move the remote while it runs.
# Usage: ./scripts/check-controller.sh [--seconds 6]
set -u

cd "$(dirname "$0")/.." || exit 1

if ! command -v node >/dev/null; then
  echo "Node.js is missing. Run ./scripts/setup-ubuntu.sh first." >&2
  exit 1
fi

# The bridge and the check can both read the remote, so the app can stay open.
exec node bridge/check.mjs "$@"
