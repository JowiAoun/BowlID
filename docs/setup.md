# Setup

Everything needed to run Bowlometrics on your own machine. The README covers what it is. This covers getting it running.

## Requirements

- [Node.js](https://nodejs.org/) 20 or newer: runs the dev server, the build, the tests and the remote bridge.

The Wii remote is optional. Without it, the app runs with a mouse or a touch screen and labels those swings as simulated. For the remote you also need:

- Ubuntu 24.04 with Bluetooth.
- A Nintendo Wii remote. A MotionPlus is used when attached.
- A USB sensor bar, for aiming by pointing. Without it, the D-pad aims.

## Installation

1. Clone the repository.

   ```bash
   git clone https://github.com/thomasnol/proof-of-human.git
   cd proof-of-human
   ```

2. Install the dependencies.

   ```bash
   npm install
   ```

3. Copy the environment file. Every value in it is optional.

   ```bash
   cp .env.example .env
   ```

   | Variable | What it is | Where to get it |
   |---|---|---|
   | `VITE_AMPLITUDE_API_KEY` | Sends the scores to Amplitude. Empty means analytics is off. | Your Amplitude project's settings |
   | `BOWLBANK_BRIDGE_PORT` | Port of the local Wii remote bridge. Default 8765. | Pick any free port |
   | `BOWLBANK_ACCEL_ZERO`, `BOWLBANK_ACCEL_COUNTS_PER_G` | Calibration for your remote. | Run `node bridge/calibrate.mjs` |

## Setup

With a mouse or a touch screen, there is nothing more to set up.

With the Wii remote, on the Ubuntu laptop:

1. Run `./scripts/setup-ubuntu.sh`. It checks Node.js, Bluetooth, the driver and your permissions, and asks before any `sudo`.
2. Run `./scripts/pair-wiimote.sh` and press the red SYNC button under the remote's battery cover.
3. Run `./scripts/check-controller.sh`. Press buttons, wave the remote and point it at the sensor bar while it runs.

## Usage

With a mouse or a touch screen:

1. Run `npm run dev`
2. Open http://localhost:5173/

With the Wii remote:

1. Run `./scripts/start.sh`
2. Open http://localhost:5173/?mode=wii

Then type a username, press "Create this account" and bowl three times. To come back, type the username, press "Log in with your swing" and bowl once.

| | Aim | Bowl | Menus |
|---|---|---|---|
| Wii remote | Point at the screen, or D-pad | Hold B, swing back, swing forward, let go of B. A remote tilted to one side at the release sends the ball that way, and a wrist twist makes it curve. | A is "Log in" on the front page and the main button after that. 2 is "Create". HOME cancels. `-` mutes. `1` recentres the aim. |
| Mouse or touch | Move over the lane | Press, pull back, flick forward, let go | Click |
| Keyboard | Left and right arrows | Hold Space, let go when the power bar is high | Esc cancels |

- The username is typed on the laptop's keyboard.
- Wear the wrist strap.
- Pointer accounts and Wii accounts are kept apart and never compared.
- The keyboard can bowl but records no swing, so it cannot create an account or log in.
- Accounts live in that browser's storage. Enroll on the laptop and in the browser you will demo with.
- The earlier bank version is still at http://localhost:5173/bank.html

## Test

1. Run `npm test`. It runs 53 tests. The matcher tests use swings made by a formula.
2. Run `npm run evaluate -- --synthetic` to check the measuring tool on made-up swings.

To measure the matcher on real people:

1. Each person opens http://localhost:5173/?mode=wii&who=theirname
2. Click "Practice lane" and bowl at least 8 times.
3. Click "Export recorded swings" on the front page and move the file into `recordings/`.
4. Run `npm run evaluate`

It enrolls each person on their first three throws and tests the rest. It reports how often a person opens their own account, how often a stranger gets in, and how often the answer is "bowl again", with sample counts. Tune `MATCH_CONFIG` in `web/src/motion/matcher.js` from there.

## Deploy

1. Run `npx wrangler login` once.
2. Run `npm run deploy`

This builds the site and publishes `dist/` to Cloudflare Pages as the `bowlometrics` project, at https://bowlometrics.pages.dev. The public site works with a pointer. The remote only works on the laptop that runs the bridge.

## Troubleshooting

| Problem | Fix |
|---|---|
| The pairing script finds nothing | Press SYNC again right after starting it. Check the batteries. |
| The remote's lights keep flashing | Leave the bridge running. It connects known remotes and repairs the kernel driver by itself, every few seconds. If the lights still flash after 20 seconds, run `./scripts/fix-driver.sh`. |
| The page says the bridge is not running | Run `./scripts/start.sh`, or `npm run bridge` alone. |
| The remote turned off | Press any button on it. The app carries on by itself. |
| No sound | Click anywhere on the page first, then check the headphone button in the bowling window. |

More on the remote, calibration and the bridge's messages: [`hardware.md`](hardware.md).
