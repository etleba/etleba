import type { Entry } from "../catalogue";
import { hashSeed } from "../random";
import { fillTitle, titleBox } from "./title";

/**
 * The boot screen (recipe/direction-v4.md, loading; recipe/direction-v5.md, progress). It is in
 * the HTML, so it is the first paint. While it shows, the page draws what the first view needs,
 * off the main thread where it can (src/art), uploads it to the GPU and compiles the shaders, so
 * nothing is drawn or compiled mid-gesture later. The current project's title comes up first, at
 * the size and place the page's own title will take. Below it is a Stochastic Progress field: a
 * labelled point for each disk, filled as the disk is written, beside the count and the status
 * line. At the end the title slides up into its place on the page and the box rises behind it.
 *
 * Any key, click or tap skips it; what was not finished carries on in the background.
 */
export interface Boot {
  /** Show the project the page will open on, and where it stands in the current order. */
  setCurrent(entry: Entry, index: number, total: number): void;
  progress(done: number, total: number, entry: Entry | null): void;
  /** Resolves when the visitor asks to skip. */
  skipped: Promise<void>;
  /** Run the exit. `onReveal` fires as the page starts to show. */
  finish(onReveal: () => void): Promise<void>;
}

export function mountBoot(stageEl: HTMLElement, opts: { minMs: number; reduced: boolean }): Boot {
  const root = document.querySelector<HTMLElement>("[data-boot-screen]")!;
  const titleSlot = root.querySelector<HTMLElement>("[data-boot-title]")!;
  const points = root.querySelector<HTMLElement>("[data-boot-points]")!;
  const msg = root.querySelector<HTMLElement>("[data-boot-msg]")!;
  const count = root.querySelector<HTMLElement>("[data-boot-count]")!;
  const started = performance.now();
  let finished = false;
  let skip: () => void = () => {};
  const skipped = new Promise<void>((resolve) => (skip = resolve));
  let titled = false;

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Tab") return;
    skip();
  };
  addEventListener("keydown", onKey);
  root.addEventListener("pointerdown", () => skip());

  /** One point per disk, scattered a little off the axis by a seeded offset, so the field is stochastic and not a row. */
  let built = 0;
  function meter(total: number, done: number): void {
    while (built < total) {
      const d = document.createElement("span");
      d.className = "boot__point";
      d.style.setProperty("--dy", `${(((hashSeed(`boot:${built}`) % 1000) / 1000 - 0.5) * 22).toFixed(1)}px`);
      points.appendChild(d);
      built++;
    }
    [...points.children].forEach((c, i) => c.classList.toggle("is-written", i < done));
  }

  return {
    setCurrent(entry, index, total) {
      const box = titleBox(stageEl);
      titleSlot.style.height = `${box.maxH.toFixed(1)}px`;
      titleSlot.style.maxWidth = `${box.maxW.toFixed(1)}px`;
      void fillTitle(titleSlot, entry, index, total, box).then(() => {
        if (finished) return;
        titled = true;
        root.dataset.title = "in";
      });
    },
    progress(done, total, entry) {
      meter(total, done);
      count.textContent = total ? `${String(done).padStart(2, "0")} / ${String(total).padStart(2, "0")}` : "";
      msg.textContent = done >= total && total ? "Ready" : entry ? `Writing ${entry.placeholder ? "In progress" : entry.title}` : "Reading the box";
    },
    skipped,
    async finish(onReveal) {
      if (finished) return;
      const wait = opts.minMs - (performance.now() - started);
      if (wait > 0) await Promise.race([new Promise((r) => setTimeout(r, wait)), skipped]);
      finished = true;
      removeEventListener("keydown", onKey);
      onReveal();
      const done = () => {
        root.remove();
        delete document.body.dataset.boot;
      };
      if (opts.reduced || !titled) {
        done();
        return;
      }
      // The title travels from the middle of the screen to the page title's place, unscaled:
      // it is already set at that size.
      const from = titleSlot.getBoundingClientRect();
      const { top } = titleBox(stageEl);
      const dy = top - from.top;
      root.dataset.phase = "out";
      const travel = titleSlot.animate([{ transform: "none" }, { transform: `translateY(${dy.toFixed(1)}px)` }], { duration: 620, easing: "cubic-bezier(0.65, 0, 0.25, 1)", fill: "forwards" });
      await travel.finished.catch(() => undefined);
      done();
    },
  };
}
