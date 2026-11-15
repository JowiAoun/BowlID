// Top-down 2D lane. The result is scripted; physics just animates toward it.
const W = 300, H = 560;
const PIN_R = 9, BALL_R = 15;
const CX = W / 2;

// Pins numbered like real bowling. Row 1 (headpin) is nearest the bowler.
const PINS = [
  [1, 0, 0],
  [2, -1, 1], [3, 1, 1],
  [4, -2, 2], [5, 0, 2], [6, 2, 2],
  [7, -3, 3], [8, -1, 3], [9, 1, 3], [10, 3, 3],
].map(([n, col, row]) => ({ n, x: CX + col * 19, y: 150 - row * 32 }));

export class Lane {
  constructor(canvas) {
    this.c = canvas;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr; canvas.height = H * dpr;
    this.ctx = canvas.getContext("2d");
    this.ctx.scale(dpr, dpr);
    this.reset();
  }
  reset() {
    this.pins = PINS.map((p) => ({ ...p, vx: 0, vy: 0, a: 0, va: 0, down: false, alpha: 1 }));
    this.ball = { x: CX, y: H - 40, visible: true };
    this.draw();
  }
  draw() {
    const g = this.ctx;
    g.clearRect(0, 0, W, H);
    // gutters + lane
    g.fillStyle = "#3b3f48"; g.fillRect(0, 0, W, H);
    const lane = g.createLinearGradient(40, 0, W - 40, 0);
    lane.addColorStop(0, "#d9a86c"); lane.addColorStop(0.5, "#e8c08a"); lane.addColorStop(1, "#d9a86c");
    g.fillStyle = lane; g.fillRect(40, 0, W - 80, H);
    g.strokeStyle = "rgba(120,70,20,.18)";
    for (let x = 48; x < W - 40; x += 14) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    // arrows
    g.fillStyle = "rgba(90,50,10,.45)";
    for (let i = -2; i <= 2; i++) {
      const x = CX + i * 26, y = H - 170 + Math.abs(i) * 14;
      g.beginPath(); g.moveTo(x, y - 10); g.lineTo(x - 5, y + 6); g.lineTo(x + 5, y + 6); g.fill();
    }
    // foul line
    g.fillStyle = "#b3261e"; g.fillRect(40, H - 80, W - 80, 3);
    // pins
    for (const p of this.pins) {
      g.save();
      g.globalAlpha = p.alpha;
      g.translate(p.x, p.y); g.rotate(p.a);
      g.fillStyle = "#fafafa"; g.strokeStyle = "#999"; g.lineWidth = 1;
      if (p.down) { g.beginPath(); g.ellipse(0, 0, PIN_R * 0.8, PIN_R * 1.8, 0, 0, Math.PI * 2); g.fill(); g.stroke(); }
      else { g.beginPath(); g.arc(0, 0, PIN_R, 0, Math.PI * 2); g.fill(); g.stroke(); g.fillStyle = "#c62828"; g.fillRect(-PIN_R, -2, PIN_R * 2, 4); }
      g.restore();
    }
    // ball
    if (this.ball.visible) {
      const b = this.ball;
      const grad = g.createRadialGradient(b.x - 5, b.y - 5, 2, b.x, b.y, BALL_R);
      grad.addColorStop(0, "#6f7bf7"); grad.addColorStop(1, "#1f2a8a");
      g.fillStyle = grad; g.beginPath(); g.arc(b.x, b.y, BALL_R, 0, Math.PI * 2); g.fill();
    }
  }
  // speed: peak g (1..6). curve: -1..1. knocked: how many pins fall (survivors are the back-right ones).
  roll({ speed = 3, curve = 0, knocked = 9 } = {}) {
    this.reset();
    const survivors = new Set([10, 7, 9, 6, 4, 8, 5, 3, 2, 1].slice(0, 10 - knocked));
    const dur = Math.max(900, Math.min(2200, 2600 - speed * 330));
    const startX = CX + curve * 40;
    const endX = CX + 10; // the pocket. Always the pocket. It is rigged.
    return new Promise((resolve) => {
      const t0 = performance.now();
      let hit = false, hitAt = 0;
      const step = (now) => {
        const k = Math.min(1, (now - t0) / dur);
        const e = k; // constant speed reads better on a projector
        this.ball.y = (H - 40) + (40 - (H - 40)) * e;
        this.ball.x = startX + (endX - startX) * e + Math.sin(e * Math.PI) * curve * 35;
        if (!hit && this.ball.y < 165) {
          hit = true; hitAt = now;
          for (const p of this.pins) {
            if (survivors.has(p.n)) { p.va = 0.12; continue; } // the survivor wobbles, then stays up
            const dx = p.x - this.ball.x + (Math.random() - 0.5) * 6;
            p.vx = dx * 0.12 + (Math.random() - 0.5) * 2;
            p.vy = -3 - Math.random() * 3;
            p.va = (Math.random() - 0.5) * 0.5;
            p.down = true;
          }
        }
        if (hit) {
          for (const p of this.pins) {
            if (p.down) { p.x += p.vx; p.y += p.vy; p.a += p.va; p.vx *= 0.96; p.vy *= 0.96; p.alpha = Math.max(0.15, p.alpha - 0.01); }
            else { p.a = Math.sin((now - hitAt) / 70) * 0.35 * Math.max(0, 1 - (now - hitAt) / 1400); }
          }
          if (this.ball.y < -BALL_R) this.ball.visible = false;
        }
        this.draw();
        if (k < 1 || now - hitAt < 1700) this.raf = requestAnimationFrame(step);
        else resolve();
      };
      this.raf = requestAnimationFrame(step);
    });
  }
}
