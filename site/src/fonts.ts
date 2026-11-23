/**
 * Inter, the one family (self-hosted by `@fontsource-variable/inter`, loaded by `src/main.ts`).
 * Canvas text does not wait for a webfont the way the page does: drawn too early, it falls
 * back to Arial and stays that way in the cached texture. So anything that draws text on a
 * canvas awaits `fontsFor` first. Workers draw figures only and never text, so they need no font.
 */
export const SANS = '"Inter Variable", Arial, Helvetica, sans-serif';

/** A canvas font string in Inter. */
export function font(weight: number, px: number): string {
  return `${weight} ${px.toFixed(1)}px ${SANS}`;
}

const loaded = new Map<string, Promise<void>>();

/**
 * Resolves once the weights drawn on the canvas are loaded for these characters. It never
 * rejects: if the font cannot load, the canvas draws in the fallback and the page still works.
 */
export function fontsFor(text: string): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return Promise.resolve();
  const key = text;
  let p = loaded.get(key);
  if (!p) {
    p = Promise.all([500, 700].map((w) => document.fonts.load(`${w} 16px "Inter Variable"`, text)))
      .then(() => undefined)
      .catch(() => undefined);
    loaded.set(key, p);
    if (loaded.size > 200) loaded.delete(loaded.keys().next().value as string);
  }
  return p;
}
