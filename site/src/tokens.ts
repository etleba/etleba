/**
 * The semantic tokens for code that cannot use CSS custom properties: canvas drawing (the disk
 * labels) and the 3D scene (the fog, the box). The stylesheet is the one source; this reads the
 * values from it once, so a change to a token in `src/styles.css` reaches the canvas and the
 * scene too. The fallbacks are the design manual's values, used only if a property is not yet
 * readable when first asked.
 */
export interface Tokens {
  /** --surface-page: warm paper. */
  page: string;
  /** --surface-emphasis: deep field. */
  emphasis: string;
  /** --text-primary: ink. */
  ink: string;
  /** --text-secondary: muted ink, for annotations on paper. */
  inkSecondary: string;
  /** --text-inverse: off-white on deep field. */
  inverse: string;
  /** --text-inverse-secondary: annotations on deep field. */
  inverseSecondary: string;
}

const FALLBACK: Tokens = {
  page: "#F2F1ED",
  emphasis: "#1A1A1A",
  ink: "#111111",
  inkSecondary: "#555555",
  inverse: "#F2F1ED",
  inverseSecondary: "#B4B3AD",
};

let cached: Tokens | null = null;

export function tokens(): Tokens {
  if (cached) return cached;
  const cs = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string): string => cs.getPropertyValue(name).trim() || fallback;
  const t: Tokens = {
    page: read("--surface-page", FALLBACK.page),
    emphasis: read("--surface-emphasis", FALLBACK.emphasis),
    ink: read("--text-primary", FALLBACK.ink),
    inkSecondary: read("--text-secondary", FALLBACK.inkSecondary),
    inverse: read("--text-inverse", FALLBACK.inverse),
    inverseSecondary: read("--text-inverse-secondary", FALLBACK.inverseSecondary),
  };
  // Only remember a complete read: before the stylesheet applies, the properties are empty.
  if (cs.getPropertyValue("--surface-page").trim()) cached = t;
  return t;
}
