# Submission

Text and plans for the Stupid Ideas Hackathon (Ottawa F26). Hacking stops at 5:00 p.m. EST on November 15, 2026. The Devpost deadline is 6:15 p.m.

## Track

**Stupidest Metric** (Amplitude), on top of General Stupidest.

The product runs on one metric: the Bowlometric Identity Score, a number that decides whose account you get based on your backswing. The branch ledger adds four more: gutter balls let in, strikes turned away, identity crises, and bowls to recognise yourself. Every log-in bowl sends the score to Amplitude when a key is set.

## Devpost description

**BowlID: your identity is in your swing.**

We got rid of usernames and passwords. Your account is your bowling form.

The website has two buttons and nowhere to type. To create an account, a CAPTCHA-style window opens with a bowling game in it, and you bowl three times with a Wii remote. To log in, you bowl once. The site compares your swing with everyone on file and opens the account it belongs to. Nobody tells it who is bowling.

Hand the same remote to a friend and their swing opens their account. A stranger is turned away. Two people who bowl alike get a bowling identity crisis, and neither is let in.

The pins have nothing to do with it. A gutter ball from the right arm gets in. A strike from a stranger does not.

**How we built it**

- A Wii remote talks to an Ubuntu laptop over Bluetooth. A small Node bridge reads the accelerometer, the MotionPlus, the buttons and the sensor bar camera from the Linux kernel driver and sends them to the browser.
- Each swing becomes a signature: the force waveform on three axes with the release pinned to one point, plus timing features. Those are how long the swing took, how hard it peaked, when the button was released against the peak, how the motion splits across axes, and the follow-through.
- Signatures are compared with dynamic time warping. A log-in swing is checked against every enrolled profile. It has to pass that customer's own threshold and beat everyone else by a margin, or the answer is "unknown" or "identity crisis".
- After each bowl a biometric report shows the measured numbers beside the ones on file.
- The lane is drawn with Three.js. The pin physics is about 200 lines of our own JavaScript. The sounds are synthesised in the browser.

**What we learned**

The laptop's kernel refused to start the Wii remote driver because its memory was too fragmented. We now ship a script that tidies kernel memory before a bowling ball can be thrown. This is the most serious engineering in the project.

**Honest notes**

The score is a similarity measure. It is not a probability and it is not security. A Wii remote measures the force and turning of one hand, not a body. No real money, bank or biometric product is involved. Pointer swings on the public site are a simulation and the page says so.

## Discord post for `#share-your-work`

Fill in the names and handles before posting.

> **BowlID: your identity is in your swing** 🎳
> We got rid of usernames and passwords: your account is your bowling form. You create an account by bowling three times with a Wii remote, and you log in by bowling once while the site works out who you are from the swing alone. Two people can share one remote and land in two different accounts. The pins do not matter: a gutter ball from the right arm gets in, and a strike from a stranger is turned away. Every bowl gets a Bowlometric Identity Score out of 100.
>
> Team: NAME (`@handle`), NAME (`@handle`), NAME (`@handle`)
> GitHub: https://github.com/thomasnol/proof-of-human
> Demo: https://bowlometrics.pages.dev
> Track: Stupidest Metric

## Before going on stage

Do this on the Ubuntu laptop, in the browser that will be on screen. Accounts are kept in that browser.

1. Run `./scripts/start.sh` and open http://localhost:5173/?mode=wii
2. Person A presses 2 on the remote (or clicks "Create your bowling identity") and bowls three times.
3. Sign out. Person B does the same.
4. Each person logs in twice. If either one is refused or opens the other's account, read "If it does not work" below.
5. Leave the page on the front page, signed out.

## 60 second script

Two people on stage and one remote.

| Time | Who | What |
|---|---|---|
| 0:00 | A | "We got rid of usernames and passwords." Point at the page. "There is nowhere to type. Your account is your bowling form." |
| 0:08 | A | Press A on the remote. The bowling window opens. "It looks like a CAPTCHA. It is checking that I am me." |
| 0:13 | A | Bowl, badly if you can. Read the screen: "Gutter ball. Identity verified." Press A. The account opens with A's name and balance. |
| 0:25 | A | "It knew that from my swing." Press A to sign out. Hand the remote to B. "Same remote." |
| 0:30 | B | Press A, bowl. The report says who B is. Press A. A different account opens. |
| 0:42 | B | "Different arm, different account. Nobody typed anything." Sign out. |
| 0:46 | A | Hand the remote to someone who never enrolled, or bowl with the other hand. "Identity unknown. Who are you?" |
| 0:55 | A | "BowlID. Forget your password. Remember your backswing." |

Nothing here is rigged. The account that opens is whatever the matcher picks from the swing. If the third bowl gets an identity crisis and not "unknown", read that out. It is just as good.

## If it does not work

In rehearsal, from most likely to least:

1. **A is refused as themselves.** Their three enrollment throws were tidier than their normal swing. Close the account and enroll again, bowling the way they will on stage: standing, same hand, same pace.
2. **A and B open each other's accounts, or get identity crises.** Their swings are too alike for the sensors. One of them enrolls again with a signature flourish that still feels like bowling: a long slow backswing, a pause at the top, or a wrist flick at the release.
3. **It is still unreliable.** Record throws with `?who=name`, run `npm run evaluate`, and read the rates. Then adjust `acceptFactor` and `rivalMargin` in `web/src/motion/matcher.js` and enroll again. Do not go on stage with rates you have not seen.

## Backup plan

On stage, from smallest problem to largest:

1. **The remote drops**: press any button on it. The lane says the remote is asleep and carries on when it is back.
2. **The remote will not come back**: click the pill at the bottom right to switch to the pointer. Create two accounts with the trackpad, one with a slow drag and one with a fast flick, and do the same script. Say that the pointer is standing in for the remote.
3. **No time to enroll**: click "Watch a sample customer log in (simulated)". Gary Gutterman's formula swing lands in the gutter and opens his account. Say that Gary is a sample with a made-up swing.
4. **The laptop or the Wi-Fi fails**: open the public demo link on any laptop or phone. If there is no internet at all, play the screen recording.

## Screen recording

Record this before going on stage, on the demo laptop, with the real remote.

1. Start a screen recorder at 1080p, with the browser in full screen at http://localhost:5173/?mode=wii.
2. Film the bowler with a phone at the same time, if you can, so the swing and the screen can be shown side by side.
3. Record the full 60 second script once without stopping.
4. Keep the file on the laptop and on a phone.

## Screenshots

These are in `docs/screenshots/`. The `bowlid-` ones were taken in a headless browser with formula swings fed through the pointer path, which is why they carry the "simulated" label.

- `bowlid-home.png`: the front page.
- `bowlid-enroll.png`: creating an identity, two throws in.
- `bowlid-gutter-verified.png`: a gutter ball that is recognised.
- `bowlid-unknown.png`: a stranger is turned away.
- `bowlid-crisis.png`: a swing that fits two customers.
- `bowlid-account.png`: the account the swing opened.
- `home.png`, `gutter-approved.png`, `strike-declined.png`, `account.png`: the earlier BowlBank version.

Take one more for Devpost with the real remote in someone's hand in front of the screen.

## Before posting

- [ ] Replace the names and handles in the README team section and in the Discord post.
- [ ] Run `npm run deploy` so the public site has this version, then paste the demo link, https://bowlometrics.pages.dev, into Devpost.
- [ ] Pick the Stupidest Metric track on Devpost.
- [ ] Post in `#share-your-work`. A project that is not posted there is not judged.
