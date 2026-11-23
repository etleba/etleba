import type { FigureSpec } from "../figure";

/**
 * The art pipeline's jobs (recipe/direction-v4.md, loading; recipe/direction-v5.md, figures).
 * Bump ART_VERSION whenever a generator's output changes, so cached drawings from older
 * generators are discarded. It is 5 because the drawings of version 4 were replaced
 * by figures, and the cache's keys changed with them.
 */
export const ART_VERSION = 5;
export const CACHE_NAME = `elb-art-v${ART_VERSION}`;

/** The one job kind: a figure. Its spec is its whole input, so a changed repository redraws. */
export type Job = { kind: "figure" } & FigureSpec;

/**
 * The cache key holds every input the figure is drawn from: the family and size, the ink, the
 * three quantised measures (stars, age, push recency), the placeholder flag and the seed. A
 * repository whose measures cross a step draws a new figure; one that does not stays cached.
 */
export function jobKey(job: Job): string {
  const measures = `s${job.stars}a${job.age}f${job.fresh}${job.placeholder ? "p" : ""}`;
  return `figure/${job.family}/${job.w}x${job.h}u${job.unit}/${job.ink.replace("#", "")}/${measures}/${encodeURIComponent(job.seed)}`;
}
