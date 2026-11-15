#!/usr/bin/env bash
# Start BowlID: the Wii remote bridge and the web app. Ctrl+C stops both.
# Usage: ./scripts/start.sh          Live Wii mode (Linux).
#        ./scripts/start.sh --demo   Browser demo only, no bridge. This is the default off Linux.
set -u

cd "$(dirname "$0")/.." || exit 1

if [ ! -d node_modules ]; then
  echo "Dependencies are missing. Run ./scripts/setup-ubuntu.sh first (or 'npm install' on a Mac)." >&2
  exit 1
fi

# Take the bridge port from .env when it is set there.
if [ -z "${BOWLBANK_BRIDGE_PORT:-}" ] && [ -f .env ]; then
  PORT_LINE="$(grep -E '^BOWLBANK_BRIDGE_PORT=[0-9]+' .env | tail -1)"
  [ -n "$PORT_LINE" ] && export BOWLBANK_BRIDGE_PORT="${PORT_LINE#*=}"
fi

WITH_BRIDGE=1
[ "${1:-}" = "--demo" ] && WITH_BRIDGE=0
if [ "$WITH_BRIDGE" -eq 1 ] && [ "$(uname -s)" != "Linux" ]; then
  echo "The Wii remote bridge needs Linux. Starting the browser demo only."
  WITH_BRIDGE=0
fi

BRIDGE_PID=""
DEV_PID=""

# Stop a process and everything it started.
kill_tree() {
  local child
  for child in $(pgrep -P "$1" 2>/dev/null); do kill_tree "$child"; done
  kill "$1" 2>/dev/null
}

cleanup() {
  trap - EXIT INT TERM
  [ -n "$DEV_PID" ] && kill_tree "$DEV_PID"
  [ -n "$BRIDGE_PID" ] && kill_tree "$BRIDGE_PID"
  wait 2>/dev/null
}
trap cleanup EXIT
trap 'cleanup; exit 130' INT TERM

if [ "$WITH_BRIDGE" -eq 1 ]; then
  node bridge/bridge.mjs &
  BRIDGE_PID=$!
  sleep 0.5
  if ! kill -0 "$BRIDGE_PID" 2>/dev/null; then
    echo "The bridge did not start. Read the message above." >&2
    exit 1
  fi
  echo
  echo "Open http://localhost:5173/?mode=wii for live Wii mode."
  echo "No remote yet? Run ./scripts/pair-wiimote.sh in another terminal."
else
  echo "Open http://localhost:5173/ for the browser demo."
fi
echo "Press Ctrl+C to stop."
echo

# Run in the background and wait, so Ctrl+C is handled right away.
npm run dev &
DEV_PID=$!
wait "$DEV_PID"
