# BowlBank build brief

A bank where your password is how you bowl. This is the full brief for the build, made for the Stupid Ideas Hackathon (Ottawa F26).

## The idea

A customer opens a fake bank account by playing a bowling game with a Nintendo Wii remote. We record their bowling motion and build a motion signature. When they want to access their account later, they have to bowl again. The bank compares their new swing against their enrolled motion signature.

Someone could bowl a strike and be denied access to someone else's account. The actual account owner could bowl a gutter ball and get in.

The point is to replace perfectly good modern banking authentication with the most inconvenient and ridiculous alternative we can think of.

This is a simulated bank. No real money, banking credentials or financial services are involved.

- **Working name**: BowlBank
- **Possible tagline**: "Your money. Your swing."

## Deadlines

| What | When |
|---|---|
| Hacking stops | 5:00 p.m. EST, November 15, 2026 |
| Devpost deadline | 6:15 p.m. EST, November 15, 2026 |
| Stage presentation | 60 seconds |

These are two different deadlines. Web demos may get extra stage time, but do not count on it.

Build a complete working vertical slice early. Improve it with whatever time is left.

## Essential requirements

1. Use a real Wii remote for the main physical experience.
2. Build a bowling game.
3. Create fake bank accounts using bowling motions and authenticate based on bowling form.
4. Use our sensor bar where feasible.
5. Make the project lightweight and accessible, ideally from a deployed website.
6. Deliver something polished, funny and memorable.

Everything else in this brief can be challenged and replaced.

## What the organizers want

- Something stupid.
- One idea executed extremely well, without feature bloat.
- A project that looks thoughtfully designed and does not look AI-generated.
- Something interesting and entertaining.

General Stupidest is the main target.

We can pick one special track on top of the general prizes. The recommended track is **Stupidest Metric**, sponsored by Amplitude. Evaluate it yourself. You may recommend another track if you have a strong reason, but do not water the project down to chase several categories.

## Hardware & repository

- **Demo laptop**: Ubuntu Linux, targeting Ubuntu 24.04.
- **Development**: may happen on a Mac before the project moves to Ubuntu.
- **Controller**: Nintendo Wii remote with a MotionPlus attachment.
- **Sensor bar**: USB-powered.
- **Pairing**: the Wii remote has not been paired with the Ubuntu laptop yet.
- **Repository**: https://github.com/thomasnol/proof-of-human (public)

Inspect the repository before making changes. Reuse useful existing work. You are free to restructure or replace code that does not fit.

Do not destroy unrelated work, overwrite teammates' changes or force-push.

The goal is that I clone or pull the finished project onto the Ubuntu laptop, run a simple setup command, connect the hardware and test it.

## How to work

You are my senior software engineer, game designer, creative director and hackathon teammate. Design, implement, test, polish and prepare the whole project for deployment on your own. I want a finished working project. A proposal, a roadmap or a pile of code snippets does not count.

### Creative freedom

An earlier technical brief had ideas about Three.js, dynamic time warping, Wii remote accelerometers, micro-kinematics, motion-based identification and sponsor integrations. All of that is brainstorming. None of it is required.

You have full creative freedom over:

- Technology stack and architecture.
- Visual design and branding.
- Bowling game mechanics and presentation.
- Motion capture and authentication algorithms.
- Account enrollment and verification flow.
- Analytics and stupid metrics.
- Deployment provider.
- Demo presentation and comedic writing.

You can change the name, branding, mechanics, design and implementation if you have a better idea. Research existing tools, libraries, hardware integrations, signal processing methods, games and deployment approaches. If you find something better than what I proposed, use it.

### Do not wait for me

This is a one-shot autonomous build. Do not stop to ask me to pair the Wii remote, provide API keys, create accounts, configure deployment or make routine decisions. I do the physical hardware setup and the credentials after you finish.

When something needs physical hardware or an external account:

1. Implement the integration using the best available documentation.
2. Create a realistic mock or simulated input adapter for development.
3. Test the rest of the system end to end using that adapter.
4. Add automated diagnostics for the real hardware.
5. Give me exact instructions to configure and test the real integration afterward.

Then carry on with everything else. The goal is to leave as little coding as possible for after I get my hands on the project.

### Honesty rules

- Do not claim that physical hardware, live deployment or external services are verified if you could not reach them.
- Synthetic motion data and test fixtures are fine during development. Label them clearly.
- The real product must use real sensor data when hardware mode is active.
- Never silently swap in simulated input in live Wii mode.
- Do not invent library APIs. Check the actual documentation and interfaces.
- Do not invent accuracy results. Do not present uncalibrated similarity scores as probabilities of identity.
- Do not rig authentication results to force the punchline.
- Do not invent teammate details or publish under our accounts without authorization.

## Product experience

Make this feel like a real bank that sincerely believes bowling is the future of financial security. A generic bowling game with a login form next to it is not enough.

### Example flow

1. **Welcome**: a polished, suspiciously professional bank website. The user sees that passwords have been replaced with bowling-based authentication.
2. **Open an account**: the customer enters a fake name and enrolls by bowling a small number of times. The bank analyzes the motion and creates a profile. The customer receives a ridiculous fake balance, such as $69,420.
3. **Authentication**: the customer logs out and chooses their account. To log back in, they bowl again. The system analyzes the motion and shows an actual similarity score. A matching swing gets them to their fake money. A swing that does not match gets denied or asked to try again.
4. **The punchline**: another person tries to access the account. The bowling result and the authentication result are independent. A strike can still mean access denied. A gutter ball can still mean access granted.

Make that contrast the central comedic moment. You can redesign the whole flow if you find something stronger.

### Comedic copy

Suggestions only. Write better material if you can.

- "Your backswing does not match our records."
- "Suspicious wrist activity detected."
- "Strike detected. Identity not detected."
- "Please bowl again to verify that you are you."
- "Your bowling privileges have been temporarily suspended."
- "Your funds are safe. Your form is questionable."

### Visual identity

Create a coherent visual identity. I like the contrast between a sophisticated financial institution and nostalgic Wii-style bowling. Choose whatever direction best supports the joke.

Avoid generic gradients, meaningless dashboards, too many cards, unnecessary settings and anything that looks AI-generated.

## Bowling game

Build a fun but lightweight bowling experience. The game exists to make bowling authentication fun.

It should include:

- A recognizable bowling lane.
- A ball and ten pins.
- Aiming.
- Motion-controlled throwing.
- Satisfying pin collisions and feedback.
- Clear pin count or bowling results.
- Fast transitions between throws.

It does not need full commercial bowling rules, multiplayer, ten-frame scoring or a progression system.

### Technology & performance

Three.js and Rapier were suggested. They are optional. Choose the simplest technology that gives an attractive, satisfying experience on a weak laptop. A lightweight 3D scene, a pseudo-3D game and a polished 2D presentation are all acceptable.

Performance matters a lot. We do not know what laptop the judge has. Assume integrated graphics, limited RAM and an ordinary modern browser.

- Avoid enormous assets, expensive shaders, large ML runtimes and heavy physics simulation.
- Provide adaptive quality or a lightweight rendering fallback if it helps.

## Wii remote integration

Implement a complete real hardware input path targeting Ubuntu.

### Approaches to investigate

- Linux's `hid-wiimote` driver.
- BlueZ.
- XWiimote or `libxwiimote`.
- Linux evdev input devices.
- Other maintained libraries, if they are more reliable.

### What to capture

- Three-axis accelerometer data.
- Wii remote button presses and releases.
- MotionPlus gyroscope data when supported.
- Infrared camera points for sensor bar aiming.
- Monotonic sample timestamps.

### Tolerance

- Handle different Wii remote models, device paths, sampling rates and permissions.
- The base accelerometer path must work without the MotionPlus attachment.
- If a controller disconnects, the application explains what happened and allows reconnection.

### Hardware bridge

If direct browser integration is impractical, implement a lightweight native input bridge on Ubuntu that talks to the browser.

Suggested architecture:

```
Wii Remote → Linux Bluetooth / HID → Local Input Bridge → Browser Bowling Game → Motion Authentication
```

You may choose a different architecture.

- The bridge should be small, reliable, easy to start and able to show its connection status.
- Use one common normalized input interface. The game must switch between actual Wii data, test fixtures and simulated input without rewriting the game or the matcher.

### Sensor bar

The sensor bar should be used for pointing and aiming before a throw.

A sensor bar only emits infrared light. The Wii remote's camera detects that light. The bar does not track the player's arm or body.

- Support a simple calibration process and smooth aiming.
- Infrared tracking will likely drop when the remote moves behind the player during a swing. This is expected and must not interrupt swing recording.
- Provide D-pad aiming as a fallback when infrared data is unavailable.

### Bowling interaction

A possible control scheme:

1. Point the Wii remote at the lane to aim.
2. Hold B to start a swing.
3. Perform a backswing and forward swing.
4. Release B to release the ball.
5. Keep recording briefly to capture the follow-through.

Improve this if you find something more intuitive or reliable.

Show a visible safety reminder to wear the Wii remote wrist strap.

## Motion authentication

The core technical goal is to authenticate the customer's bowling style. This is a joke authentication prototype. It is not a secure biometric or financial authentication product.

Do not simply compare bowling score, ball speed or maximum acceleration. We want to capture the backswing and overall form of the player, as shown by the available sensor signals.

Do not claim to reconstruct a person's whole body or exact arm trajectory from an accelerometer.

### Candidate features

Treat these as candidates. None of them is a proven biometric identifier.

- Backswing timing.
- Backswing-to-forward-swing transition.
- The full acceleration waveform.
- Relative movement across axes.
- Swing duration and tempo.
- MotionPlus angular velocity.
- Wrist rotation proxies.
- Button-release timing.
- Follow-through.
- Post-release braking motion.

Preserve timestamps. Capture a suitable recording window, including pre-swing and post-release motion when useful.

### Matcher

Start with a lightweight, understandable matcher. Options include dynamic time warping, engineered feature distances, nearest-neighbour matching or a combination.

Use a more sophisticated method only if it gives a meaningful improvement and fits the deadline. Do not require a GPU or an external inference API.

### Enrollment

- Users create a motion profile from a small number of bowling throws.
- Start with a configurable default of about three enrollment throws.
- Allow extra throws when the recorded motions are poor or inconsistent.
- Save only the data the prototype needs, using local or ephemeral storage where possible.

### Verification

Users select the account they want to access and bowl again. The system compares the captured motion against the enrolled profile.

Support three outcomes:

- Match.
- Mismatch.
- Ambiguous or low-quality motion that needs a retry.

Start with one verification throw for demo speed, with extra throws when needed.

- Handle normal variation in how the same person bowls. Swings from one person will never be identical.
- Handle similar swings between different people. If two motions cannot be told apart, say so. Do not force a confident result.
- A personal signature wind-up or intentional flourish is an optional idea to explore if natural bowling styles are not distinctive enough.

### Evaluation

Implement a simple evaluation tool that can:

- Load recorded swings from multiple participants.
- Separate enrollment data from held-out verification data.
- Compare genuine attempts against other people's attempts.
- Report genuine acceptance, false rejection, false acceptance and ambiguity.
- Show sample counts and useful diagnostics.

During development, test with synthetic fixtures. Keep those tests clearly apart from accuracy measurements on real people.

I will collect real swings after connecting the hardware. Make the collection and evaluation workflow extremely easy.

## Stupidest Metric & Amplitude

Make the stupid metric central to the experience.

Possible metric: **Bowlometric Identity Score**, how closely your bowling swing matches your enrolled financial identity. Invent a better metric or name if you can.

Other possible measurements:

- Bowls required to access your money.
- How many times someone fails to authenticate as themselves.
- Bowling identity crises, when two people have similar motion signatures.
- Strikes that fail authentication.
- Gutter balls that open bank accounts.

Choose one or two especially funny measurements. Do not build a generic analytics dashboard.

### Amplitude integration

- Implement optional Amplitude integration using its supported browser SDK or another suitable approach.
- There is no Amplitude API key yet. Use an environment variable for the project API key and provide an example environment file.
- The whole application must keep working when analytics is disabled or the key is missing.
- Analytics must be anonymous. No personal names, banking information or raw biometric recordings.
- Do not require any other AI or sponsor API without a compelling reason. Any optional service needs a graceful no-key fallback.

## Deployment & the judge's laptop

The main application must be ready for public web deployment. Choose the provider that is easiest and most reliable for your architecture: Cloudflare Pages, Vercel, Netlify or another suitable service. I already have a Cloudflare account, but you do not have to use it. No custom domain is required.

### The ideal experience

The judge opens a website on their laptop, we hand them a Wii remote, and they can play right away.

Investigate whether that is possible without installing anything on the judge's laptop. Do not assume browsers can read all Wii remote HID and sensor data. Check the actual compatibility limits.

### Cross-device relay

If needed, implement a temporary session-based network relay. Our Ubuntu laptop hosts the physical Wii remote connection and publishes live motion data to a temporary room. The judge's browser joins that room with a short code, then displays and plays the game.

- Keep it secure enough for a public demo.
- Use short-lived sessions.
- Do not expose unauthenticated controller endpoints.
- Do not expose private motion recordings publicly.
- Prefer the simplest reliable solution. Do not spend the whole hackathon on networking.

If cross-device live play is too fragile, prioritize a working live demo on our Ubuntu laptop and a fully interactive public browser demo.

### Required modes

| Mode | What it does |
|---|---|
| Live Wii mode | Uses actual physical controller data and real motion matching. |
| Browser demo mode | Works right away from the public website with no hardware or installation. Uses keyboard and mouse controls and clearly labeled synthetic or recorded sample profiles to show the full experience. |
| Replay & diagnostics mode | Feeds recorded or synthetic sensor samples through the same pipeline used by real hardware. Supports automated tests, hardware troubleshooting and debugging. |

### Deployment without credentials

Prepare the production build and deployment configuration. If deployment needs my authentication, finish everything else and give me the exact commands or authorization steps. Provide an example deployment environment file if needed.

## Setup

This is a major requirement. I do not want to work out which Bluetooth libraries to install, how to start five services, which ports to configure or how to build everything.

Ideally, after cloning the repository, I only run:

```
./scripts/setup-ubuntu.sh
./scripts/start.sh
```

These filenames are suggestions.

### Setup script

It should be safe, understandable and repeatable. It should:

- Check the operating system and prerequisites.
- Install the supported dependencies it needs, asking for permission where needed.
- Set up the frontend and the backend or hardware bridge.
- Detect missing Linux hardware drivers or permissions.
- Prepare local configuration without requiring optional API keys.
- Explain how to pair the Wii remote.

### Hardware diagnostic

Provide a dedicated command, such as `./scripts/check-controller.sh`. It should report:

- Bluetooth availability.
- Whether a Wii remote is connected.
- Whether buttons are readable.
- Whether accelerometer data is readable.
- Whether MotionPlus data is readable.
- Whether infrared input is readable.
- Helpful fixes for common failures.

It must tell detected devices apart from verified working sensor streams.

### Other setup needs

- A clear way to run development mode on Mac without the hardware. Ubuntu stays the primary live hardware target.
- Dependency lockfiles, pinned compatible versions where it makes sense, and documented setup instructions.
- I should not need to understand the internals of the project to run it.

## Build order & testing

Implement the project directly in the repository. Start with a brief architecture decision and the main risks. Then execute. Do not finish after presenting a plan.

### Suggested order

1. Inspect the repository and select the architecture.
2. Create the shared motion input interface and synthetic test fixtures.
3. Build the bank and the complete bowling enrollment and authentication flow.
4. Implement and test the motion matcher.
5. Implement the real Ubuntu Wii remote bridge and diagnostics.
6. Implement the sensor bar and MotionPlus integration with graceful fallback.
7. Polish the game, banking UI, animations and comedic feedback.
8. Add optional Amplitude integration.
9. Prepare the public deployment and the cross-device live session if feasible.
10. Write the setup scripts, tests, documentation and submission materials.

Adapt this order if you find a better approach.

### What to test

Test everything that can be tested locally:

- Production build.
- Browser gameplay.
- Enrollment and account creation.
- Authentication success, rejection and ambiguity.
- Independence of bowling score and identity matching.
- Simulated controller data.
- Hardware bridge message parsing.
- Controller disconnect and reconnect behaviour where testable.
- Missing API keys.
- Multiple browser sizes.
- Performance on modest hardware or throttled browser settings.
- Setup script syntax and repeatability where the environment permits.

A successful compilation is not enough. Run the application and interact with it. Use browser automation or screenshots to inspect the actual rendered product where available.

Fix the problems you find. Reporting them is not enough.

If you cannot run Ubuntu hardware tests from your development environment, say so plainly and leave the exact hardware testing steps for me.

Make meaningful commits as you work.

## Presentation & submission

Prepare a short, entertaining 60-second demo. One possible version:

1. "We made a bank that doesn't believe in passwords."
2. Show the fake account balance.
3. The account owner bowls and gains access.
4. Another person bowls and is rejected.
5. "He got a strike. I got my money."
6. End with the funniest bank message.

Improve the presentation to fit the finished product.

Have a backup demo mode that is ready right away if the hardware or the event Wi-Fi fails. If needed, prepare an honest recorded example or a clearly labeled replay.

### Submission materials

- A polished README with setup and demo instructions.
- A short Devpost description.
- A Discord submission description of no more than five sentences.
- Suggested screenshots, or actual screenshots when available.
- A 60-second presentation script.
- A backup screen recording plan.
- The recommended single special track.
- A contributor section with placeholders for real teammate names and contributions.

The project must be posted in `#share-your-work` to be judged. The post needs the teammates' names and handles, the project description, the GitHub link, a demo link or video, and the chosen track.

## Final handoff

At the end of the implementation, give me a concise handoff with these parts:

| Part | What it covers |
|---|---|
| What is complete | What you implemented, where it lives and what actually works. |
| What you tested | Which tests passed, what was simulated, and what was verified with actual hardware or external services. |
| How to run it | Exact copy-paste commands to clone the repository onto Ubuntu, install dependencies, connect the Wii remote, start the application and open the browser. |
| How to enable integrations | Where to put the Amplitude project API key and how to authorize the chosen deployment provider. |
| First physical test | A short checklist to verify the remote, buttons, acceleration, MotionPlus, infrared aiming, enrollment and authentication with real people. |
| Remaining limitations | Anything that still needs hardware access, deployment credentials, real participant data or testing on another laptop. |
| Demo instructions | How to present the project onstage and how to switch to the backup if something goes wrong. |

Do not leave me with an implementation roadmap in place of a working project.

The goal is that I take the finished work, do a short setup and hardware testing session, deploy it, and have an unforgettable hackathon submission.
