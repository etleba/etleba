import { dateLine, pad2, position, type Entry } from "../catalogue";
import { figureArt } from "../art";
import { type FigureSpec, shapeOf, specFor } from "../figure";
import { readmeHtml } from "../readme";
import type { State, Store } from "../state";
import { tokens } from "../tokens";

/**
 * The sheet (recipe/direction-v4.md, drive; recipe/direction-v5.md, figures): the open disk's
 * contents, a paper sheet with a drive down its left edge. The disk goes into the drive's slot;
 * the light blinks while it reads; the README comes up block by block once both the disk is in
 * and the text has arrived. The disk's figure heads the sheet in a hard-cropped plate, with a
 * caption that says what it encodes; the name in Inter sits under it, then a row of facts, the
 * description and the README. Focus moves to Close and returns on close. Without WebGL, on
 * narrow screens and under reduced motion there is no disk to wait for.
 */

/** What the figure shows and which fact sets each part of it, in a sentence. */
export function figureCaption(entry: Entry, index: number, total: number, spec: FigureSpec): string {
  const fig = `Fig. ${pad2(index + 1, total)}.`;
  if (entry.placeholder) return `${fig} Unresolved field: nothing has accumulated yet.`;
  const s = shapeOf(spec);
  const pct = Math.round(s.completion * 100);
  const stars = `${entry.stargazers_count} ${entry.stargazers_count === 1 ? "star" : "stars"}`;
  const started = `started ${entry.born}`;
  const pushed = `last push ${dateLine(entry.pushed_at || entry.created_at)}`;
  switch (s.family) {
    case "radial":
      return `${fig} ${s.name}: ${s.points} points (${stars}), ${s.rings} rings (${started}), the circle ${pct}% swept (${pushed}).`;
    case "curve":
      return `${fig} ${s.name}: ${s.points} points (${stars}), ${s.rings} tiers (${started}), drawn to ${pct}% of its width (${pushed}).`;
    default:
      return `${fig} ${s.name}: depth ${s.depth} (${stars}), ${s.rings} tiers (${started}), ${pct}% of the tips set (${pushed}).`;
  }
}

export function mountBooklet(root: HTMLElement, store: Store): void {
  const sheet = root.querySelector<HTMLElement>("[data-booklet-sheet]")!;
  const no = root.querySelector<HTMLElement>("[data-booklet-no]")!;
  const title = root.querySelector<HTMLElement>("[data-booklet-title]")!;
  const desc = root.querySelector<HTMLElement>("[data-booklet-desc]")!;
  const meta = root.querySelector<HTMLElement>("[data-booklet-meta]")!;
  const link = root.querySelector<HTMLAnchorElement>("[data-booklet-link]")!;
  const close = root.querySelector<HTMLButtonElement>("[data-booklet-close]")!;
  const body = root.querySelector<HTMLElement>("[data-booklet-body]")!;
  const plate = root.querySelector<HTMLElement>("[data-booklet-figure]")!;
  const caption = root.querySelector<HTMLElement>("[data-booklet-caption]")!;
  let returnFocus: HTMLElement | null = null;
  let token = 0;
  let leaving = 0;

  close.addEventListener("click", () => store.close());
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      store.close();
    }
  });

  /** Resolves when the disk is in the drive, or at once when there is no disk to wait for. */
  function inserted(state: State): Promise<void> {
    const wait = state.renderer === "webgl" && state.motion === "full" && matchMedia("(min-width: 1024px)").matches;
    if (!wait || document.body.dataset.drive === "reading") return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        window.removeEventListener("drive", on);
        clearTimeout(timer);
        resolve();
      };
      const on = (e: Event) => {
        if ((e as CustomEvent).detail === "reading") done();
      };
      window.addEventListener("drive", on);
      // Never hold the text hostage to the animation.
      const timer = window.setTimeout(done, 1600);
    });
  }

  async function load(state: State): Promise<void> {
    const entry = state.current >= 0 ? state.visible[state.current] : null;
    if (!entry) return;
    const mine = ++token;
    if (entry.placeholder) {
      body.innerHTML = `<p class="spread__state">This disk is still being written. It goes in the box when it is public.</p>`;
      store.setReadme(entry.name, "missing");
      return;
    }
    body.innerHTML = `<p class="spread__state" data-reading>Reading the disk</p>`;
    store.setReadme(entry.name, "loading");
    let html: string | null;
    try {
      [html] = await Promise.all([readmeHtml(entry), inserted(state)]);
    } catch {
      if (mine !== token) return;
      body.innerHTML = `<p class="spread__state spread__state--error"><span aria-hidden="true">× </span>The README could not be loaded. <a href="${entry.html_url}#readme" target="_blank" rel="noopener">Read it on GitHub</a>.</p>`;
      store.setReadme(entry.name, "error");
      return;
    }
    if (mine !== token) return; // a newer open superseded this one
    if (html === null) {
      body.innerHTML = `<p class="spread__state spread__state--error"><span aria-hidden="true">× </span>This disk has no README on GitHub yet. <a href="${entry.html_url}" target="_blank" rel="noopener">Open the repository</a> to see its files.</p>`;
      store.setReadme(entry.name, "missing");
      return;
    }
    body.innerHTML = `<article class="readme">${html}</article>`;
    // The first screen of blocks comes up in order, as if read off the disk.
    const blocks = body.querySelectorAll<HTMLElement>(".readme > *");
    blocks.forEach((b, i) => {
      if (i < 24) b.style.setProperty("--i", String(i));
    });
    body.dataset.read = "in";
    store.setReadme(entry.name, "ready");
  }

  function fact(label: string, value: string): string {
    return `<div><dt>${label}</dt><dd>${value}</dd></div>`;
  }

  function show(state: State): void {
    const entry = state.current >= 0 ? state.visible[state.current] : null;
    if (!entry) return;
    clearTimeout(leaving);
    no.textContent = position(state.current, state.visible.length);
    title.textContent = entry.title;
    desc.textContent = entry.description?.trim() || "No description on GitHub yet.";
    meta.innerHTML = entry.placeholder
      ? fact("Status", "In progress")
      : [
          fact("Language", entry.language ?? "None"),
          fact("Updated", dateLine(entry.pushed_at || entry.created_at)),
          fact("Started", dateLine(entry.created_at)),
          fact("Stars", String(entry.stargazers_count)),
        ].join("");
    link.href = entry.html_url;
    link.closest("p")!.hidden = Boolean(entry.placeholder);
    if (root.hidden) returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    root.hidden = false;
    // The figure is sized to the plate, so it is drawn once the sheet is showing.
    const dpr = Math.min(2, devicePixelRatio || 1);
    const rect = plate.getBoundingClientRect();
    const boxW = Math.max(200, rect.width);
    const boxH = Math.max(96, rect.height);
    const forName = entry.name;
    const spec = specFor(entry, boxW * dpr, boxH * dpr, tokens().ink, { unit: dpr });
    plate.replaceChildren();
    caption.textContent = figureCaption(entry, state.current, state.visible.length, spec);
    void figureArt(spec, 0).then((pic) => {
      if (store.current?.name !== forName) return;
      const c = document.createElement("canvas");
      c.width = pic.width;
      c.height = pic.height;
      c.setAttribute("aria-hidden", "true");
      c.getContext("2d")!.drawImage(pic, 0, 0);
      plate.replaceChildren(c);
    });
    delete body.dataset.read;
    root.dataset.phase = "in";
    sheet.scrollTop = 0;
    void load(state);
    requestAnimationFrame(() => close.focus({ preventScroll: true }));
  }

  function hide(state: State): void {
    token++;
    const immediate = state.motion === "reduced";
    root.dataset.phase = "out";
    clearTimeout(leaving);
    // On wide screens the sheet waits for the disk to come out of its drive before it goes.
    const waits = state.renderer === "webgl" && matchMedia("(min-width: 1024px)").matches;
    leaving = window.setTimeout(() => (root.hidden = true), immediate ? 0 : waits ? 460 : 260);
    if (returnFocus && document.contains(returnFocus)) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  }

  store.on((state, previous) => {
    if (state.mode === "open" && previous.mode !== "open") show(state);
    else if (state.mode !== "open" && previous.mode === "open") hide(state);
    else if (state.mode === "open" && state.current !== previous.current) show(state);
  });
}
