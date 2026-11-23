import { type Pic, figureArt } from "./art";
import type { Entry } from "./catalogue";
import { specFor } from "./figure";
import { font, fontsFor } from "./fonts";
import { hashSeed } from "./random";
import { tokens } from "./tokens";

/**
 * Floppy labels (recipe/direction-v5.md, disks). A 3.5" disk's label is a paper sticker, and
 * this one is typeset like a figure plate: a hard-cropped field holding the repository's
 * figure, a one-pixel rule, the name in Inter bold, and a foot line with "Ethan Lee Barrett" and
 * the code. One disk in five carries the inverse sticker, off-white on deep field. The label
 * sits below the shutter, so in the box only its top, the figure, shows above the disk in front.
 * The figure is drawn off the main thread by the art pool; the text is drawn here, once Inter
 * has loaded.
 */

/** The label's printed area, width over height (72 by 56 mm). */
export const LABEL_ASPECT = 0.72 / 0.56;
/** The disk, width over height (90 by 94 mm). */
export const DISK_ASPECT = 0.9 / 0.94;

export type Sticker = "paper" | "inverse";

/** One disk in five is inverse. The seed is the one the covers of version 4 used, so the same disks keep their turn. */
export function stickerOf(entry: Entry): Sticker {
  return hashSeed(`cover:${entry.name}`) % 5 === 0 ? "inverse" : "paper";
}

/** The label's parts, in device pixels for a label `w` wide. */
function frame(w: number) {
  const h = Math.round(w / LABEL_ASPECT);
  const m = w * 0.05;
  return {
    h,
    m,
    field: { x: m, y: m, w: Math.round(w - 2 * m), h: Math.round(h * 0.5) },
    rule: Math.max(1, Math.round(w / 320)),
  };
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = Math.round(w);
  c.height = Math.round(h);
  // An alpha canvas gets greyscale antialiasing; an opaque one gets subpixel text with colour fringes.
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  return [c, ctx];
}

/** The text a label prints, so the fonts can be requested for exactly those characters. */
function words(entry: Entry): { name: string; code: string } {
  return {
    name: entry.placeholder ? "In progress" : entry.title,
    code: entry.placeholder ? "In progress" : `${entry.code} · ${entry.year}`,
  };
}

function figureFor(entry: Entry, w: number, priority: number): Promise<Pic> {
  const f = frame(w).field;
  const t = tokens();
  return figureArt(specFor(entry, f.w, f.h, stickerOf(entry) === "inverse" ? t.inverse : t.ink), priority);
}

/** Request a label's art without drawing it (the boot screen warms the cache this way). */
export function warmLabel(entry: Entry, w: number, priority: number): Promise<unknown> {
  const t = words(entry);
  return Promise.all([figureFor(entry, w, priority), fontsFor(`${t.name} ${t.code} Ethan Lee Barrett`)]);
}

/** Wrap `text` into at most two lines, shrinking from `max` towards `min` px until it fits `width`. */
function fitName(ctx: CanvasRenderingContext2D, text: string, width: number, max: number, min: number): { size: number; lines: string[] } {
  for (let size = max; size >= min; size -= 0.5) {
    ctx.font = font(700, size);
    if (ctx.measureText(text).width <= width) return { size, lines: [text] };
    const parts = text.split(" ");
    for (let cut = 1; cut < parts.length; cut++) {
      const a = parts.slice(0, cut).join(" ");
      const b = parts.slice(cut).join(" ");
      if (ctx.measureText(a).width <= width && ctx.measureText(b).width <= width) return { size, lines: [a, b] };
    }
  }
  // Too long even at the smallest size: two lines, the second cut with an ellipsis.
  ctx.font = font(700, min);
  const parts = text.split(" ");
  let first = "";
  while (parts.length && ctx.measureText(`${first} ${parts[0]}`.trim()).width <= width) first = `${first} ${parts.shift()}`.trim();
  let rest = parts.join(" ");
  while (rest && ctx.measureText(`${rest}…`).width > width) rest = rest.slice(0, -1);
  return { size: min, lines: first ? [first, rest ? `${rest}…` : ""].filter(Boolean) : [`${text.slice(0, 18)}…`] };
}

/** The label, `w` device pixels wide. */
export async function labelCanvas(entry: Entry, w: number, priority = 5): Promise<HTMLCanvasElement> {
  const f = frame(w);
  const t = tokens();
  const text = words(entry);
  const inverse = stickerOf(entry) === "inverse";
  const ground = inverse ? t.emphasis : t.page;
  const ink = inverse ? t.inverse : t.ink;
  const quiet = inverse ? t.inverseSecondary : t.inkSecondary;
  const [fig] = await Promise.all([figureFor(entry, w, priority), fontsFor(`${text.name} ${text.code} Ethan Lee Barrett`)]);
  const [c, ctx] = canvas(w, f.h);
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, w, f.h);
  // The figure's field: hard-cropped, nothing printed over it.
  ctx.drawImage(fig, f.field.x, f.field.y, f.field.w, f.field.h);
  // One rule under the field, the full width of the print.
  const ruleY = Math.round(f.field.y + f.field.h + w * 0.03);
  ctx.fillStyle = ink;
  ctx.fillRect(Math.round(f.m), ruleY, Math.round(w - 2 * f.m), f.rule);
  // The name, in at most two lines.
  const name = fitName(ctx, text.name, w - 2 * f.m, w * 0.085, w * 0.055);
  ctx.fillStyle = ink;
  ctx.textBaseline = "alphabetic";
  ctx.font = font(700, name.size);
  name.lines.forEach((line, i) => ctx.fillText(line, f.m, ruleY + f.rule + w * 0.03 + name.size * 0.86 + i * name.size * 1.08));
  // The foot: the author, then the code, on one line.
  const foot = w * 0.04;
  ctx.fillStyle = quiet;
  ctx.font = font(500, foot);
  const baseline = f.h - f.m * 0.8;
  ctx.fillText("Ethan Lee Barrett", f.m, baseline);
  ctx.textAlign = "right";
  ctx.fillText(text.code, w - f.m, baseline);
  ctx.textAlign = "left";
  return c;
}

// ---------- the disk in two dimensions (no-WebGL box, boot screen) ----------

/** Disk coordinates (metres times ten, origin at the centre, y up) to canvas pixels. */
function at(w: number, x: number, y: number): [number, number] {
  const h = w / DISK_ASPECT;
  return [((x + 0.45) / 0.9) * w, ((0.47 - y) / 0.94) * h];
}

export function diskOutline(ctx: CanvasRenderingContext2D, w: number): void {
  const r = w * 0.014;
  const c = w * 0.045;
  const h = w / DISK_ASPECT;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(w - c, 0);
  ctx.lineTo(w, c);
  ctx.lineTo(w, h - r);
  ctx.quadraticCurveTo(w, h, w - r, h);
  ctx.lineTo(r, h);
  ctx.quadraticCurveTo(0, h, 0, h - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
}

/**
 * A drawing of the whole disk, front face: body, shutter, label, the arrow and the holes. The
 * disk is an object, not chrome: black plastic and steel, as in the box.
 */
export async function diskCanvas(entry: Entry, w: number, priority = 5): Promise<HTMLCanvasElement> {
  const h = Math.round(w / DISK_ASPECT);
  const label = await labelCanvas(entry, Math.round(w * 0.8), priority);
  const [c, ctx] = canvas(w, h);
  diskOutline(ctx, w);
  ctx.fillStyle = "#0e0e0e";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = Math.max(1, w * 0.004);
  ctx.stroke();
  // Shutter, closed, with its window over solid plastic.
  const [sx0, sy0] = at(w, -0.32, 0.47);
  const [sx1, sy1] = at(w, 0.2, 0.15);
  const metal = ctx.createLinearGradient(sx0, 0, sx1, 0);
  metal.addColorStop(0, "#9c9c9c");
  metal.addColorStop(0.45, "#e2e2e2");
  metal.addColorStop(1, "#8e8e8e");
  ctx.fillStyle = metal;
  ctx.fillRect(sx0, sy0, sx1 - sx0, sy1 - sy0);
  const [wx0, wy0] = at(w, -0.26, 0.44);
  const [wx1, wy1] = at(w, -0.14, 0.2);
  ctx.fillStyle = "#0e0e0e";
  ctx.fillRect(wx0, wy0, wx1 - wx0, wy1 - wy0);
  // Label.
  const [lx0, ly0] = at(w, -0.36, 0.11);
  const [lx1, ly1] = at(w, 0.36, -0.45);
  ctx.drawImage(label, lx0, ly0, lx1 - lx0, ly1 - ly0);
  // The insertion arrow, and the write-protect and density holes.
  const [ax, ay] = at(w, -0.38, 0.43);
  const s = w * 0.035;
  ctx.fillStyle = "#262626";
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(ax + s * 0.6, ay + s);
  ctx.lineTo(ax - s * 0.6, ay + s);
  ctx.closePath();
  ctx.fill();
  for (const x of [-0.4, 0.4]) {
    const [hx, hy] = at(w, x - 0.02, -0.39);
    ctx.fillStyle = "#000";
    ctx.fillRect(hx, hy, w * 0.044, w * 0.044);
  }
  return c;
}
