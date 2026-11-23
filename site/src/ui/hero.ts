import type { Entry } from "../catalogue";
import type { State, Store } from "../state";
import { fillTitle, titleBox } from "./title";

/**
 * The title (recipe/direction-v5.md, composition): the project's name in Inter display with a
 * micro code line, left on the grid across the top of the stage. The presented disk floats
 * under it (recipe/direction-v4.md). When the box settles, the title block opens from its centre
 * line outward, kept from earlier versions; when the box moves it goes. Reduced motion swaps it
 * at once. Decorative: the caption carries the readable name.
 */
export function mountHero(root: HTMLElement, stage: HTMLElement, store: Store): void {
  const field = stage.querySelector<HTMLElement>("[data-field]")!;
  let shown: string | null = null;
  let token = 0;

  async function layout(entry: Entry, index: number, total: number): Promise<void> {
    const mine = ++token;
    const box = titleBox(stage);
    root.style.top = `${(box.top - field.getBoundingClientRect().top).toFixed(1)}px`;
    root.style.height = `${box.maxH.toFixed(1)}px`;
    await fillTitle(root, entry, index, total, box);
    if (mine !== token) return;
  }

  // With the reader docked beside the box (wide screens), nothing covers the title while a disk is read, so it stays.
  const docked = matchMedia("(min-width: 1024px)");

  async function show(state: State): Promise<void> {
    const entry = state.current >= 0 ? state.visible[state.current] : null;
    if (!entry) return;
    if (shown === entry.name && root.dataset.state === "in") return;
    shown = entry.name;
    root.dataset.state = "off";
    await layout(entry, state.current, state.visible.length);
    // Still the one to show once its title has been set?
    if (shown !== entry.name || (store.state.mode !== "settled" && store.state.mode !== "held" && !(store.state.mode === "open" && docked.matches))) return;
    // Under the boot screen the title is placed already open: the boot's own title lands on it.
    if (document.body.dataset.boot) {
      root.dataset.state = "shown";
      return;
    }
    void root.offsetWidth;
    root.dataset.state = "in";
  }

  function cut(): void {
    if (root.dataset.state === "in" || root.dataset.state === "shown") root.dataset.state = "out";
    shown = null;
  }

  store.on((state) => {
    if (state.mode === "settled" || state.mode === "held" || (state.mode === "open" && docked.matches)) void show(state);
    else cut();
  });

  new ResizeObserver(() => {
    const entry = store.current;
    if (entry && shown === entry.name) void layout(entry, store.state.current, store.state.visible.length);
  }).observe(field);
}
