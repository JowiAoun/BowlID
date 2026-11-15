// Records one swing from a stream of samples. Every input source feeds this same recorder.
import { PRE_MS, POST_MS } from './signal.js';

const KEEP_MS = 1500;

export class SwingRecorder {
  constructor({ onSwing, onState }) {
    this.onSwing = onSwing;
    this.onState = onState || (() => {});
    this.buffer = [];
    this.state = 'idle';
    this.pressT = 0;
    this.releaseT = 0;
    this.timer = null;
  }

  push(rows) {
    for (const r of rows) this.buffer.push(r);
    const last = this.buffer[this.buffer.length - 1];
    if (!last) return;
    if (this.state === 'idle') {
      // Keep a short history so the swing includes the moment before the press.
      const cut = last[0] - KEEP_MS;
      let i = 0;
      while (i < this.buffer.length && this.buffer[i][0] < cut) i++;
      if (i > 0) this.buffer.splice(0, i);
    } else if (this.state === 'follow' && last[0] >= this.releaseT + POST_MS) {
      this.finish();
    }
  }

  press(t) {
    if (this.state !== 'idle') return;
    this.state = 'swing';
    this.pressT = t;
    const cut = t - PRE_MS;
    this.buffer = this.buffer.filter((r) => r[0] >= cut);
    this.onState('swing');
  }

  release(t) {
    if (this.state !== 'swing') return;
    this.state = 'follow';
    this.releaseT = t;
    this.onState('follow');
    // If the stream stops right after the release, finish with what was captured.
    this.timer = setTimeout(() => this.finish(), POST_MS + 250);
  }

  cancel() {
    clearTimeout(this.timer);
    this.state = 'idle';
    this.onState('idle');
  }

  finish() {
    if (this.state !== 'follow') return;
    clearTimeout(this.timer);
    const samples = this.buffer.filter((r) => r[0] <= this.releaseT + POST_MS);
    this.state = 'idle';
    this.buffer = [];
    this.onState('idle');
    this.onSwing({ samples, pressT: this.pressT, releaseT: this.releaseT });
  }
}
