# Ethan Lee Barrett, public work

The site at [ethanleebarrett.com](https://ethanleebarrett.com/) shows every public repository as a 3.5" floppy disk in a box. Flip through the box, take a disk out, and put it in the drive to read its README.

The look is Zufall Stochastic Editorial: warm paper, ink type and black disks in an ink box:
- every project is drawn as a generated figure, a point study, a branch or a distribution, chosen by its language and shaped by its stars, age and last push;
- each disk's label is a paper sticker with its figure, name and code, and one disk in five is inverse;
- everything readable is set in Inter, ink on warm paper, with square corners and one-pixel rules;
- the index is the one inverse chapter, off-white on deep grey;
- beside the box stands the reader, a floating screen with a drive slot. It sits on dark standby, showing the box as points, and wakes when a disk goes in, its light falling on the box;
- the box is one size, thick-walled charcoal board. A disk is drawn up out of it as if gripped, carried over to your hand, and lives there with a slow roll and breath. In the drive it meets the slot, clicks into the latch, and is drawn in slowly while the screen's glass warms; the README wakes when it is seated. The camera sways slightly and the reader floats.

A quick boot screen draws the first view off the main thread and caches it for next time. Sound, synthesised in the browser, is on by default and starts with your first click or key.

The site is built for desktop browsers. Below 1024 px wide, or on a touch device with no hover (phones and tablets), it shows a short notice asking for the desktop site and never loads the 3D app.

The reader, the box and the motion polish are recorded in [`recipe/direction-v6.md`](recipe/direction-v6.md); the type, paper and figures in [`recipe/direction-v5.md`](recipe/direction-v5.md). The disks, the boot and the polish are in [`recipe/direction-v4.md`](recipe/direction-v4.md), and [`recipe/direction-v3.md`](recipe/direction-v3.md) is kept as the earlier look. The plain baseline it was built from is in [`recipe/baseline.md`](recipe/baseline.md). The earlier "Heat Sheet" language is in [`recipe/direction-v2.md`](recipe/direction-v2.md), with its code set aside in [`parked/`](parked/).

## Run

```sh
npx -y pnpm@10.28.0 install --frozen-lockfile
npx -y pnpm@10.28.0 dev
```

pnpm runs through `npx` because Node 25 and later no longer ship corepack. If pnpm 10.28.0 is installed globally, plain `pnpm` works the same.

- `pnpm build` type-checks and builds to `dist/`.
- `pnpm data` refreshes `public/data/repos.json` from the GitHub API. It uses `GITHUB_TOKEN` when set and keeps the committed snapshot on any failure.

## How the catalogue is built

- **No manual updates.** The committed snapshot paints first. The browser then reads every page of public repositories for `etleba` from the GitHub API, caches the result for an hour, and replaces the snapshot. The weekly deploy also refreshes the snapshot. A repository appears in the box as soon as it is public. Forks and the profile repositories (`.github`, `etleba`) are excluded. While there is no public work, the box holds six unnamed "In progress" disks with no link and no README; the first public repository replaces them.
- **Numbers.** The caption, the sheet and the index number disks by position in the current order. The default order is the order in which the work was started.
- **Figures and labels.** Each project's figure is drawn by `src/figure.ts`: its language picks the family, its name seeds the form, and its stars, age and last push set the extent. Its label is set by `src/labels.ts`. The same project always gets the same figure and label, and there is no artwork to maintain.
- **Drawing off the main thread.** Figures are drawn by a small pool of workers (`src/art/`), and each drawing is kept in Cache Storage, so a second visit decodes instead of drawing. The service worker (`public/sw.js`) keeps the app and the snapshot for offline visits.
- **READMEs.** A README is fetched from `raw.githubusercontent.com` when a disk goes into the drive (or earlier: the settled disk's and its neighbours' are prefetched while the page is idle). It is rendered with `marked` and sanitised with DOMPurify, with repository-relative links and images resolved to GitHub.

## Controls

**Keyboard**
- The arrow keys flip through the box. Page Up and Page Down jump five; Home and End go to the first or last disk.
- Type the start of a name to jump to it.
- Enter takes the disk out of the box; Enter again puts it in the reader. Esc ejects it, and Esc again puts it back in the box. `F` turns the disk in your hand over.
- While a disk is read, the up and down arrows, Page Up and Page Down, Space (Shift+Space goes back), Home and End scroll the README on the screen. The left and right arrows still flip through the box.

**Pointer**
- The wheel, a sideways drag, or a drag down towards you flips through the box. While a disk is read, the wheel scrolls the README instead.
- Hovering a disk in the box lifts it and names it; clicking it takes it out.
- Drag the disk that is out to turn it in your hand, or flick it to spin it. Face down, its write-protect tab clicks.
- Clicking the disk that is out puts it in the reader.

**Index**
- Index in the header (or the `I` key) opens the full-screen list of figures, which is the same list as the box.
- Type to find a project, choose an order, or pick a row.
- Previous and Next in the right-hand column name the neighbouring projects.

**Other**
- "Motion" in the header reduces motion. The system preference is honoured by default.
- "Sound" turns the synthesised sounds off and on. They are on by default; browsers hold them until your first click or key, and turning them off is remembered.
- Links: `#/name` opens on a disk and `#/name/readme` opens its README. The address follows the disk you are on.

## Review

These need Playwright reachable through `NODE_PATH` or `node_modules`.

- `node scripts/review.mjs` serves `dist/` and captures representative states. External reads are fetched through `curl` so that READMEs load in containers with an HTTP proxy.
- `node scripts/contact-sheet.mjs` composes the frames into `recipe/evidence/contact-sheet.jpg`.
- `node scripts/measure-layout.mjs <out.json>` records the settled view's chrome boxes for `infer_alignment_axes.py`.
- `node --experimental-strip-types scripts/simulate-gates.ts` runs the stage's own springs and gates through interruption scenarios and checks clearance, exclusivity and order in the box.

Query parameters for review and weak devices:

| Parameter | Effect |
|---|---|
| `?stress=60` | Synthetic catalogue |
| `?renderer=flat` | No-WebGL fallback |
| `?quality=low` | Low quality tier |
| `?review=1` | Exposes `window.__rack.snap()`, plus `freeze()` and `step(ms)`, a fixed-step clock for sampling motion, and `flip()`; skips the boot screen's minimum |
| `?review=1&look.<name>=<value>` | Review-only look overrides used by the lookdev wedges (for example `look.screenOff=paper`, `look.float=6`, `look.sway=2`); ignored without `review=1` |
