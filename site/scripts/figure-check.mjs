#!/usr/bin/env node
/**
 * Checks the figure generator (src/figure.ts) as the direction record promises, in a real browser
 * canvas, through Vite's dev server and the study page recipe/studies/figure-sheet.html:
 *   determinism   the same entry draws identical pixels twice (and in a different order)
 *   monotonic     more stars never reduce the points or depth, the ink, or the star level; more age
 *                 never reduces the rings; more days since the push never raise the completion
 *   prefix-stable more stars add points without moving the ones already there
 *   bounded       stars at and above 511 draw the same figure; the age and the push saturate too
 *   cache key     every input (stars, age, push, unit, ink, size) is in the job key, and an input
 *                 that does not change the figure does not change the key
 *   placeholder   an "In progress" figure carries fewer points and less ink than any real figure
 * Usage: node scripts/figure-check.mjs [--out recipe/evidence/figure-check-v5.result.json]
 * Expects a Playwright install reachable through NODE_PATH or node_modules.
 */
import path from "node:path";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createServer } from "vite";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const args = process.argv.slice(2);
const out = path.resolve(args.includes("--out") ? args[args.indexOf("--out") + 1] : path.join(root, "recipe", "evidence", "figure-check-v5.result.json"));

const server = await createServer({ root, logLevel: "error", server: { host: "127.0.0.1", port: 0 } });
await server.listen();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`${server.resolvedUrls.local[0]}recipe/studies/figure-sheet.html`, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });

const result = await page.evaluate(async () => {
  const F = window.__figure;
  const { specFor, figureCanvas, figureGeometry, shapeOf, measuresOf, toEntries, base, jobKey, ART_VERSION, now } = F;
  const W = 600;
  const H = 260;
  const hex = async (buf) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", buf))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const pixels = (spec) => {
    const c = figureCanvas(spec);
    return c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  };
  const hash = async (spec) => hex(pixels(spec));
  /** Total ink: the sum of the alpha channel. */
  const ink = (spec) => {
    const d = pixels(spec);
    let s = 0;
    for (let i = 3; i < d.length; i += 4) s += d[i];
    return s;
  };
  const checks = [];
  const add = (name, pass, detail) => checks.push({ name, pass, detail });

  // 1. Determinism: identical pixels twice, and in a different order.
  const entries = [...F.stress, ...F.placeholders];
  let mismatched = 0;
  const firstHashes = [];
  for (const e of entries) {
    const spec = specFor(e, W, H, F.paperInk, { now });
    const a = await hash(spec);
    const b = await hash(spec);
    firstHashes.push(a);
    if (a !== b) mismatched++;
  }
  // A second pass in reverse order must also match the first.
  let reordered = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    const h = await hash(specFor(entries[i], W, H, F.paperInk, { now }));
    if (h !== firstHashes[i]) reordered++;
  }
  const distinct = new Set(firstHashes).size;
  add("determinism: the same entry draws identical pixels twice", mismatched === 0, { entries: entries.length, mismatched });
  add("determinism: drawing in reverse order gives the same pixels", reordered === 0, { entries: entries.length, mismatched: reordered });
  add("determinism: different names draw different figures", distinct === entries.length, { entries: entries.length, distinctFigures: distinct });

  // 2. Monotonic in stars, per family.
  const ladder = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 500, 511, 1000, 5000, 100000];
  const families = [["radial", "Python"], ["branch", "TypeScript"], ["curve", "Shell"]];
  const young = { ...base, created_at: "2026-02-01T00:00:00Z", pushed_at: "2026-11-10T00:00:00Z" };
  const table = {};
  for (const [family, language] of families) {
    const rows = [];
    for (const stars of ladder) {
      const [entry] = toEntries([{ ...young, name: `mono-${family}`, language, stargazers_count: stars }]);
      const spec = specFor(entry, W, H, F.paperInk, { now });
      const g = figureGeometry(spec);
      const s = shapeOf(spec);
      rows.push({ stars, level: spec.stars, points: s.points, depth: s.depth, dots: g.dots.length / 2, segments: family === "branch" ? g.strokes[0].pts.length / 4 : 0, ink: ink(spec) });
    }
    table[family] = rows;
    const nondec = (key) => rows.every((r, i) => i === 0 || r[key] >= rows[i - 1][key]);
    const keys = family === "branch" ? ["level", "depth", "dots", "segments", "ink"] : ["level", "points", "dots", "ink"];
    add(`monotonic: ${family} never loses ${keys.join(", ")} as stars rise`, keys.every(nondec), { violations: keys.filter((k) => !nondec(k)) });
    // Bounded: at and above 511 stars it is the same figure.
    const sat = rows.filter((r) => r.stars >= 511);
    add(`bounded: ${family} at 511, 1000, 5000 and 100000 stars is one figure`, sat.every((r) => r.ink === sat[0].ink && r.level === sat[0].level), { ink: sat.map((r) => r.ink) });
    add(`bounded: ${family} at 0 stars and at 500 stars both draw a whole figure`, rows[0].ink > 0 && rows.find((r) => r.stars === 500).ink > rows[0].ink, { ink0: rows[0].ink, ink500: rows.find((r) => r.stars === 500).ink, dots0: rows[0].dots, dots500: rows.find((r) => r.stars === 500).dots });
  }

  // 3. Prefix-stable: more stars add points without moving the ones already there.
  for (const [family, language] of families) {
    const geo = (stars) => {
      const [entry] = toEntries([{ ...young, name: `prefix-${family}`, language, stargazers_count: stars }]);
      return figureGeometry(specFor(entry, W, H, F.paperInk, { now }));
    };
    const lo = geo(1);
    const hi = geo(300);
    if (family === "branch") {
      // The branch grows by depth: every segment of the lower depth is in the higher one.
      const key = (a, i) => [0, 1, 2, 3].map((k) => a[i + k].toFixed(4)).join(",");
      const seg = (g) => new Set(Array.from({ length: g.strokes[0].pts.length / 4 }, (_, n) => key(g.strokes[0].pts, n * 4)));
      const A = seg(lo);
      const B = seg(hi);
      add("prefix-stable: branch keeps every segment it had when it grows deeper", [...A].every((s) => B.has(s)), { lowerSegments: A.size, higherSegments: B.size });
    } else {
      const n = lo.dots.length;
      add(`prefix-stable: ${family} keeps every point it had when stars rise`, hi.dots.length > n && lo.dots.every((v, i) => v === hi.dots[i]), { before: n / 2, after: hi.dots.length / 2 });
    }
  }

  // 4. Age and push recency: monotonic and bounded.
  const DAY = 86400000;
  const ageRows = [0, 10, 30, 90, 180, 365, 730, 1095, 1825, 3000, 20000].map((days) => {
    const [entry] = toEntries([{ ...base, name: "age", language: "Python", stargazers_count: 5, created_at: new Date(now - days * DAY).toISOString(), pushed_at: new Date(now - DAY).toISOString() }]);
    const spec = specFor(entry, W, H, F.paperInk, { now });
    return { days, level: spec.age, rings: shapeOf(spec).rings };
  });
  add("monotonic: more age never lowers the rings", ageRows.every((r, i) => i === 0 || r.rings >= ageRows[i - 1].rings), ageRows);
  add("bounded: the age saturates at five years", ageRows.filter((r) => r.days >= 1825).every((r) => r.rings === ageRows.find((x) => x.days === 1825).rings), ageRows.filter((r) => r.days >= 1825));
  const pushRows = [0, 1, 3, 7, 30, 90, 180, 365, 730, 1500, 20000].map((days) => {
    const [entry] = toEntries([{ ...base, name: "push", language: "Python", stargazers_count: 5, created_at: new Date(now - 3000 * DAY).toISOString(), pushed_at: new Date(now - days * DAY).toISOString() }]);
    const spec = specFor(entry, W, H, F.paperInk, { now });
    return { daysSincePush: days, level: spec.fresh, completion: Number(shapeOf(spec).completion.toFixed(3)) };
  });
  add("monotonic: a longer time since the push never raises the completion", pushRows.every((r, i) => i === 0 || r.completion <= pushRows[i - 1].completion), pushRows);
  add("bounded: the completion is within 40% and 100% and flat beyond two years", pushRows.every((r) => r.completion >= 0.4 && r.completion <= 1) && pushRows.filter((r) => r.daysSincePush >= 730).every((r) => r.completion === 0.4), pushRows.filter((r) => r.daysSincePush >= 730));

  // 5. The cache key.
  const [probe] = toEntries([{ ...young, name: "key", language: "Python", stargazers_count: 10 }]);
  const key = (e, o = {}, w = W, ink = F.paperInk) => jobKey({ kind: "figure", ...specFor(e, w, H, ink, { now, ...o }) });
  const k0 = key(probe);
  const changed = {
    stars: key({ ...probe, stargazers_count: 100 }) !== k0,
    age: key({ ...probe, created_at: "2019-02-01T00:00:00Z" }) !== k0,
    push: key({ ...probe, pushed_at: "2025-01-01T00:00:00Z" }) !== k0,
    unit: key(probe, { unit: 3 }) !== k0, // the default at 600 px is 2, so 2 would rightly leave the key alone
    ink: key(probe, {}, W, F.deepInk) !== k0,
    size: key(probe, {}, 300) !== k0,
  };
  const same = {
    "stars 1000 vs 100000 (saturated)": key({ ...probe, stargazers_count: 1000 }) === key({ ...probe, stargazers_count: 100000 }),
    "one more star inside a step": key({ ...probe, stargazers_count: 400 }) === key({ ...probe, stargazers_count: 401 }),
  };
  add("cache key: stars, age, push, unit, ink and size each change it", Object.values(changed).every(Boolean), changed);
  add("cache key: an input that does not change the figure does not change the key", Object.values(same).every(Boolean), same);
  add("cache key: ART_VERSION is 5", ART_VERSION === 5, { ART_VERSION });

  // 6. Placeholders are plainly sparser than any real figure.
  const phs = F.placeholders.map((e) => { const s = specFor(e, W, H, F.paperInk, { now }); return { dots: figureGeometry(s).dots.length / 2, ink: ink(s) }; });
  const floor = [];
  for (const [family, language] of [...families, ["unknown", "Brainfuck"], ["none", null]]) {
    const [entry] = toEntries([{ ...young, name: `floor-${family}`, language, stargazers_count: 0, created_at: new Date(now - 20 * DAY).toISOString() }]);
    const s = specFor(entry, W, H, F.paperInk, { now });
    floor.push({ family, dots: figureGeometry(s).dots.length / 2, ink: ink(s) });
  }
  add("placeholder: fewer points than any real 0-star figure", Math.max(...phs.map((p) => p.dots)) < Math.min(...floor.map((f) => f.dots)), { placeholderDots: phs.map((p) => p.dots), realZeroStarDots: floor.map((f) => f.dots) });
  add("placeholder: less ink than any real 0-star figure", Math.max(...phs.map((p) => p.ink)) < Math.min(...floor.map((f) => f.ink)), { placeholderInk: phs.map((p) => p.ink), realZeroStarInk: floor.map((f) => f.ink) });

  return { checks, table };
});

await browser.close();
await server.close();
const failed = result.checks.filter((c) => !c.pass);
const report = {
  tool: "figure-check",
  status: failed.length || errors.length ? "FAIL" : "PASS",
  page_errors: errors,
  passed: result.checks.length - failed.length,
  failed: failed.length,
  checks: result.checks,
  stars_ladder: result.table,
  interpretation_boundary: "Runs src/figure.ts in headless Chromium's 2D canvas. Pixel identity holds within one browser build; engines may differ in the last bit of Math.sin and Math.cos, which does not matter for a cache that stores drawn pixels.",
};
writeFileSync(out, JSON.stringify(report, null, 2));
for (const c of result.checks) console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name}`);
console.log(`\n${report.status}: ${report.passed} passed, ${report.failed} failed, ${errors.length} page errors -> ${out}`);
process.exitCode = report.status === "PASS" ? 0 : 1;
