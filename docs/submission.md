# Submission

Text and plans for the Stupid Ideas Hackathon (Ottawa F26). Hacking stops at 5:00 p.m. EST on November 15, 2026. The Devpost deadline is 6:15 p.m.

## Track

**Stupidest Metric** (Amplitude), on top of General Stupidest.

The whole product is one metric: the Bowlometric Identity Score, a number that decides if you may see your own money based on your backswing. The branch ledger adds two more: strikes declined and gutter balls approved. Every sign-in sends the score to Amplitude when a key is set.

## Devpost description

**Bowlometrics: your money, your swing.**

Passwords get stolen. Fingerprints get copied. Nobody has ever stolen a backswing.

Bowlometrics is a bank where your password is how you bowl. You open an account by bowling three times with a Wii remote. To sign in, you bowl again. The bank compares the motion of your swing with the swings on file and gives you a Bowlometric Identity Score out of 100. Score 70 or more and you are in.

The pins have nothing to do with it. Bowl a strike with the wrong swing and you are declined. Bowl your usual gutter ball and the bank welcomes you back.

**How we built it**

- A Wii remote talks to an Ubuntu laptop over Bluetooth. A small Node bridge reads the accelerometer, the buttons and the sensor bar camera from the Linux kernel driver and sends them to the browser.
- The swing is turned into a signature and compared with dynamic time warping plus timing features. Those are how long the swing is, when it peaks, how the motion splits across axes, and the follow-through.
- The lane is drawn with Three.js. The pin physics is about 200 lines of our own JavaScript.
- The public site runs with no hardware. Your pointer is the remote, and two sample customers are waiting to be broken into.

**What we learned**

The laptop's kernel refused to start the Wii remote driver because its memory was too fragmented. We now ship a script that tidies kernel memory before a bowling ball can be thrown. This is the most serious engineering in the project.

**Honest notes**

The score is a similarity measure. It is not a probability and it is not security. No real money, bank or biometric product is involved. The sample customers use swings made by a formula, and the app labels them that way.

## Discord post for `#share-your-work`

Fill in the names and handles before posting.

> **Bowlometrics: your money, your swing** 🎳
> Bowlometrics is a bank where your password is how you bowl. You open an account by bowling with a Wii remote, and to sign in you bowl again while the bank checks your swing against the one on file. The pins do not matter: a strike with the wrong swing is declined, and the owner's gutter ball is approved. Every attempt gets a Bowlometric Identity Score out of 100. Try it in your browser with no hardware at the demo link.
>
> Team: NAME (`@handle`), NAME (`@handle`), NAME (`@handle`)
> GitHub: https://github.com/thomasnol/proof-of-human
> Demo: https://bowlometrics.pages.dev
> Track: Stupidest Metric

## 60 second script

Two people on stage. Person A owns the account. Person B is the thief. Open the account for A before going on stage, and stay on the home screen.

| Time | Who | What |
|---|---|---|
| 0:00 | A | "We made a bank that does not believe in passwords." Point at the screen. "To sign in, you bowl." |
| 0:08 | A | Press A on the remote on your own name. "This is my account. It only opens for my swing." |
| 0:15 | A | Bowl badly on purpose, into the gutter if you can. The stamp says APPROVED. "Gutter ball. Still me." Press A to show the balance. "Sixty-nine thousand dollars." |
| 0:28 | A | Sign out. Hand the remote to B. "My friend is a much better bowler than I am." |
| 0:33 | B | Select A's account and bowl a real, careful throw at the pins. |
| 0:42 | both | The stamp says DECLINED. Read the line on screen out loud. |
| 0:48 | A | "He got a strike. I got my money." |
| 0:52 | A | Point at the ledger at the bottom. "We track the only two numbers that matter: strikes declined and gutter balls approved." |
| 0:58 | A | "Bowlometrics. Your money. Your swing." |

Nothing here is rigged. B's result is whatever the matcher says. Rehearse with B a few times first. If B keeps getting approved, have B swing in their own natural way and not copy A, or enrol A again with a more personal wind-up.

## Backup plan

In order, from smallest problem to largest:

1. **The remote drops**: press any button on it. The app says the remote is not connected and carries on by itself when it is back.
2. **The remote will not come back**: click the button at the top right to switch to demo mode. Open a new account with the trackpad and do the same script. A slow drag and a fast flick are different enough to be declined.
3. **No time to enrol**: sign in as Gary Gutterman with a pointer swing and get declined. Then click "Replay Gary's own recorded swing". It lands in the gutter and is approved. Say that Gary is a sample customer with a made-up swing.
4. **The laptop or the Wi-Fi fails**: open the public demo link on any laptop or phone. It needs no install. If there is no internet at all, play the screen recording.

## Screen recording

Record this before going on stage, on the demo laptop, with the real remote.

1. Start a screen recorder at 1080p, with the browser in full screen at http://localhost:5173/?mode=wii.
2. Film the bowler with a phone at the same time, if you can, so the swing and the screen can be shown side by side.
3. Record the full 60 second script once without stopping.
4. Record one extra take of only the strike that is declined.
5. Keep both files on the laptop and on a phone.

## Screenshots

These are in `docs/screenshots/`, taken in demo mode.

- `home.png`: the bank's home page.
- `gutter-approved.png`: the owner bowls a gutter ball and is approved.
- `strike-declined.png`: another swing bowls a strike and is declined.
- `account.png`: the account page with the balance.

Take one more for Devpost with the real remote in someone's hand in front of the screen.

## Before posting

- [ ] Replace the names and handles in the README team section and in the Discord post.
- [ ] Paste the demo link, https://bowlometrics.pages.dev, into Devpost. Run `npm run deploy` again after any change.
- [ ] Pick the Stupidest Metric track on Devpost.
- [ ] Post in `#share-your-work`. A project that is not posted there is not judged.
