import { type Entry, pad2 } from "../catalogue";
import { fontsFor } from "../fonts";

/**
 * The project title (recipe/direction-v5.md, composition): the name in Inter display, left on
 * the grid, over a micro code line ("No. 04 · Python · 2026"). The hero and the boot screen
 * set it the same way from the same box, so the boot's title lands exactly on the page's.
 */

export interface TitleBox {
  /** Page y of the box's top. */
  top: number;
  maxW: number;
  maxH: number;
  narrow: boolean;
}

/** The box the title takes at the top of the stage, below the bar. */
export function titleBox(stage: HTMLElement): TitleBox {
  const field = stage.querySelector<HTMLElement>("[data-field]")!;
  const bar = stage.querySelector<HTMLElement>(".bar")!;
  const margin = parseFloat(getComputedStyle(stage).getPropertyValue("--margin")) || 24;
  const w = field.clientWidth;
  const h = field.clientHeight;
  const narrow = w < 700;
  return {
    top: bar.getBoundingClientRect().bottom + margin * 0.5,
    maxW: narrow ? w - margin * 2 : Math.min(w - margin * 2, w * 0.7),
    maxH: h * (narrow ? 0.22 : 0.26),
    narrow,
  };
}

/** The micro line: the position in the current order, the language and the year. */
export function codeLine(entry: Entry, index: number, total: number): string {
  const no = `No. ${pad2(index + 1, total)}`;
  return entry.placeholder ? `${no} · In progress` : `${no} · ${entry.language ?? "No language"} · ${entry.year}`;
}

/**
 * Build the title block for `entry` into `slot` and fit it to the box. The name starts at the
 * display size of the type scale (`--size-display`, 64 px, or 44 px on small screens) and steps
 * down only if a long name would not fit two lines in the box, to no less than a chapter-size 36 px.
 */
export async function fillTitle(slot: HTMLElement, entry: Entry, index: number, total: number, box: TitleBox): Promise<boolean> {
  const name = entry.placeholder ? "In progress" : entry.title;
  await fontsFor(name);
  const block = document.createElement("div");
  block.className = "titleblock";
  const code = document.createElement("p");
  code.className = "titleblock__code";
  code.textContent = codeLine(entry, index, total);
  const title = document.createElement("p");
  title.className = "titleblock__name";
  title.textContent = name;
  block.append(code, title);
  block.style.maxWidth = `${box.maxW.toFixed(1)}px`;
  slot.replaceChildren(block);
  const start = parseFloat(getComputedStyle(slot).getPropertyValue("--size-display")) || (box.narrow ? 44 : 64);
  for (let size = start; size >= 36; size -= 2) {
    block.style.setProperty("--title-size", `${size}px`);
    if (block.getBoundingClientRect().height <= box.maxH) break;
  }
  return true;
}
