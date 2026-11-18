let counter = 0;

/** Identifiant court, lisible et unique (ex. « E-lq3k9a-1 »). */
export function newId(prefix: string): string {
  counter += 1;
  const t = Date.now().toString(36).slice(-5);
  const r = Math.random().toString(36).slice(2, 5);
  return `${prefix}-${t}${r}${counter}`;
}

/** Génère un nom lisible « E12 » non encore utilisé. */
export function nextName(prefix: string, used: Iterable<string>): string {
  const set = new Set(used);
  let i = 1;
  while (set.has(`${prefix}${i}`)) i += 1;
  return `${prefix}${i}`;
}
