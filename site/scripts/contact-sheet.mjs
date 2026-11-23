#!/usr/bin/env node
/**
 * Composes the review frames into contact sheets (JPEG) for the recipe record: one for 1440 by 900
 * and one for 390 by 844.
 * Usage: node scripts/contact-sheet.mjs [--dir recipe/evidence/review-v5] [--out recipe/evidence]
 * Expects a Playwright install reachable through NODE_PATH or node_modules.
 */
import path from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const dir = path.resolve(opt("--dir", path.join(here, "..", "recipe", "evidence", "review")));
const outDir = path.resolve(opt("--out", path.join(here, "..", "recipe", "evidence")));

// [scene, shot, caption]
const desktop = [
  ["desktop-boot", "first-paint", "Boot, first paint: the name, the empty point field, \"Reading the box\""],
  ["desktop-boot", "writing", "Boot: the title up, the points filling as disks are written"],
  ["desktop-empty", "settled", "Empty catalogue: six \"In progress\" disks with sparse, unresolved figures"],
  ["desktop-empty", "open", "Empty catalogue: the sheet of an unnamed disk"],
  ["desktop-empty", "index", "Empty catalogue: the Coded Index"],
  ["desktop-stress60", "settled", "Sixty disks, settled: title, disk out of the box, the box at the foot"],
  ["desktop-stress60", "wheel-turning", "Sixty disks, flipping: the ones passed lean towards you"],
  ["desktop-stress60", "open-readme", "A README open on the paper sheet, the disk in the drive"],
  ["desktop-stress60", "index", "The index: the one Inverse Chapter; the current row inverted, with a filled dot"],
  ["desktop-shadows", "settled-high", "High quality (shadows): the empty box settled"],
  ["desktop-inspect", "back", "Turned over: the hub and the write-protect tab"],
  ["sequence-insert", "in-read", "In the drive: the light on, the README read off the disk"],
  ["reduced-motion", "rest", "Reduced motion: the final state at once"],
  ["reduced-motion", "open", "Reduced motion: the sheet at once"],
  ["flat-renderer", "rest", "No WebGL: flat disks under the title"],
  ["flat-renderer", "open", "No WebGL: the sheet"],
  ["recon-gray", "settled", "Reconstruction test: grayscale, settled"],
  ["recon-gray", "index", "Reconstruction test: grayscale, index"],
  ["recon-noimages", "settled", "Reconstruction test: no images; type, rules and surfaces only"],
  ["recon-noimages", "open", "Reconstruction test: no images, the sheet"],
];
const phone = [
  ["phone-boot", "writing", "Boot"],
  ["phone-stress60", "settled", "Settled"],
  ["phone-stress60", "open-readme", "README open"],
  ["phone-stress60", "index", "Index, linear"],
  ["phone-empty", "settled", "Empty catalogue"],
  ["phone-empty", "index", "Empty, index"],
  ["phone-reduced-motion", "open", "Reduced motion, open"],
  ["phone-flat-renderer", "rest", "No WebGL"],
];

const files = await readdir(dir);
const find = (scene, shot) => files.find((f) => f.startsWith(`${scene}-`) && f.endsWith(`-${shot}.png`));

async function sheet(browser, name, frames, cols, width, title) {
  const items = [];
  for (const [scene, shot, label] of frames) {
    const file = find(scene, shot);
    if (!file) continue;
    // Embedded as data URIs: a page made with setContent cannot read file:// images.
    items.push({ file, label, src: `data:image/png;base64,${(await readFile(path.join(dir, file))).toString("base64")}` });
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#F2F1ED;font-family:Arial,sans-serif;color:#111;padding:24px;width:${width}px;box-sizing:border-box}
h1{font:700 18px Arial,sans-serif;margin:0 0 16px}
.g{display:grid;grid-template-columns:repeat(${cols},1fr);gap:18px}
figure{margin:0}img{width:100%;display:block;border:1px solid #111}
figcaption{font-size:12px;margin-top:6px;color:#555}
</style></head><body><h1>${title}, ${new Date().toISOString().slice(0, 10)}, headless Chromium with SwiftShader (not a representative GPU)</h1><div class="g">
${items.map((x) => `<figure><img src="${x.src}"><figcaption>${x.label}<br>${x.file}</figcaption></figure>`).join("\n")}
</div></body></html>`;
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  await page.setContent(html, { waitUntil: "load" });
  await page.waitForTimeout(500);
  const out = path.join(outDir, name);
  await page.screenshot({ path: out, fullPage: true, type: "jpeg", quality: 82 });
  await page.close();
  console.log("wrote", out, items.length, "frames");
}

const browser = await chromium.launch();
await sheet(browser, "contact-sheet-desktop.jpg", desktop, 3, 1700, "Review frames, 1440 by 900");
await sheet(browser, "contact-sheet-phone.jpg", phone, 4, 1700, "Review frames, 390 by 844");
await browser.close();
