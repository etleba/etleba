import type { Spring } from "./motion";

/**
 * The disk sequence gates (recipe/direction-v4.md, with v6's held state and the two-stage insert).
 * Pure, so the review simulation (scripts/simulate-gates.ts) runs exactly what the stage runs.
 *
 * Out:  lift (pull) → turn → to the slot's mouth (open) → latch → drawn in (seat).
 * Back: pushed out (seat) → back to the hand (open) → turn back → drop home.
 *
 * PULL_CLEAR: a disk may begin to travel only once it is lifted far enough that its foot clears
 *   the tops of the disks leaning towards the viewer: 0.9 × 0.92 × cos 9° = 0.82 > 0.94 × cos 34° = 0.78.
 * TURN_BLOCK: no disk starts its turn while another is turned more than this.
 * FRONT_CLEAR: no disk starts to lift while another is still on its way home.
 * OPEN_AT_MOUTH: the disk has reached the slot's mouth; the latch may catch it.
 * SEAT_OUT: the drive has pushed the disk back to the mouth; it may leave for the hand.
 */
export const PULL_CLEAR = 0.9;
export const TURN_READY = 0.92;
export const OPEN_SHUT = 0.06;
export const TURN_HOME = 0.05;
export const TURN_BLOCK = 0.04;
/** No disk starts to lift while another is still on its way home (turn above this). */
export const FRONT_CLEAR = 0.1;
export const OPEN_AT_MOUTH = 0.96;
export const SEAT_OUT = 0.05;

interface Drive {
  /** Stiffness. */
  k: number;
  /** Damping ratio (1 critical). */
  ratio?: number;
  /** Stiffness of the critically damped lead the spring chases (0: none): the gripped start. */
  lead?: number;
}

/**
 * Each stage, out and back (values from timing-and-easing spring_response.py, .motion/05-experiment/springs-v2):
 * - pull out: the disk is drawn up a snug slot: a slow, gripped start (lead 60) that frees (k 160).
 * - turn out: carried to the hand (k 100, lead 80: the carry picks up from the lift with only a short beat between);
 *   the turn's rotation follows as a lagging follower in the stage.
 * - open out: to the slot's mouth (k 120, lead 60); the latch catches it as it arrives (OPEN_AT_MOUTH 0.96).
 * - seat out: after the latch, the drive draws the disk in slowly (k 30, lead 70: the motor takes up).
 * - seat back: the drive's spring pushes it out with a little give past the mouth (k 140, ratio 0.65).
 * - open back: from the mouth back to the hand as one carry after the push (k 90, lead 90; without a lead the
 *   return surged to the fastest move in the phrase, timing group v2).
 * - turn back, pull back: as locked before (k 220, k 200): the way home is quicker than the way out (exits lead,
 *   entries settle; timing group, experiment v2, found a lead here made the put-back twice as slow).
 */
export const STIFFNESS: Record<"pull" | "turn" | "open" | "seat", { out: Drive; back: Drive }> = {
  pull: { out: { k: 160, lead: 60 }, back: { k: 200 } },
  turn: { out: { k: 100, lead: 80 }, back: { k: 220 } },
  open: { out: { k: 120, lead: 60 }, back: { k: 90, lead: 90 } },
  seat: { out: { k: 30, lead: 70 }, back: { k: 140, ratio: 0.65 } },
};

/**
 * The phrase's tempo: durations scale by it, so stiffnesses (and leads) scale by 1 / tempo². The values above are
 * written at tempo 1; the experiment (.motion/05-experiment, timing group's bracket 0.85 / 1.0 / 1.25) chose 0.85:
 * the disk in the hand at 1.43 s (it was 0.77 s), the README readable about 2.4 s after Enter, the eject back in
 * the hand in 0.9 s. Review builds may override it with ?review=1&motion.tempo=<t>.
 */
export const PHRASE_TEMPO = 0.85;
let tempo = PHRASE_TEMPO;
export function setTempo(t: number): void {
  if (Number.isFinite(t) && t > 0.2 && t < 5) tempo = t;
}

export interface Gated {
  pull: Spring;
  turn: Spring;
  open: Spring;
  seat?: Spring;
}

function drive(s: Spring, spec: { out: Drive; back: Drive }): void {
  const d = s.target > s.x ? spec.out : spec.back;
  const scale = 1 / (tempo * tempo);
  s.tune(d.k * scale, d.ratio ?? 1, (d.lead ?? 0) * scale);
}

/**
 * @param seatReady the latch has held long enough (the stage owns that clock); the slide may start.
 */
export function gateCase(c: Gated, wantOut: boolean, wantOpen: boolean, anotherTurned: boolean, anotherForward = false, seatReady = true): void {
  const seatOut = !c.seat || c.seat.x < SEAT_OUT;
  if (wantOut) {
    if (c.pull.target < 1 && !anotherForward) c.pull.target = 1;
    if (c.pull.target === 1 && c.turn.target < 1 && c.pull.x > PULL_CLEAR && !anotherTurned) c.turn.target = 1;
    if (wantOpen && c.turn.x > TURN_READY) c.open.target = 1;
    else if (seatOut) c.open.target = 0;
    if (c.seat) c.seat.target = wantOpen && c.open.x > OPEN_AT_MOUTH && seatReady ? 1 : 0;
  } else {
    if (c.seat) c.seat.target = 0;
    if (seatOut) c.open.target = 0;
    if (c.open.x < OPEN_SHUT && seatOut) c.turn.target = 0;
    if (c.turn.x < TURN_HOME) c.pull.target = 0;
  }
  // Tune after the targets are set, so a stage's first frame already runs on its own spring and lead.
  for (const key of ["pull", "turn", "open"] as const) drive(c[key], STIFFNESS[key]);
  if (c.seat) drive(c.seat, STIFFNESS.seat);
}
