#!/usr/bin/env bash
# Set up BowlBank on the Ubuntu demo laptop. Safe to run again: it only fixes what is missing,
# and it asks before every command that needs sudo.
# Usage: ./scripts/setup-ubuntu.sh
set -u

cd "$(dirname "$0")/.." || exit 1

PROBLEMS=0
ok() { printf '[ OK ] %s\n' "$1"; }
info() { printf '[INFO] %s\n' "$1"; }
bad() { printf '[FAIL] %s\n' "$1"; PROBLEMS=$((PROBLEMS + 1)); }

# Ask a yes/no question. With no terminal (a script or CI), the answer is no.
ask() {
  local reply
  [ -t 0 ] || return 1
  read -r -p "$1 [y/N] " reply
  [[ "$reply" =~ ^[Yy] ]]
}

# Show a sudo command, and run it only after a yes.
offer_sudo() {
  local why="$1"
  shift
  echo "       $why"
  echo "       Command: sudo $*"
  if ask "       Run it now?"; then
    sudo "$@"
  else
    echo "       Skipped. Run it yourself later."
    return 1
  fi
}

echo "BowlBank setup"
echo

# Operating system.
if [ -r /etc/os-release ]; then
  . /etc/os-release
  if [ "${ID:-}" = "ubuntu" ]; then
    ok "Ubuntu ${VERSION_ID:-} found"
  else
    info "This is ${PRETTY_NAME:-not Ubuntu}. The script targets Ubuntu 24.04, so some steps may not fit."
  fi
else
  info "This is not Linux. Use 'npm install' and 'npm run dev' for the browser demo without a Wii remote."
fi

# Node.js 20 or newer.
NODE_MAJOR=0
if command -v node >/dev/null; then
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
fi
if [ "$NODE_MAJOR" -ge 20 ]; then
  ok "Node.js $(node -v) found"
else
  if [ "$NODE_MAJOR" -eq 0 ]; then bad "Node.js is missing"; else bad "Node.js $(node -v) is too old, 20 or newer is needed"; fi
  if offer_sudo "Node.js 22 can be installed as a snap." snap install node --classic --channel=22; then
    hash -r
    command -v node >/dev/null && PROBLEMS=$((PROBLEMS - 1)) && ok "Node.js $(node -v) installed"
  fi
fi

# Bluetooth tools and service.
if command -v bluetoothctl >/dev/null; then
  ok "BlueZ found"
else
  bad "BlueZ (bluetoothctl) is missing"
  offer_sudo "BlueZ is the Linux Bluetooth stack." apt-get install -y bluez && PROBLEMS=$((PROBLEMS - 1))
fi
if command -v systemctl >/dev/null && command -v bluetoothctl >/dev/null; then
  if systemctl is-active --quiet bluetooth; then
    ok "Bluetooth service is running"
  else
    bad "Bluetooth service is not running"
    offer_sudo "The service must run to pair the remote." systemctl enable --now bluetooth && PROBLEMS=$((PROBLEMS - 1))
  fi
fi

# Kernel driver for the Wii remote.
if [ -d /sys/module/hid_wiimote ] || modinfo hid-wiimote >/dev/null 2>&1; then
  ok "hid-wiimote kernel driver found"
else
  bad "hid-wiimote kernel driver is missing"
  offer_sudo "The driver ships in the extra kernel modules." apt-get install -y "linux-modules-extra-$(uname -r)" && PROBLEMS=$((PROBLEMS - 1))
fi

# Permission to read input devices.
if id -nG | tr ' ' '\n' | grep -qx input; then
  ok "User $USER is in the input group"
else
  bad "User $USER is not in the input group, so the bridge cannot read the remote"
  if offer_sudo "This adds you to the input group." usermod -aG input "$USER"; then
    PROBLEMS=$((PROBLEMS - 1))
    info "Log out and back in for the group to take effect."
  fi
fi

# JavaScript dependencies.
if command -v npm >/dev/null && [ -f package.json ]; then
  echo
  echo "Installing JavaScript dependencies."
  if npm install --no-audit --no-fund; then
    ok "Dependencies installed"
  else
    bad "npm install failed. Read the output above."
  fi
else
  bad "npm or package.json is missing, so dependencies were not installed"
fi

# Local configuration. Every key in it is optional.
if [ -f .env ]; then
  ok ".env already exists, left as it is"
elif [ -f .env.example ]; then
  cp .env.example .env
  ok "Created .env from .env.example. The app runs with the keys left empty."
fi

echo
if [ "$PROBLEMS" -eq 0 ]; then
  echo "Setup is done."
else
  echo "Setup finished with $PROBLEMS problem(s). Fix them, then run this script again."
fi

cat <<'EOF'

Pair the Wii remote
  1. Run ./scripts/pair-wiimote.sh
  2. Press the red SYNC button under the battery cover. The four lights blink.
     (Holding 1 and 2 together also works, but the remote forgets the laptop afterward.)
  3. Wait for "Wii remote ... is connected."

Then
  ./scripts/check-controller.sh   Check every sensor on the remote.
  ./scripts/start.sh              Start the bridge and the app.
EOF

[ "$PROBLEMS" -eq 0 ]
