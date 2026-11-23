# Direction v5: Zufall Stochastic Editorial

**Request:** "The old punk rock type look is unprofessional I think, so I need to change the overall look too this, however, all of the other stuff like the design and motion need to stay, it's purely the aesthetic view."

**Approval, after the direction was put to the user:** "Love the idea, yes lets do that, and yes keep the motion, flicker can go."

**Reading:** the object, the 3D mechanism, the springs, the interactions, the data and the caching stay as they were (`direction-v4.md`). Only the look changes. The look is now the brief's (`DESIGN.md`, also under `.agents/skills/zus/`): a warm paper page, ink type in one family, black disks in an ink box, and generated figures in place of the drawn logos and photocopied photographs. The flicker and its hiss are gone, as the user said.

## Frame

- **Editorial Field.** The stage is warm paper (`#F2F1ED`) with near-black ink (`#111111`) on it. The chrome is flat: square corners, one-pixel rules, no shadows and no glow. The disks and the box are the objects on the paper.
- **One Inverse Chapter.** The index is the only view on the deep field (`#1A1A1A`), with off-white type. Everything else is paper. The open sheet is paper too, so the reader moves paper, then the deep field, then paper again.
- **One stochastic event per view.** In any view the only generated thing is a figure: on the disk labels, on the sheet, and as thumbnails in the index.
- **Grid.** Twelve columns on wide screens and four on narrow ones, with a margin of `clamp(16px, 2.25vw, 32px)` and a gutter of `clamp(16px, 1.7vw, 24px)`. The layout is as in v3 and v4: the title across the top, the disk under it, the box at the foot, the caption on columns 1 to 4 and the neighbours on 10 to 12.

## Tokens

The stylesheet (`src/styles.css`) is the one source. `src/tokens.ts` reads the values once from the page so the canvas labels and the 3D scene use the same ones; its fallbacks are the brief's values. The contrast check (`evidence/contrast-v5.result.json`) uses the same set.

| Token | Value | Use |
|---|---|---|
| `--surface-page` | `#F2F1ED` | Page, sheet, labels |
| `--surface-emphasis` | `#1A1A1A` | Index, README code blocks, tooltip, drive bezel, inverse sticker |
| `--text-primary` | `#111111` | Ink: type, figures, strong rules, the box |
| `--text-secondary` | `#555555` | Captions, the code line, control borders |
| `--text-inverse` | `#F2F1ED` | Type and figures on the deep field |
| `--text-inverse-secondary` | `#B4B3AD` | Annotations and control borders on the deep field |
| `--border-quiet` | `#C9C8C2` | Decorative separators on paper (not a control boundary) |
| `--border-quiet-inverse` | `#4A4944` | Separators between index rows |
| `--focus-ring` | `#005E73` | Focus on paper |
| `--focus-ring-inverse` | `#F2F1ED` | Focus on the deep field |
| `--status-error` | `#8A2D24` | The README error message, with a cross symbol |
| `--status-success` | `#2E6540` | Defined, not used by any view yet |
| `--status-warning` | `#D6C846` | Defined, not used by any view yet |

Role aliases (`--border-strong`, `--border-control`, `--border-control-inverse`) let a component name what it is and not which hex it is. `--radius-default` is `0px`: every control, rule and plate has square corners. The exceptions are the small round marks, which are dots by design: the index's current-row marker, the boot's points and the drive light.

## Type

Inter is the only family: self-hosted from `@fontsource-variable/inter` 5.3.0 (OFL-1.1), loaded by `src/main.ts` from `wght.css`, with Arial and Helvetica as the fallback. The stack for code inside READMEs is the system mono stack (`--font-mono`), used for nothing else. `src/fonts.ts` makes the canvas wait for weights 500 and 700 before it draws any label text, because canvas text does not wait for a webfont the way the page does.

| Role | Size (wide / narrow) | Where | Weight and setting |
|---|---|---|---|
| Display | 64 / 44 px | The project title | 700, line 0.95, tracking -0.025em |
| Chapter | 48 / 36 px | "Index" heading | 700, line 1, tracking -0.03em |
| Heading | 28 / 24 px | The sheet's title, README `h1` | 650, tracking -0.02em |
| Sub | 20 / 18 px | The caption's title, README `h2` | 600, tracking -0.01em |
| Body | 16 px | Text, README, buttons | 400, line 1.5 |
| Caption | 12 px | Bar, facts, figure captions, tooltip | 500 (tooltip 600), line 1.3 to 1.35 |
| Micro | 11 / 12 px | The code line over the title, the drive badge | 500, tracking 0.04em (badge 0.08em) |

The bar's name is body size at 700. Numbers that line up use tabular figures. The title never goes below a 36 px chapter size: it starts at the display size and steps down by 2 px only if a long name would not fit in two lines.

## Figures

`src/figure.ts` draws every repository as one deterministic generative figure, ink on a transparent ground (off-white for the inverse sticker and the index).

**The language picks the family.** A table maps languages to three families, after the brief's motifs:

| Family | Reads as | Languages in the table |
|---|---|---|
| Radial | A radial point study: points on concentric rings, denser to one side | Python, Jupyter Notebook, R, Julia, Lua, Ruby, PHP, Perl, MATLAB, Elixir |
| Branch | An iterative branch: a tiered stem whose laterals fork | TypeScript, Rust, Go, C, C++, C#, Java, Kotlin, Swift, HTML, XML, Haskell, Scala, Dart, Zig |
| Curve | A probability distribution rising from a baseline, with dots sampled under it | Shell, PowerShell, Batchfile, JavaScript, CSS, SCSS, Makefile, Dockerfile, Nix, Markdown, TeX |

A language not in the table, or none, takes a family by hash, so it is still stable.

**The repository's data shapes the form.** Three measures go through one monotonic, bounded mapping (logarithmic, clamped, then quantised to a few steps):

- **Stars** give a star level of 0 to 24: `log2(1 + stars) / 9`, clamped, so it saturates at 511 stars.
- **Age** (time since creation) gives an age level of 0 to 6: `log2(1 + months) / log2(61)`, so it saturates at five years.
- **Push recency** gives a fresh level of 0 to 12: one minus `log2(1 + days since push) / log2(731)`. Pushed today is 12; two years ago or more is 0.

What each one drives, per family (`s` is the star level over 24 and `f` the fresh level over 12):

| | Stars | Age | Push recency |
|---|---|---|---|
| Radial | Points: 144 + 280 s | Rings: 2 + age | Arc swept: 40% + 60% f of the circle |
| Curve | Dots: 144 + 280 s | Tiers (contour rules): 2 + age | Distribution drawn to 40% + 60% f of its width, cut off by a rule down to the baseline |
| Branch | Depth: 5 + round(3 s) | Tiers on the stem: 3 + age | Share of tips that carry a point: 30% + 70% f |

A repository with no stars, which is nearly all of them, therefore draws 144 points or a branch of depth 5, a whole figure and not an empty one. A thousand stars draw the same as 511.

**The name seeds the variation.** Positions, angles, the centre of the circle, the number and spread of the distribution's components, the lean and reach of the branch: all come from a stream seeded by the repository's name, so no two repositories draw alike. Points are drawn in the order the stream produces them, so more stars add points without moving the ones already there. A deeper branch keeps the nodes a shallower one had.

**Deterministic and bounded.** The same entry always draws the same pixels. Point size and rule weight are one fixed unit for the whole figure (about one pixel at label size, the device-pixel ratio when shown at its own size). There is no blur and no text, so the figure draws in a worker. The mapping steps mean one more star does not redraw a cached figure unless it crosses a step.

**Placeholders.** An "In progress" disk draws no family: 12 to 18 scattered points and a dotted baseline, with no rings, no sampling and no resolved form. It is plainly sparser than any real figure, including a 0-star one.

**Where it is drawn and cached.** The spec (family, size, ink, the three levels, the placeholder flag, the unit and the name) is the whole input, and also the cache key (`src/art/jobs.ts`). The art pool's workers (`src/art/`) draw figures off the main thread in priority order and keep each in Cache Storage as lossless WebP (one-pixel rules must not soften), so a second visit decodes instead of drawing. Where workers or OffscreenCanvas are missing, the same generator runs on the main thread. **`ART_VERSION` goes from 4 to 5**, so the v4 logos and photographs in older caches are discarded when the worker starts.

## Where the figure and type go

- **Title** (`src/ui/title.ts`, `src/ui/hero.ts`). The project name in Inter display, left on the grid under the bar, over a micro code line ("No. 04 · Python · 2026"; the year is the year of the last push). It replaces the drawn logo and keeps its place and its reveal: it opens from its centre line outward in 420 ms when the box settles, and goes when the box moves. The box it must fit is 70% of the field's width and 26% of its height (22% on narrow screens).
- **Disk label** (`src/labels.ts`). A paper sticker typeset like a figure plate: a hard-cropped field holding the figure in the top half, one rule, the name in Inter bold (two lines at most, shrinking from 8.5% to 5.5% of the label's width), and a foot line with "Ethan Lee Barrett" at the left and the code and year at the right. **One disk in five is inverse**: off-white figure and type on the deep field. It uses the same seed as the v4 black stickers, so the same disks keep their turn. The no-WebGL flat disk and the boot use the same label.
- **Booklet head** (`src/ui/booklet.ts`). The sheet opens with the figure in a plate between a strong rule and a quiet one (120 to 190 px high, 96 to 150 on narrow screens), under it a caption that says what the figure encodes, in the form "Fig. NN. Radial point study: N points (N stars), N rings (started YYYY), the circle N% swept (last push D Mon YYYY)." Each number there is the fact that set it. Then the name in heading size, a row of four facts (language, updated, started, stars), the description and the README.
- **Coded Index** (`src/ui/index-list.ts`). The one Inverse Chapter. Each row is a number, a 96 by 52 figure, the name, a dotted leader, then the language and year. The current row is shown by local inversion (paper ground, ink type, a filled dot, bold, and the figure inverted by CSS) as well as `aria-selected`. Figures are drawn as rows scroll into view, nearest the current row first, and a row redraws if a refreshed catalogue moves its measures to another step. On narrow screens the leader gives way and the row is number, figure, then name over language and year.
- **Boot, Stochastic Progress** (`src/ui/boot.ts`). The first paint is the paper, the bar's name, and the title of the project the page will open on, with a field of one point for each disk. Each point sits off the axis by a seeded offset (up to 11 px either way), hollow until its disk is written and then filled. The status line reads "Reading the box", "Writing <name>" and "Ready", beside a "00 / 10" count. The title then travels to the page's own title in 620 ms, unscaled, because it was set at that size. The 900 ms minimum, the skip and the cache warm-up are as in v4.

## 3D scene

Changed (`src/stage.ts`, `src/floppy.ts`) so the disks sit on paper and not on a black field:
- **Key light:** neutral white (was a cold blue-white), from the same high left position, 2.8 as before.
- **Rim light:** white, 1.2 (was 1.5), and lower behind the disks (height 2.4, was 5), so it draws their edges against the paper.
- **Fill:** a hemisphere light in the page's own colour at 1.0, with the ground colour at 55% of it, because the room around the box is paper (was a faint grey-blue at 0.35 over black).
- **Box spot:** white (was a cold white), as before in position and strength.
- **Fog:** the page colour from the token (was black), so far disks fade into the paper. Three.js applies fog after tone mapping, so the colour lands on the page exactly (`studies/fog-check.html`).
- **Materials:** the box is flat matte ink from the token (was glossy black with a clearcoat), with no reflection. The label's paper is rougher and takes less of the environment (roughness 0.95, was 0.82; environment 0.12, was 0.3). The disk's plastic, steel and media are unchanged.

Unchanged: the disk's geometry, the box's geometry, the springs and their stiffnesses, the gates, the camera and its near plane, the composition proportions, the renderer's tone mapping.

## Chrome

- **Hover:** a link's one-pixel underline appears (transparent to ink); a flat button's border goes from the control grey to ink; an index row's leader goes solid and its name is underlined.
- **Focus:** a 2 px outline in `#005E73` with a 2 px offset, on every focusable element. In the index, on the deep field, it is the off-white inverse ring, because the teal would not pass there (2.36:1).
- **Pressed:** local inversion. The button fills with ink and its text goes to paper, border included; it is not a shadow or a movement. The caption's Open button and the sheet's Close button do this.
- **Selected:** in the index, the current row is the local inversion described above; a selected order button is bold with a solid rule.
- **CSS motion tokens:** `--motion-fast` 120 ms, `--motion-state` 180 ms, `--motion-reveal` 260 ms, `--motion-chapter` 420 ms, with one easing, `cubic-bezier(0.2, 0, 0, 1)`. The sheet slides in at the reveal duration, the index and caption fade at the state duration, the title opens at the chapter duration.
- **Reduced motion:** every CSS animation and transition is cut to 0.001 ms, as before. There is no flicker to turn off.
- **No glow:** the drive light is a dot that blinks (steps, not a fade) and the tooltip is a flat ink label.

## Removals

- `src/logo.ts`, the black metal logo generator. Its studies (`studies/logo-sheet.*`, `studies/metal-sheet.html`, `studies/type-metal.png`) stay as history.
- `src/xerox.ts`, the photocopied night photographs and the toner and grain passes.
- `src/ui/flicker.ts`, the page flicker, and `hiss()` in `src/sound.ts`, the static that went with it. The other synthesised sounds are as they were.
- The stage's pool of light on the floor under the box.
- The photocopy noise (the toner dust over the open sheet), and the sheet's white-on-black styling.
- Helvetica as the face, in favour of Inter.

`parked/` (the Heat Sheet code) is left as history, as in v4. `direction-v3.md` and `direction-v4.md` are kept as the record of the earlier look and carry a note pointing here.

## Deliberate exceptions to the brief

- **The springs stay.** The brief prefers non-spring, restrained motion. The user asked to keep the motion ("yes keep the motion"), so the 3D mechanism's springs and gates are unchanged, and `styles.css` records them as the one exception. The CSS chrome follows the brief's motion tokens.
- **The title still opens from its centre line.** It is a reveal the page has always used, kept for the same reason.
- **The disks are black plastic and steel.** They are objects, not chrome, and the brief's "black disks" is the object. The 2D disk (no-WebGL box and boot) uses a near-black body and a steel shutter for the same reason.
- **Round marks.** The marker dot, the boot points and the drive light are round, against the square-corner rule.

## Validation

All of these are in `evidence/` unless noted. The review frames were not re-captured after the folder move.

| Check | Result | Evidence |
|---|---|---|
| Contrast, `studies/contrast-v5.py` | PASS: every text pair at 4.5:1 or more (lowest 6.09:1), every non-text pair at 3:1 or more (lowest 6.52:1). Quiet rules and construction rings are decorative and exempt | [contrast-v5.result.json](evidence/contrast-v5.result.json) |
| Figure check, `scripts/figure-check.mjs` | PASS: 24 passed, 0 failed, no page errors. Covers determinism, the monotonic and bounded mapping of stars, age and push recency for all three families, prefix stability, the cache key, `ART_VERSION` of 5, and placeholder sparseness | [figure-check-v5.result.json](evidence/figure-check-v5.result.json) |
| Gate simulation, `scripts/simulate-gates.ts` | PASS: all three interruption scenarios; minimum clearance while turning 2.1 mm | [gate-simulation-v5.result.json](evidence/gate-simulation-v5.result.json) |
| Review frames | 98 frames over 21 scenes: boot, settled, inspect, shadows, sixty disks, empty, index, filter, insert and close sequences, reflow, phone, reduced motion, flat renderer. The log records no errors: only the Playwright service worker warning (7) and a SwiftShader GL driver message (4). The log lists 106 entries; 98 frames are on disk | [review-v5/](evidence/review-v5/), [review-log.json](evidence/review-v5/review-log.json), [contact-sheet-desktop.jpg](evidence/contact-sheet-desktop.jpg), [contact-sheet-phone.jpg](evidence/contact-sheet-phone.jpg) |
| Figure study | Sixty repositories, the placeholders, the 0-star floor per family, the stars ramp (0 to 500) and the inverse sticker | [figure-sheet.png](studies/figure-sheet.png) |

After the folder move, the install was repaired and the build and the three checks above were re-run on 2026-11-23 with Node v26.13.1. `pnpm build` passed, with only the expected warning for the three.js chunk (574 kB), and `simulate-gates.ts`, `figure-check.mjs` (24 passed, 0 failed) and `contrast-v5.py` (29 passed, 0 failed, 6 informational or exempt) all passed.

## Limits

- **No real GPU.** The review frames were rendered in headless Chromium with SwiftShader. Lighting, tone and frame timing on real hardware are not checked.
- **Figures change as the repository does.** Stars, age and push recency are the inputs, so a repository's figure moves when it crosses a step, and every figure ages. That is the point of them, but a screenshot of the box is a picture of one day.
- **Returning visitors may see cached figures for up to an hour.** The catalogue is cached for an hour, and the figures are cached by their measures, so a push is not drawn until the catalogue refreshes.
- Not run: real phones, assistive-technology sessions, and a person's review of the figures at label size.
