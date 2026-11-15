// Optional Amplitude analytics. With no key, every call here does nothing.
// Events carry scores and counts only. No names, no account numbers, no swing data.

const key = import.meta.env.VITE_AMPLITUDE_API_KEY;
let ready = null;

function load() {
  if (!key) return null;
  if (!ready) {
    ready = import('@amplitude/analytics-browser')
      .then((amp) => {
        amp.init(key, undefined, { autocapture: false, defaultTracking: false, identityStorage: 'none' });
        return amp;
      })
      .catch(() => null);
  }
  return ready;
}

export const analyticsOn = Boolean(key);

export function track(name, props = {}) {
  const p = load();
  if (p) p.then((amp) => amp && amp.track(name, props));
}
