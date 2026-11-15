// Browser text-to-speech. Resolves when the line finishes (or a timeout, since onend is flaky).
let muted = false;
let voice = null;

function pickVoice() {
  const vs = window.speechSynthesis?.getVoices() ?? [];
  voice =
    vs.find((v) => /en[-_]GB/i.test(v.lang) && /george|daniel|ryan|male/i.test(v.name)) ||
    vs.find((v) => /en[-_]GB/i.test(v.lang)) ||
    vs.find((v) => /^en/i.test(v.lang)) ||
    null;
}
if ("speechSynthesis" in window) {
  speechSynthesis.onvoiceschanged = pickVoice;
  pickVoice();
}

export const isMuted = () => muted;
export function toggleMute() { muted = !muted; if (muted) speechSynthesis?.cancel(); return muted; }
export function stopSpeaking() { window.speechSynthesis?.cancel(); }

export function speak(text) {
  return new Promise((resolve) => {
    const fallbackMs = 1200 + text.length * 70;
    if (muted || !("speechSynthesis" in window)) return setTimeout(resolve, fallbackMs * 0.6);
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.rate = 1.0;
    u.pitch = 0.8;
    const t = setTimeout(resolve, fallbackMs + 1500);
    u.onend = u.onerror = () => { clearTimeout(t); resolve(); };
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  });
}
