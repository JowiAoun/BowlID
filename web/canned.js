// Shared by the browser and the server: pick a canned line and fill {feature} slots.
export function pickCanned(canned, stage, variant, features = {}) {
  const pool = canned?.[stage]?.[variant] ?? canned?.[stage]?.fail ?? ["Inconclusive. Suspicious."];
  // Prefer lines whose placeholders we can actually fill.
  const usable = pool.filter((l) =>
    [...l.matchAll(/\{(\w+)\}/g)].every((m) => features[m[1]] !== undefined)
  );
  const list = usable.length ? usable : pool.filter((l) => !l.includes("{"));
  const line = (list.length ? list : pool)[Math.floor(Math.random() * (list.length || pool.length))];
  return line.replace(/\{(\w+)\}/g, (_, k) => String(features[k] ?? "?"));
}
