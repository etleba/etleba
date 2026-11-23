#!/usr/bin/env node
/**
 * Renders recipe/studies/figure-sheet.html (the real src/figure.ts, through Vite's dev server)
 * to a PNG: the stress set, the placeholders, the stars ramp and the inverse sticker.
 * Usage: node scripts/figure-sheet.mjs [--out recipe/studies/figure-sheet.png] [--selector '#ramps'] [--scale 2]
 * Expects a Playwright install reachable through NODE_PATH or node_modules.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createServer } from "vite";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const args = process.argv.slice(2);
const out = path.resolve(args.includes("--out") ? args[args.indexOf("--out") + 1] : path.join(root, "recipe", "studies", "figure-sheet.png"));

const server = await createServer({ root, logLevel: "error", server: { host: "127.0.0.1", port: 0 } });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch();
const selector = args.includes("--selector") ? args[args.indexOf("--selector") + 1] : null;
const scale = args.includes("--scale") ? Number(args[args.indexOf("--scale") + 1]) : 1;
const page = await browser.newPage({ viewport: { width: 1648, height: 1000 }, deviceScaleFactor: scale });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(`${base}recipe/studies/figure-sheet.html`, { waitUntil: "load" });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
if (selector) await page.locator(selector).first().screenshot({ path: out });
else await page.screenshot({ path: out, fullPage: true });
await browser.close();
await server.close();
if (errors.length) console.error(errors.join("\n"));
console.log("wrote", out);
