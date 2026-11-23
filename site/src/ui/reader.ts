import { hashSeed } from "../random";
import type { State, Store } from "../state";

/**
 * The reader (D. The Reader): the machine on the right of the page that a disk goes into. It is
 * furniture: it is always there on wide screens and never moves. At rest its screen is off and
 * shows the box as a field of points, one per disk, the current one filled, over "No disk".
 * The screen wakes only once the disk is in the drive (the stage reports `drive: reading`), or
 * at once where there is no disk to wait for (no WebGL, reduced motion, narrow screens).
 */
export function mountReader(root: HTMLElement, store: Store): void {
  const points = root.querySelector<HTMLElement>("[data-reader-points]")!;
  const count = root.querySelector<HTMLElement>("[data-reader-count]")!;
  const bar = document.querySelector<HTMLElement>(".bar");
  const wide = matchMedia("(min-width: 1024px)");

  // Lookdev wedges (review builds only): the screen at rest ("paper" or "dark" standby) and the glow's spread.
  const params = new URLSearchParams(location.search);
  if (params.has("review")) {
    const off = params.get("look.screenOff");
    if (off === "dark" || off === "paper") document.body.dataset.screenOff = off;
    const float = Number(params.get("look.float"));
    if (params.has("look.float") && Number.isFinite(float)) document.documentElement.style.setProperty("--reader-float", `${float}px`);
    const glow = Number(params.get("look.glow"));
    if (params.has("look.glow") && Number.isFinite(glow)) document.documentElement.style.setProperty("--screen-glow", `${glow}px`);
  }

  /** The reader stands under the bar's rule, on the same line as the title. */
  function place(): void {
    if (!bar) return;
    const margin = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--margin")) || 24;
    const top = bar.getBoundingClientRect().bottom + margin * 0.5;
    document.documentElement.style.setProperty("--reader-top", `${top.toFixed(1)}px`);
  }
  new ResizeObserver(place).observe(document.documentElement);
  place();

  let built = 0;
  function field(state: State): void {
    const total = state.visible.length;
    while (built < total) {
      const d = document.createElement("span");
      d.className = "reader__point";
      d.style.setProperty("--dy", `${(((hashSeed(`boot:${built}`) % 1000) / 1000 - 0.5) * 22).toFixed(1)}px`);
      points.appendChild(d);
      built++;
    }
    while (built > total) {
      points.lastElementChild?.remove();
      built--;
    }
    [...points.children].forEach((c, i) => c.classList.toggle("is-current", i === state.current));
    count.textContent = total ? `${String(Math.max(0, state.current) + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}` : "";
  }

  function waitsForDisk(state: State): boolean {
    return state.renderer === "webgl" && state.motion === "full" && wide.matches;
  }

  function awake(on: boolean): void {
    root.toggleAttribute("data-awake", on);
  }

  store.on((state, previous) => {
    if (state.visible !== previous.visible || state.current !== previous.current) field(state);
    // The reader stops floating as soon as a disk is out of the box, and floats again once it is back.
    root.toggleAttribute("data-steady", state.mode === "held" || state.mode === "open");
    if (state.mode !== "open") awake(false);
    else if (previous.mode !== "open" && !waitsForDisk(state)) awake(true);
    else if (document.body.dataset.drive === "reading") awake(true);
  });
  addEventListener("drive", (e) => {
    const detail = (e as CustomEvent).detail;
    if (detail === "reading" && store.state.mode === "open") awake(true);
    if (detail === "ejecting" || detail === "empty") awake(false);
  });
  field(store.state);
}
