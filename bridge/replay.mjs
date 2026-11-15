#!/usr/bin/env node
// Plays recorded swing files to the browser over the same WebSocket the live bridge uses.
// The status says source "replay", so the app can label it and never mistake it for live play.
//
// Usage: node bridge/replay.mjs swing.json [more.json ...] [--loop] [--gap 3000]

import fs from 'node:fs';
import { startServer } from './server.mjs';
import { swingToTimeline, shiftMessage } from './swing.mjs';

const args = process.argv.slice(2);
const loop = args.includes('--loop');
const gapIndex = args.indexOf('--gap');
const gapMs = gapIndex >= 0 ? Number(args[gapIndex + 1]) || 3000 : 3000;
const files = args.filter((a, i) => !a.startsWith('--') && (gapIndex < 0 || i !== gapIndex + 1));

if (files.length === 0) {
  console.error('Usage: node bridge/replay.mjs swing.json [more.json ...] [--loop] [--gap 3000]');
  process.exit(2);
}

const swings = files.map((file) => {
  try {
    const swing = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { file, swing, timeline: swingToTimeline(swing) };
  } catch (err) {
    console.error(`${file}: ${err.message}`);
    process.exit(2);
  }
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let playing = false;

async function playAll() {
  if (playing) return;
  playing = true;
  do {
    for (const { file, swing, timeline } of swings) {
      await sleep(gapMs);
      const hasGyro = swing.samples.some((s) => Number.isFinite(s[4]));
      server.setStatus({
        connected: true,
        device: `Replay: ${swing.label || file}`,
        sensors: { buttons: true, accel: true, gyro: hasGyro, ir: false },
        message: `Replaying a recorded ${swing.source || 'unknown'} swing. This is not live input.`,
      });
      const base = performance.now();
      for (const { at, msg } of timeline) {
        const wait = base + at - performance.now();
        if (wait > 1) await sleep(wait);
        server.broadcast(shiftMessage(msg, base));
      }
    }
  } while (loop && server.clientCount() > 0);
  playing = false;
  server.setStatus({ message: 'Replay finished. Reload the page to play it again.' });
}

const server = startServer({ source: 'replay', onClient: () => playAll() });

server.ready.then(
  () => {
    console.log(`BowlID replay listening on ws://127.0.0.1:${server.port}`);
    server.setStatus({ message: `Ready to replay ${swings.length} swing(s). Playback starts when the page connects.` });
  },
  (err) => {
    console.error(err.code === 'EADDRINUSE'
      ? `Port ${server.port} is in use. Stop the live bridge first, or set BOWLBANK_BRIDGE_PORT.`
      : `Could not start the replay: ${err.message}`);
    process.exit(1);
  },
);

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));
