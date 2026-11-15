# Submission

Text and plans for the Stupid Ideas Hackathon (Ottawa F26). Hacking stops at 5:00 p.m. EST on November 15, 2026. The Devpost deadline is 6:15 p.m.

## Track

**Stupidest Metric** (Amplitude), on top of General Stupidest.

The product runs on one metric: the Bowlometric Identity Score, a number that decides whether your backswing is the password for the username you typed. Each account adds two more: attempts on your account, and you-ness over time. The front page ranks customers as most and least themselves, and the branch ledger counts gutter balls let in, strikes turned away, identity crises, and bowls per log-in. Every log-in bowl sends the score to Amplitude when a key is set.

## Devpost description

**BowlID: your password is your swing.**

We got rid of passwords. You type a username, and then you bowl.

The website has a username field and no password field. To create an account, a CAPTCHA-style window opens with a bowling game in it, and you bowl three times with a Wii remote. To log in, you type your username and bowl once. The swing is checked against the swings on file for that username.

Hand the remote to a friend and have them type your username. Their swing is declined. When you next log in, your account lists the attempt, and if your friend has an account of their own, it names them.

The pins have nothing to do with it. A gutter ball from the right arm gets in. A strike from a stranger does not.

**How we built it**

- A Wii remote talks to an Ubuntu laptop over Bluetooth. A small Node bridge reads the accelerometer, the MotionPlus, the buttons and the sensor bar camera from the Linux kernel driver and sends them to the browser.
- Each swing becomes a signature: the force waveform on three axes with the release pinned to one point, plus timing features. Those are how long the swing took, how hard it peaked, when the button was released against the peak, how the motion splits across axes, and the follow-through.
- Signatures are compared with dynamic time warping. A log-in swing is checked against the profile for the typed username and has to pass that customer's own threshold. A declined swing is then compared with everyone else on file, and named if it fits one of them.
- After each bowl a biometric report shows the measured numbers beside the ones on file.
- The lane is drawn with Three.js. The pin physics is about 200 lines of our own JavaScript. The sounds are synthesised in the browser.

**What we learned**

The laptop's kernel refused to start the Wii remote driver because its memory was too fragmented. We now ship a script that tidies kernel memory before a bowling ball can be thrown. This is the most serious engineering in the project.

**Honest notes**

The score is a similarity measure. It is not a probability and it is not security. A Wii remote measures the force and turning of one hand, not a body. No real money, bank or biometric product is involved. Pointer swings on the public site are a simulation and the page says so.

## Discord post for `#share-your-work`

Fill in the names and handles before posting.

> **BowlID: your password is your swing** 🎳
> We got rid of passwords: you type a username and then you bowl. You create an account by bowling three times with a Wii remote, and you log in by bowling once. Type somebody else's username and your swing is declined, and the owner is told who tried. The pins do not matter: a gutter ball from the right arm gets in, and a strike from the wrong arm is turned away. Every bowl gets a Bowlometric Identity Score out of 100.
>
> Team: NAME (`@handle`), NAME (`@handle`), NAME (`@handle`)
> GitHub: https://github.com/thomasnol/proof-of-human
> Demo: https://bowlometrics.pages.dev
> Track: Stupidest Metric

## Before going on stage

Do this on the Ubuntu laptop, in the browser that will be on screen. Accounts are kept in that browser.

1. Run `./scripts/start.sh` and open http://localhost:5173/?mode=wii
2. Person A types a username, presses 2 on the remote (or clicks "Create this account") and bowls three times.
3. Sign out. Person B does the same with their own username.
4. Each person logs in to their own account twice, and tries the other's account once. If either one is refused as themselves or opens the other's account, read "If it does not work" below.
5. Close and re-create both accounts if you want the stage demo to start with no attempts on file.
6. Leave the page on the front page, signed out, with A's username typed in.

## 60 second script

Two people on stage and one remote.

| Time | Who | What |
|---|---|---|
| 0:00 | A | "We got rid of passwords." Point at the page. "There is my username. There is no password field. My password is how I bowl." |
| 0:08 | A | Press A on the remote. The bowling window opens. "It looks like a CAPTCHA. It is asking for my password." |
| 0:13 | A | Bowl, badly if you can. Read the screen: "Gutter ball. Password accepted." Press A. The account opens with A's balance. |
| 0:25 | A | "The pins did not matter. The swing did." Press A to sign out. Hand the remote to B. "Same remote, same username, different arm." |
| 0:30 | B | Press A, bowl. Read the screen: "Wrong password. You are not A. You bowl like B." |
| 0:42 | B | "It knows that is my swing, and it is telling on me." Press HOME to close. Hand the remote back. |
| 0:46 | A | Press A, bowl, open the account. Point at "Attempts on your account": one new attempt, bowled like B. |
| 0:55 | A | "BowlID. Forget your password. Remember your backswing." |

Nothing here is rigged. Whether a swing is accepted is whatever the matcher says. If B's swing is declined without being named, read that out: "nobody else on file bowls like that". The attempt still shows on A's account.

## If it does not work

In rehearsal, from most likely to least:

1. **A is refused as themselves.** Their three enrollment throws were tidier than their normal swing. Close the account and enroll again, bowling the way they will on stage: standing, same hand, same pace.
2. **A and B can open each other's accounts.** Their swings are too alike for the sensors. One of them enrolls again with a signature flourish that still feels like bowling: a long slow backswing, a pause at the top, or a wrist flick at the release.
3. **It is still unreliable.** Record throws with `?who=name`, run `npm run evaluate`, and read the rates. Then adjust `acceptFactor` in `web/src/motion/matcher.js` and enroll again. Do not go on stage with rates you have not seen.

## Backup plan

On stage, from smallest problem to largest:

1. **The remote drops**: press any button on it. The lane says the remote is asleep and carries on when it is back.
2. **The remote will not come back**: click the pill at the bottom right to switch to the pointer. Create two accounts with the trackpad, one with a slow drag and one with a fast flick, and do the same script. Say that the pointer is standing in for the remote.
3. **No time to enroll**: click the three sample links in order. Gary logs in, Gary tries Margaret's account and is declined and named, and Margaret logs in and sees the attempt. Say that Gary and Margaret are samples with made-up swings.
4. **The laptop or the Wi-Fi fails**: open the public demo link on any laptop or phone. If there is no internet at all, play the screen recording.

## Screen recording

Record this before going on stage, on the demo laptop, with the real remote.

1. Start a screen recorder at 1080p, with the browser in full screen at http://localhost:5173/?mode=wii.
2. Film the bowler with a phone at the same time, if you can, so the swing and the screen can be shown side by side.
3. Record the full 60 second script once without stopping.
4. Keep the file on the laptop and on a phone.

## Screenshots

These are in `docs/screenshots/`. The `bowlid-` ones were taken in a headless browser with formula swings fed through the pointer path, which is why they carry the "simulated" label.

- `bowlid-login.png`: the front page, with the username field and the ranking.
- `bowlid-wrong-password.png`: a customer bowling on somebody else's account, declined and named.
- `bowlid-attempts.png`: the owner's account afterwards, with the attempts and the you-ness chart.
- `bowlid-home.png`, `bowlid-enroll.png`, `bowlid-gutter-verified.png`, `bowlid-unknown.png`, `bowlid-crisis.png`, `bowlid-account.png`: the version before usernames, when one bowl was compared with everyone on file.
- `home.png`, `gutter-approved.png`, `strike-declined.png`, `account.png`: the earlier BowlBank version.

Take one more for Devpost with the real remote in someone's hand in front of the screen.

## Before posting

- [ ] Replace the names and handles in the README team section and in the Discord post.
- [ ] Run `npm run deploy` so the public site has this version, then paste the demo link, https://bowlometrics.pages.dev, into Devpost.
- [ ] Pick the Stupidest Metric track on Devpost.
- [ ] Post in `#share-your-work`. A project that is not posted there is not judged.
