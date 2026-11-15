# Proof of Human

> AI can click the traffic lights now, but it can't bowl. To prove you're human, you need a body.

A CAPTCHA where you must bowl a strike (with a Wii Remote) to log in, while a paranoid AI reads your motion data and heckles your form out loud. Too good? Robot. Too bad? Also robot. The only way through is to be convincingly mediocre.

All of this guards a "Vote for our project" button.

Built at Stupid Ideas Ottawa (Nov 15, 2026) by [@thomasnol](https://github.com/thomasnol), [@isharghura](https://github.com/isharghura), [@AshwinSri23](https://github.com/AshwinSri23), [@JowiAoun](https://github.com/JowiAoun). Build plan: [PLAN.md](PLAN.md).

## Run it (laptop)

Needs Node 20+.

```bash
npm install
cp .env.example .env      # put ANTHROPIC_API_KEY in here (optional: without it, canned lines are used)
npm start                 # http://localhost:5173
```

Open `http://localhost:5173` in Chrome. Pick an input on the start screen, then **Begin verification** (this click also unlocks the mic and text-to-speech).

URL options: `?input=wiimote|webcam|mouse`, `?pi=192.168.1.50:8765`, `?full` (adds the wave stage, too long for the 60s demo), `?debug` (live sensor readout), `?flipx` / `?flipy` (if the Wii cursor moves backwards).

### Presenter hotkeys

| Key | Does |
|-----|------|
| `→` | skip the current wait (stage hangs? press this) |
| `R` | back to the start screen |
| `M` | mute / unmute the voice |
| `1` / `2` / `3` | switch input: Wii Remote / webcam / mouse |
| `D` | toggle debug readout |
| `Space` | acts as the A button |

## Wii Remote (Raspberry Pi)

```bash
cd pi
pip3 install -r requirements.txt
bluetoothctl              # scan on, press the red SYNC button (or 1+2), pair <MAC>, connect <MAC>, trust <MAC>
python3 wiimote.py --list # should show "Nintendo Wii Remote Accelerometer"
python3 wiimote.py        # hold the remote still for ~1 s while it calibrates
```

Then open the page with `?input=wiimote&pi=<pi-ip>:8765` (or press `1`). The laptop and Pi must be on the same network.

No hardware? `python3 wiimote.py --fake` streams synthetic data (tilt drift, a swing every 6 s) so you can test the page.

**Not yet tested on real hardware:** the device names, the axis mapping, and the button names come from the Linux `hid-wiimote` driver and haven't been checked against our Pi. If `--list` shows different names, change `ACCEL_NAME` / `BUTTONS_NAME` in `pi/wiimote.py`. Unknown buttons are printed when pressed so they can be mapped.

The sensor bar isn't needed: we only use the accelerometer.

## How it works

- **Inputs** (`web/input.js`): every source (Wii Remote over WebSocket, webcam motion via frame differencing, mouse) emits the same sample: `{tiltX, tiltY, mag, a, b}`. Tilt drives the shaky cursor; `mag` (acceleration in g, 1 = resting) drives swings and stillness. The mic level is tracked separately.
- **Features** (`web/features.js`): each challenge records a window of samples and extracts `peakForce`, `duration`, `hesitation`, `tremor`, `reversals`, `micPeak`.
- **Rigged arc** (`web/app.js`): pass/fail per stage is scripted. The bowl always leaves one pin standing.
- **Verdicts** (`server/server.mjs`): `POST /verdict` sends the stage, the scripted verdict and the features to Claude (`claude-haiku-5-5` by default, 2.5 s timeout), which writes one sentence roasting the numbers. If Claude is slow, missing or the wifi dies, it falls back to `web/canned.json` with the real numbers filled in. The browser falls back to canned lines too if the server is unreachable.
- **Voice** (`web/voice.js`): browser `speechSynthesis` reads every verdict aloud.
