# Proof of Human — build plan

**Wii Are Not a Robot.** A CAPTCHA where you must bowl a strike to log in, and an AI that is paranoid about whether you're human heckles your form out loud.

Event: Stupid Ideas Ottawa, Sun Nov 15, Bayview Yards. **Hacking stops at 5:00 PM. On-stage demo is 60 seconds.**
Track: **Stupidest AI** ($67 + $1,000 credits). Main track is automatic.

---

## 1. What we demo (cut to fit 60 seconds)

The full ladder is ~2 minutes, so the on-stage run is the short cut. Everything else stays in the build for the live/video version.

| # | Stage | Scripted outcome | Example heckle | In 60s demo? |
|---|-------|------------------|----------------|--------------|
| 1 | "I'm not a robot" checkbox, tilt-to-move shaky cursor | pass → "Hmm. We need to be sure." | — | yes (10s) |
| 2 | Bowl a strike | **fail** (9 pins) | "A human would be more upset about that." | yes (15s) |
| 3 | Wave hello, sincerely | fail | "Sincerity: 12%. Warmth of a parking ticket." | no |
| 4 | Hold perfectly still | fail either way | "Too still. Are you a tripod?" / "What are you hiding?" | yes (10s) |
| 5 | Do something only a human would do (flail + yell into the mic) | pass | "Pointless, inefficient, slightly embarrassing. Verified human." | yes (15s) |
| 6 | "Welcome! Your session has expired." | — | — | yes (5s) |

Always on screen: live **Humanity: 43%** meter. The prize behind all of it: a **"Vote for our project"** button.

Rule: **rig the arc, not the jokes.** Pass/fail per stage is scripted. Claude only writes the *reason*, from real features of the volunteer's motion.

---

## 2. Architecture

```
 [Wii Remote] --BT--> [Raspberry Pi: wiimote.py] --WebSocket--> \
                                                                  [Browser page (laptop, projected)]
 [Laptop webcam/mic] ----------------------------------------->  /      |  stage state machine
                                                                        |  canvas bowling + meter
                                                                        |  speechSynthesis (TTS)
                                                                        v
                                                    [verdict server (holds API key)] --> Claude (Haiku-class)
```

**One input interface.** Every input source emits the same stream so the page doesn't care where it came from:
`{ t, ax, ay, az, buttons }` at ~50–100 Hz, plus `{ micLevel }` from the laptop.

### Input sources (try in this order, timebox each)

| Option | How | Timebox | Notes |
|--------|-----|---------|-------|
| **A. Wiimote → Pi** | Pair with `bluetoothctl`; the Linux `hid-wiimote` kernel driver exposes the accelerometer as an evdev device; read with `python-evdev`, push over WebSocket | 45 min | Most likely to work. Unverified on our Pi image — test first thing. |
| **B. Wiimote → laptop directly (WebHID in Chrome)** | Browser talks HID to the remote, no Pi | 30 min, in parallel with A | Fewer moving parts if it works. Unverified; Windows BT pairing of Wiimotes is flaky. |
| **C. Fallback: webcam** | MediaPipe Pose wrist tracking → synthesize the same accel-ish stream | build anyway, ~1 hr | Guarantees a demo if Bluetooth dies on stage. |
| D. Last resort | mouse drag = swing | 10 min | Never demo with this unless everything else is dead. |

Sensor bar: **not needed.** We use accelerometer only (no IR pointing to fail). Bring it as a prop if we want.

### Features we extract per gesture (feed these to Claude)

- `peakForce` (max |a| in g)
- `duration` (ms from motion start to stop)
- `tremor` (std-dev of high-passed accel during a "still" window)
- `hesitation` (ms between prompt and first motion)
- `smoothness` (jerk / number of direction reversals)
- `micPeak` (stage 5 only)

### Verdict server

- Tiny Node (or Python) endpoint `POST /verdict { stage, outcome, features }` → `{ line, humanity }`.
- Keeps the API key server-side (`.env`, never committed).
- Small fast model, max ~40 tokens, 1–2 sentences, system prompt = "paranoid CAPTCHA that suspects everyone is a robot".
- **Hard timeout ~2.5 s → canned line** (5+ per stage in `canned.json`). Venue wifi will betray us.
- Humanity % is computed locally from the script (+ jitter), not by the model.

### Browser page

- Single page, big type, readable from the back of the room.
- State machine: `idle → checkbox → bowl → (wave) → still → human → expired → vote`.
- Bowling: simple 2D canvas lane; ball speed from `peakForce`, curve from tilt; pin result comes from the script, physics just animates toward it.
- TTS: `window.speechSynthesis` speaks every verdict. Pick a deadpan voice; test on the demo laptop's speakers.
- Presenter hotkeys: `→` next stage, `R` reset, `F` force fallback input, `M` mute TTS. Saves the demo if something hangs.

---

## 3. Who does what (4 people)

| Role | Owns |
|------|------|
| **Hardware** | Pi + Wiimote pairing, `pi/wiimote.py`, WebSocket stream; then webcam fallback (C) |
| **Frontend** | page, stage state machine, canvas bowling, Humanity meter, visual polish (judges care how it looks) |
| **AI / voice** | verdict server, prompt, canned lines, TTS voice, feature extraction from the stream |
| **Demo lead** | script the 60s run, slides (≤3), Discord/Devpost post, record the backup video at 4:30, plays "volunteer" in rehearsals |

Agree on the input-stream JSON shape in the first 15 minutes so hardware and frontend never block each other. Frontend develops against a **recorded/fake stream** until hardware is live.

---

## 4. Timeline (today)

| Time | Milestone |
|------|-----------|
| 10:30–11:00 | Repo cloned by everyone, stream format agreed, roles locked |
| 11:45 | **Go/no-go on Wiimote** (A or B streaming accel to a browser console). If no → C becomes primary |
| 1:00 | End-to-end: stage 1 + 2 working with real input and a spoken Claude verdict |
| 3:00 | All demo stages working; canned fallbacks in place |
| 3:30 | **Feature freeze.** Only polish + bug fixes after this |
| 4:00 | Rehearse the 60s run 3× with someone who hasn't seen it |
| 4:30 | Record backup demo video (≤1 min) |
| 5:00 | Stop hacking. Post to **#share-your-work** |

## 5. Submission checklist (from the hacker package)

- [ ] Names + Discord handles of all 4
- [ ] Live site link and/or ≤1 min video and/or ≤3-slide deck
- [ ] What we made, ≤5 sentences
- [ ] GitHub link (this repo, public)
- [ ] Track: **Stupidest AI**
- [ ] Devpost (recommended): stupideas-ottawa-f26.devpost.com

## 6. Stretch goals (only after 3:30 freeze is met… so probably never)

- "Accessibility option" that swaps in an even worse challenge
- Second volunteer "vouches" by shaking hands while both hold the remote

## 7. Repo layout (proposed)

```
pi/          wiimote.py, requirements.txt   (Wiimote → WebSocket bridge)
server/      verdict endpoint, canned.json, .env.example
web/         index.html, app.js, stages/, bowling.js, input/{wiimote,webcam,fake}.js
docs/        demo script, slides
```
