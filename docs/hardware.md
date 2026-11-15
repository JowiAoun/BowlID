# Wii remote hardware

How the real Wii remote reaches the browser on the Ubuntu demo laptop, and what to do when it does not.

```
Wii remote → Bluetooth → hid-wiimote kernel driver → /dev/input/event* → bridge → ws://127.0.0.1:8765 → browser
```

The bridge is a small Node program in `bridge/`. It reads the kernel's input devices directly, so there is nothing to compile. It only listens on `127.0.0.1`.

## Setup

1. Run `./scripts/setup-ubuntu.sh`. It checks Node.js, BlueZ, the `hid-wiimote` driver and your `input` group, then installs the JavaScript dependencies. It asks before every `sudo` command.
2. Run `./scripts/pair-wiimote.sh`.
3. Press the red SYNC button under the battery cover of the remote. The four lights blink.
4. Wait for `Wii remote ... is connected.`

Holding 1 and 2 together also connects the remote, but only until it turns off. After SYNC pairing, pressing any button reconnects it.

## Check the remote

Run `./scripts/check-controller.sh`. Press buttons, move the remote and point it at the sensor bar while it runs. It reads each sensor for 6 seconds.

```
[ OK ] Buttons: verified working (3 presses: A, B, 1)
[WARN] Infrared: camera detected and readable, but it saw no infrared light
```

- **Detected** means the kernel made the device.
- **Verified working** means real data arrived during the check, with the sample count.

Every line that is not OK comes with a fix. The exit code is 0 when the remote can be used to bowl.

## When the kernel driver cannot start

The remote can connect over Bluetooth and still give no input. The kernel log (`journalctl -k | grep -i wiimote`) then says:

```
wiimote 0005:057E:0306.00D4: Can't alloc device
wiimote 0005:057E:0306.00D4: probe with driver wiimote failed with error -12
```

The driver needs one free 1 MB block of kernel memory for each remote. A laptop that has been on for days, with a lot in swap, has its free memory in small pieces.

Run `./scripts/fix-driver.sh`. It needs no sudo and no button press. It does two things, up to 3 times:

1. Runs `scripts/compact-memory.py`, which makes the kernel move memory together into large free blocks.
2. Starts the remote's HID link again over D-Bus, so the driver gets another go.

`./scripts/pair-wiimote.sh` runs it by itself when the remote connects without input devices. The check and the bridge both name this problem when they see it.

If it still fails, close heavy apps, run `echo 1 | sudo tee /proc/sys/vm/compact_memory`, then run the script again. A reboot before the demo avoids the whole problem.

## Start

Run `./scripts/start.sh`, then open http://localhost:5173/?mode=wii. Ctrl+C stops the bridge and the app.

- `./scripts/start.sh --demo` starts the app without the bridge. This is what runs on a Mac.
- `npm run bridge` starts the bridge alone. It prints one line each time the remote's state changes.

## Replay a recorded swing

Run `node bridge/replay.mjs swing.json`. It plays the file to the browser over the same WebSocket, in real time, when the page connects. Stop the live bridge first, since both use port 8765.

- `--loop` plays the files again and again while a page is connected.
- `--gap 3000` sets the pause before each swing, in ms.

The status sent to the browser says `"source":"replay"`, so a replay is never shown as live play.

## What the bridge sends

JSON text messages, one per WebSocket frame.

| Message | Content |
|---|---|
| `status` | `source` (`wii` or `replay`), `connected`, `device`, `sensors` (`buttons`, `accel`, `gyro`, `ir`) and a `message` for the player. Sent on connect and on every change. |
| `samples` | `s`: rows of `[t, ax, ay, az, gx, gy, gz]`, sent about every 20 ms. |
| `button` | `t`, `name` (`A`, `B`, `1`, `2`, `PLUS`, `MINUS`, `HOME`, `UP`, `DOWN`, `LEFT`, `RIGHT`) and `down`. |
| `ir` | `t` and `pts`: the visible points as `[x, y]` from 0 to 1, at most 50 times a second. Empty when the camera sees no light. |

- `t` is in ms on one clock that never goes back.
- `ax, ay, az` are in g. The driver reports raw counts and the bridge divides by 104. A remote lying still reads about 1 g in total.
- `gx, gy, gz` are in deg/s: pitch, roll and yaw. All three are `null` without a MotionPlus.
- The kernel only reports values that change. When the remote is still, the bridge sends its last real reading again so the stream keeps its rhythm.

A recorded swing file looks like this:

```json
{"version":1,"label":"...","source":"wii","participant":"...","samples":[[t,ax,ay,az,gx,gy,gz]],"releaseT":1234}
```

## Common fixes

| Problem | Fix |
|---|---|
| The pairing script finds nothing | Press SYNC again right after starting it. The remote is only visible for about 20 seconds. Check the batteries. |
| Connected over Bluetooth, but the check says the kernel driver could not start | Run `./scripts/fix-driver.sh`. See the section below. |
| Paired, but no remote in the check | Run `bluetoothctl remove <MAC>`, then pair again with SYNC. |
| `permission denied` on `/dev/input/event*` | Run `sudo usermod -aG input $USER`, then log out and back in. |
| The `hid-wiimote` driver is missing | Run `sudo apt install linux-modules-extra-$(uname -r)`. |
| MotionPlus not detected | Push it fully into the remote and wait 5 seconds. The app works without it. |
| Infrared sees no light | Plug in the sensor bar and stand 1 to 3 metres away. Sunlight and candles confuse the camera. Aiming falls back to the D-pad. |
| The size of the resting acceleration is far from 1.00 g | Set `BOWLBANK_ACCEL_COUNTS_PER_G` to the value the check suggests. |
| `Port 8765 is in use` | Another bridge or replay is running. Stop it, or set `BOWLBANK_BRIDGE_PORT`. |
| The remote turned off mid-demo | Press any button. The bridge finds it again within a second and the app carries on. |
