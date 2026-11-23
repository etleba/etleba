import type { Entry } from "./catalogue";
import { type AnyCanvas, context, makeCanvas } from "./art/canvas";
import { hashSeed, rng } from "./random";

/**
 * Figures (recipe/direction-v5.md). Every repository is drawn as one deterministic generative
 * figure: ink on paper, or off-white on deep field for the inverse sticker. The same entry always
 * draws the same figure, and the figure is a function of the repository's data, so it is a small
 * piece of analysis and not an ornament.
 *
 * Three families, after the design manual's motifs. The LANGUAGE picks the family and the NAME
 * seeds the form (positions, angles, components), so no two repositories draw alike:
 *
 *   radial  a point study: points on concentric rings, denser towards one side of the circle
 *   branch  an iterative branch: a tiered stem whose laterals fork to a given depth
 *   curve   a probability distribution rising from a baseline, with dots sampled under it
 *
 * Three measures set the figure's extent. Each goes through one monotonic, bounded mapping
 * (log-scaled and clamped, then quantised to a small number of steps), so 0 stars and 500 stars
 * both look intentional, a thousand stars cannot swamp a label, and one more star does not
 * redraw a cached figure unless it crosses a step:
 *
 *   stars  -> starLevel 0..24    log2(1 + stars) / 9, clamped:  saturates at 511 stars
 *   age    -> ageLevel  0..6     log2(1 + months) / log2(61), clamped:  saturates at five years
 *   push   -> freshLevel 0..12   1 - log2(1 + days since push) / log2(731), clamped:
 *                                pushed today is 12, two years ago or more is 0
 *
 * Then, per family (STARS sets the count or depth, AGE the rings or tiers, PUSH the completion):
 *
 *            stars (0..24)                  age (0..6)          push (0..12)
 *   radial   points = 144 + 280 * s / 24    rings = 2 + age     arc swept = 40% + 60% * f of the circle
 *   curve    dots   = 144 + 280 * s / 24    tiers = 2 + age     distribution drawn to 40% + 60% * f of its width
 *   branch   depth  = 5 + round(3 * s / 24) tiers = 3 + age     tips carrying a point = 30% + 70% * f
 *
 * where s is the star level (0..24) and f is the push level (0..12) over 12. Nearly every
 * repository starts with no stars, so the floor is the common case and must read as a finished
 * figure: 144 points (every ring carries points, even the innermost) and a branch depth of 5.
 * Stars then add density and extent on top. Points are drawn in the order the seeded stream
 * produces them, so more stars add points to a figure without moving the ones it already had.
 * A placeholder ("In progress") draws none of this: 12 to 18 points, a dotted baseline, and
 * nothing resolved, so it is plainly sparser than any real figure. Point size and rule weight
 * are one fixed unit for the whole figure (about one pixel at label size), with no blur and no
 * text, so the figure draws in a worker.
 */

export type Family = "radial" | "branch" | "curve";
export const FAMILIES: readonly Family[] = ["radial", "branch", "curve"];

export const STAR_STEPS = 24;
export const AGE_STEPS = 6;
export const FRESH_STEPS = 12;
/** log2(1 + stars) reaches 9 at 511 stars: that and everything above draws the same extent. */
const STAR_LOG_FULL = 9;
/** Five years, in months. */
const AGE_FULL_MONTHS = 60;
/** Two years, in days. */
const FRESH_HORIZON_DAYS = 730;
const DAY = 86_400_000;

const BY_LANGUAGE: Record<string, Family> = {
  // Dynamic, numerical and scripting languages: a point study.
  Python: "radial", "Jupyter Notebook": "radial", R: "radial", Julia: "radial", Lua: "radial", Ruby: "radial", PHP: "radial", Perl: "radial", MATLAB: "radial", Elixir: "radial",
  // Typed, compiled and markup languages, where the structure is the point: a branch.
  TypeScript: "branch", Rust: "branch", Go: "branch", C: "branch", "C++": "branch", "C#": "branch", Java: "branch", Kotlin: "branch", Swift: "branch", HTML: "branch", XML: "branch", Haskell: "branch", Scala: "branch", Dart: "branch", Zig: "branch",
  // Shell, stream and styling languages: a distribution.
  Shell: "curve", PowerShell: "curve", Batchfile: "curve", JavaScript: "curve", CSS: "curve", SCSS: "curve", Makefile: "curve", Dockerfile: "curve", Nix: "curve", Markdown: "curve", TeX: "curve",
};

/** The language picks the family. An unknown or missing language is decided by a hash, so it is still stable. */
export function familyOf(language: string | null, seed: string): Family {
  const known = language ? BY_LANGUAGE[language] : undefined;
  return known ?? FAMILIES[hashSeed(`family:${language ?? seed}`) % FAMILIES.length];
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

export function starLevel(stars: number): number {
  return Math.round(STAR_STEPS * clamp01(Math.log2(1 + Math.max(0, stars)) / STAR_LOG_FULL));
}
export function ageLevel(days: number): number {
  const months = Math.max(0, days) / 30;
  return Math.round(AGE_STEPS * clamp01(Math.log2(1 + months) / Math.log2(1 + AGE_FULL_MONTHS)));
}
export function freshLevel(daysSincePush: number): number {
  return Math.round(FRESH_STEPS * (1 - clamp01(Math.log2(1 + Math.max(0, daysSincePush)) / Math.log2(1 + FRESH_HORIZON_DAYS))));
}

export interface Measures {
  stars: number;
  age: number;
  fresh: number;
}

type Dated = Pick<Entry, "stargazers_count" | "created_at" | "pushed_at" | "placeholder">;

/** The three quantised measures of an entry, as of `now`. A placeholder has none. */
export function measuresOf(entry: Dated, now = Date.now()): Measures {
  if (entry.placeholder) return { stars: 0, age: 0, fresh: 0 };
  const born = Date.parse(entry.created_at);
  const pushed = Date.parse(entry.pushed_at || entry.created_at);
  return {
    stars: starLevel(entry.stargazers_count),
    age: Number.isNaN(born) ? 0 : ageLevel((now - born) / DAY),
    fresh: Number.isNaN(pushed) ? 0 : freshLevel((now - pushed) / DAY),
  };
}

/** Everything a figure is drawn from. Integers only, so it is also the cache key. */
export interface FigureSpec extends Measures {
  family: Family;
  /** The repository's name: seeds the form. */
  seed: string;
  /** Device pixels. */
  w: number;
  h: number;
  /** The ink colour; the background is transparent. */
  ink: string;
  placeholder: boolean;
  /**
   * The drawing unit in device pixels: a point's radius, a rule's width. It is the scale the
   * figure will be shown at, not its size, so a figure on a wide sheet keeps the same fine
   * points and one-pixel rules as one on a label. Quarter steps, so it is also a cache key.
   */
  unit: number;
}

export function specFor(entry: Dated & Pick<Entry, "name" | "language">, w: number, h: number, ink: string, opts: { unit?: number; now?: number } = {}): FigureSpec {
  return {
    family: entry.placeholder ? "radial" : familyOf(entry.language, entry.name),
    seed: entry.name,
    ...measuresOf(entry, opts.now),
    w: Math.max(8, Math.round(w)),
    h: Math.max(8, Math.round(h)),
    ink,
    placeholder: Boolean(entry.placeholder),
    unit: Math.round((opts.unit ?? unitOf(w)) * 4) / 4,
  };
}

/** What a spec draws, in words and numbers: the caption's text, and the check that the mapping holds. */
export interface Shape {
  family: Family;
  name: string;
  /** Sampled points (radial and curve). A branch's points are its tips, which depend on its depth, so this is 0. */
  points: number;
  /** Radial rings, or branch and curve tiers. */
  rings: number;
  depth: number;
  /** Share of the figure completed, from the push recency, 0..1. */
  completion: number;
}

export function shapeOf(spec: FigureSpec): Shape {
  const s = spec.stars / STAR_STEPS;
  const f = spec.fresh / FRESH_STEPS;
  const rings = 2 + spec.age;
  if (spec.placeholder) return { family: spec.family, name: "Unresolved field", points: 0, rings: 0, depth: 0, completion: 0 };
  switch (spec.family) {
    case "radial":
      return { family: "radial", name: "Radial point study", points: 144 + Math.round(280 * s), rings, depth: 0, completion: 0.4 + 0.6 * f };
    case "curve":
      return { family: "curve", name: "Probability distribution", points: 144 + Math.round(280 * s), rings, depth: 0, completion: 0.4 + 0.6 * f };
    default:
      return { family: "branch", name: "Iterative branch", points: 0, rings: rings + 1, depth: 5 + Math.round(3 * s), completion: 0.3 + 0.7 * f };
  }
}

// ---------- geometry ----------

interface Stroke {
  /** "poly": one connected polyline; "segs": independent segments, x1 y1 x2 y2 each. */
  kind: "poly" | "segs";
  pts: number[];
  alpha: number;
  dash?: [number, number];
}

export interface Geometry {
  strokes: Stroke[];
  /** x, y pairs: one fixed-size point each. */
  dots: number[];
  /** x, y pairs: plus marks. */
  marks: number[];
}

const TAU = Math.PI * 2;
const RAD = Math.PI / 180;

/**
 * The default drawing unit for a figure `w` pixels wide: about one pixel at a disk label's size,
 * growing with the texture so the label looks the same at every texture size. Figures shown at
 * their own size (the sheet, the index) pass the device-pixel ratio instead.
 */
export function unitOf(w: number): number {
  return Math.max(1, w / 300);
}

/** A repeatable number in [0, 1) for a key: lets a deeper branch keep the nodes a shallower one had. */
const jit = (key: string): number => rng(hashSeed(key))();

function radial(spec: FigureSpec, g: Geometry): void {
  const { w, h } = spec;
  const r = rng(hashSeed(`radial:${spec.seed}`));
  const shape = shapeOf(spec);
  const cx = w * (0.5 + (r() - 0.5) * 0.2);
  const cy = h * (0.5 + (r() - 0.5) * 0.08);
  // The circle is a little taller than a wide field, so it is cropped hard at the top and foot,
  // but about three fifths of the outer ring stays inside it.
  const R = Math.min(w * 0.47, h * 0.62);
  const sweep = TAU * shape.completion;
  // The swept arc is centred on the left or right of the circle, where the field shows it, and
  // never on the cropped top or foot. The points are densest near its middle.
  const mid = (r() < 0.5 ? 0 : Math.PI) + (r() - 0.5);
  const a0 = mid - sweep / 2;
  const dense = mid + (r() - 0.5) * 0.5 * sweep;
  // Construction rings, drawn across the swept arc only.
  for (let k = 1; k <= shape.rings; k++) {
    const rho = (R * k) / shape.rings;
    const n = Math.max(24, Math.ceil(sweep * rho));
    const pts: number[] = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + (sweep * i) / n;
      pts.push(cx + Math.cos(a) * rho, cy + Math.sin(a) * rho);
    }
    g.strokes.push({ kind: "poly", pts, alpha: 0.32 });
  }
  // Points: a ring is chosen in proportion to its circumference plus a base share, so even the
  // innermost ring carries points; the angle is biased towards the dense side.
  const base = shape.rings * 0.6;
  const total = (shape.rings * (shape.rings + 1)) / 2 + base * shape.rings;
  const spacing = R / shape.rings;
  for (let i = 0; i < shape.points; i++) {
    let pick = r() * total;
    let k = 1;
    while (k < shape.rings && pick > k + base) pick -= k++ + base;
    const lock = r() < 0.88;
    let a = a0 + r() * sweep;
    for (let tries = 0; tries < 8; tries++) {
      if (r() < 0.5 + 0.5 * Math.cos(a - dense)) break;
      a = a0 + r() * sweep;
    }
    const rho = lock ? (R * k) / shape.rings + (r() - 0.5) * spacing * 0.2 : R * Math.sqrt(r());
    g.dots.push(cx + Math.cos(a) * rho, cy + Math.sin(a) * rho);
  }
  g.marks.push(cx, cy);
}

function curve(spec: FigureSpec, g: Geometry): void {
  const { w, h } = spec;
  const u = spec.unit;
  const r = rng(hashSeed(`curve:${spec.seed}`));
  const shape = shapeOf(spec);
  const x0 = w * 0.04;
  const span = w * 0.92;
  const yb = Math.round(h * 0.9) + 0.5 * u;
  const top = h * 0.1;
  const Hc = yb - top;
  const parts = 1 + (r() < 0.65 ? 1 : 0) + (r() < 0.3 ? 1 : 0);
  const comps = Array.from({ length: parts }, () => ({ mu: 0.18 + 0.64 * r(), sigma: 0.045 + 0.08 * r(), wt: 0.5 + r() }));
  const pdf = (t: number): number => comps.reduce((s, c) => s + c.wt * Math.exp(-0.5 * ((t - c.mu) / c.sigma) ** 2), 0);
  let peak = 0;
  for (let i = 0; i <= 200; i++) peak = Math.max(peak, pdf(i / 200));
  const height = (t: number): number => (pdf(t) / peak) * Hc;
  const sweep = shape.completion;
  // The baseline runs the full width; the distribution rises from it as far as the push recency allows.
  g.strokes.push({ kind: "poly", pts: [x0, yb, x0 + span, yb], alpha: 1 });
  const n = Math.max(8, Math.ceil(span * sweep));
  const pts: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = (sweep * i) / n;
    pts.push(x0 + span * t, yb - height(t));
  }
  g.strokes.push({ kind: "poly", pts, alpha: 1 });
  // Where the drawing stops it is closed by a rule down to the baseline, so the cut reads as deliberate.
  if (sweep < 1) g.strokes.push({ kind: "poly", pts: [pts[n * 2], pts[n * 2 + 1], pts[n * 2], yb], alpha: 1 });
  // Tiers: contour rules at equal heights, where the distribution is above them.
  for (let k = 1; k <= shape.rings; k++) {
    const level = (Hc * k) / (shape.rings + 1);
    const y = Math.round(yb - level) + 0.5 * u;
    const segs: number[] = [];
    let from = -1;
    for (let i = 0; i <= n; i++) {
      const above = yb - pts[i * 2 + 1] >= level;
      if (above && from < 0) from = i;
      if ((!above || i === n) && from >= 0) {
        const to = above ? i : i - 1;
        if (to > from) segs.push(pts[from * 2], y, pts[to * 2], y);
        from = -1;
      }
    }
    if (segs.length) g.strokes.push({ kind: "segs", pts: segs, alpha: 0.3 });
  }
  // Points sampled under the curve, more of them where it is higher.
  for (let i = 0; i < shape.points; i++) {
    let t = r() * sweep;
    for (let tries = 0; tries < 24; tries++) {
      if (r() < pdf(t) / peak) break;
      t = r() * sweep;
    }
    g.dots.push(x0 + span * t, yb - height(t) * r());
  }
  let mode = 0;
  for (let i = 0; i <= n; i++) if (pts[i * 2 + 1] < pts[mode * 2 + 1]) mode = i;
  g.marks.push(pts[mode * 2], yb);
}

function branch(spec: FigureSpec, g: Geometry): void {
  const { w, h } = spec;
  const u = spec.unit;
  const r = rng(hashSeed(`branch:${spec.seed}`));
  const shape = shapeOf(spec);
  const x0 = w * (0.5 + (r() - 0.5) * 0.28);
  const y0 = h * 1.02;
  const Ht = h * (0.78 + 0.18 * r());
  const lean = (r() - 0.5) * 0.3;
  // How far the laterals reach (never past the nearer side, so the figure is cropped only at the
  // top and foot), how steeply the lowest ones leave the stem, and how fast they close up.
  const reach = Math.min(Math.min(x0, w - x0) * 0.92, Ht * 1.05) * (0.7 + 0.3 * r());
  const fan = 62 + 18 * r();
  const close = 20 + 20 * r();
  const tiers = shape.rings;
  // More tiers sit closer together, so their laterals are shortened to stop them tangling.
  const crowd = Math.min(1, 5 / tiers + 0.2);
  const D = shape.depth;
  const segs: number[] = [];
  const tips: { x: number; y: number; rank: number }[] = [];
  const minLen = 1.4 * u;
  const trunkAt = (t: number): [number, number] => [x0 + Math.sin(lean) * Ht * t, y0 - Math.cos(lean) * Ht * t];
  const grow = (x: number, y: number, ang: number, len: number, d: number, key: string): void => {
    const ex = x + Math.sin(ang) * len;
    const ey = y - Math.cos(ang) * len;
    segs.push(x, y, ex, ey);
    if (d <= 0 || len < minLen) {
      tips.push({ x: ex, y: ey, rank: jit(`${key}:tip`) });
      return;
    }
    const spread = (16 + 22 * jit(`${key}:s`)) * RAD;
    const ratio = 0.58 + 0.16 * jit(`${key}:r`);
    // Children are drawn a little back towards the vertical, so the figure grows up and not out.
    const base = ang * 0.88;
    grow(ex, ey, base - spread, len * ratio, d - 1, `${key}L`);
    grow(ex, ey, base + spread, len * ratio, d - 1, `${key}R`);
  };
  for (let i = 1; i <= tiers; i++) {
    const t = 0.1 + (0.8 * (i - 1)) / Math.max(1, tiers - 1);
    const [px, py] = trunkAt(t);
    const depth = Math.max(1, D - 1 - Math.floor(((i - 1) * (D - 2)) / Math.max(1, tiers - 1)));
    for (const side of [-1, 1]) {
      const key = `${spec.seed}:${i}:${side}`;
      const ang = side * (fan - close * t + (jit(`${key}:a`) - 0.5) * 16) * RAD + lean;
      const len = reach * crowd * (1 - t * 0.8) * (0.7 + 0.5 * jit(`${key}:l`));
      grow(px, py, ang, len, depth, key);
    }
  }
  const [tx, ty] = trunkAt(1);
  segs.push(x0, y0, tx, ty);
  g.strokes.push({ kind: "segs", pts: segs, alpha: 1 });
  for (const tip of tips) if (tip.rank < shape.completion) g.dots.push(tip.x, tip.y);
  g.marks.push(tx, ty);
}

/** A placeholder: a few points that have not yet accumulated, on a dotted baseline. Nothing is resolved. */
function unresolved(spec: FigureSpec, g: Geometry): void {
  const { w, h } = spec;
  const u = spec.unit;
  const r = rng(hashSeed(`unresolved:${spec.seed}`));
  const yb = Math.round(h * 0.84) + 0.5 * u;
  g.strokes.push({ kind: "poly", pts: [w * 0.04, yb, w * 0.96, yb], alpha: 0.55, dash: [u, 4 * u] });
  const n = 12 + Math.floor(r() * 7);
  for (let i = 0; i < n; i++) g.dots.push(w * (0.5 + (r() - 0.5) * 0.72), h * (0.18 + 0.58 * r()));
  g.marks.push(w * (0.5 + (r() - 0.5) * 0.3), h * 0.5);
}

/** The figure's geometry in canvas pixels. Pure: the same spec always gives the same numbers. */
export function figureGeometry(spec: FigureSpec): Geometry {
  const g: Geometry = { strokes: [], dots: [], marks: [] };
  if (spec.placeholder) unresolved(spec, g);
  else if (spec.family === "radial") radial(spec, g);
  else if (spec.family === "curve") curve(spec, g);
  else branch(spec, g);
  return g;
}

/** Draw a spec on a transparent canvas in its ink. Runs on the page or in a worker. */
export function figureCanvas(spec: FigureSpec): AnyCanvas {
  const c = makeCanvas(spec.w, spec.h);
  const ctx = context(c);
  const g = figureGeometry(spec);
  const u = spec.unit;
  ctx.strokeStyle = spec.ink;
  ctx.fillStyle = spec.ink;
  ctx.lineWidth = u;
  ctx.lineCap = "butt";
  ctx.lineJoin = "round";
  for (const s of g.strokes) {
    ctx.globalAlpha = s.alpha;
    ctx.setLineDash(s.dash ?? []);
    ctx.beginPath();
    if (s.kind === "poly") {
      ctx.moveTo(s.pts[0], s.pts[1]);
      for (let i = 2; i < s.pts.length; i += 2) ctx.lineTo(s.pts[i], s.pts[i + 1]);
    } else {
      for (let i = 0; i < s.pts.length; i += 4) {
        ctx.moveTo(s.pts[i], s.pts[i + 1]);
        ctx.lineTo(s.pts[i + 2], s.pts[i + 3]);
      }
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  const pr = 1.1 * u;
  ctx.beginPath();
  for (let i = 0; i < g.dots.length; i += 2) {
    ctx.moveTo(g.dots[i] + pr, g.dots[i + 1]);
    ctx.arc(g.dots[i], g.dots[i + 1], pr, 0, TAU);
  }
  ctx.fill();
  // Plus marks: the construction's origin, marked once.
  const arm = 3.5 * u;
  ctx.beginPath();
  for (let i = 0; i < g.marks.length; i += 2) {
    ctx.moveTo(g.marks[i] - arm, g.marks[i + 1]);
    ctx.lineTo(g.marks[i] + arm, g.marks[i + 1]);
    ctx.moveTo(g.marks[i], g.marks[i + 1] - arm);
    ctx.lineTo(g.marks[i], g.marks[i + 1] + arm);
  }
  ctx.stroke();
  return c;
}
