/**
 * Sound (recipe/direction-v4.md, feedback): every sound is synthesised with WebAudio, so
 * there is nothing to download. On by default (the polish pass: "can we have sound on by
 * default"), but silent until the visitor's first click, tap or key, because browsers allow no
 * sound before a gesture and nothing is queued before it. The Sound control in the bar turns it
 * off, and that choice is remembered. With sound on, flip ticks also give a short vibration on
 * devices that support it. All sounds are short, quiet and rate-limited.
 */

const KEY = "barrett-catalogue:sound";
let enabled = read();
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
const last = new Map<string, number>();

function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

/** No sound at all until the visitor has interacted: nothing is created or scheduled before that. */
let unlocked = false;
for (const type of ["pointerdown", "keydown"] as const) {
  addEventListener(type, () => (unlocked = true), { capture: true, passive: true });
}

function audio(): AudioContext | null {
  if (!enabled || !unlocked) return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 4;
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(comp).connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** At most one `name` every `ms`. */
function gate(name: string, ms: number): boolean {
  const now = performance.now();
  if (now - (last.get(name) ?? -1e9) < ms) return false;
  last.set(name, now);
  return true;
}

function env(g: GainNode, t: number, peak: number, attack: number, decay: number): void {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function burst(a: AudioContext, t: number, opts: { type: BiquadFilterType; f: number; q?: number; peak: number; attack?: number; decay: number; f2?: number }): void {
  const src = a.createBufferSource();
  src.buffer = noise;
  const filter = a.createBiquadFilter();
  filter.type = opts.type;
  filter.frequency.setValueAtTime(opts.f, t);
  if (opts.f2) filter.frequency.exponentialRampToValueAtTime(opts.f2, t + (opts.attack ?? 0.002) + opts.decay);
  filter.Q.value = opts.q ?? 1;
  const g = a.createGain();
  env(g, t, opts.peak, opts.attack ?? 0.002, opts.decay);
  src.connect(filter).connect(g).connect(master!);
  src.start(t, Math.random() * 0.5);
  src.stop(t + (opts.attack ?? 0.002) + opts.decay + 0.05);
}

function tone(a: AudioContext, t: number, opts: { type: OscillatorType; f: number; f2?: number; peak: number; attack?: number; decay: number }): void {
  const o = a.createOscillator();
  o.type = opts.type;
  o.frequency.setValueAtTime(opts.f, t);
  if (opts.f2) o.frequency.exponentialRampToValueAtTime(opts.f2, t + (opts.attack ?? 0.002) + opts.decay);
  const g = a.createGain();
  env(g, t, opts.peak, opts.attack ?? 0.002, opts.decay);
  o.connect(g).connect(master!);
  o.start(t);
  o.stop(t + (opts.attack ?? 0.002) + opts.decay + 0.05);
}

export const sound = {
  get on(): boolean {
    return enabled;
  },
  set(on: boolean): void {
    enabled = on;
    try {
      localStorage.setItem(KEY, on ? "on" : "off");
    } catch {
      /* ignore */
    }
    if (on) {
      audio();
      sound.shutter();
    } else if (ctx) void ctx.suspend();
  },
  /** A disk passing the gap: a plastic tick, and a buzz of a vibration on touch devices. */
  tick(): void {
    if (!enabled || !gate("tick", 26)) return;
    if ("vibrate" in navigator && matchMedia("(pointer: coarse)").matches) navigator.vibrate(4);
    const a = audio();
    if (!a) return;
    const t = a.currentTime;
    burst(a, t, { type: "bandpass", f: 2100 + Math.random() * 900, q: 5, peak: 0.16, decay: 0.022 });
    tone(a, t, { type: "triangle", f: 1400 + Math.random() * 300, peak: 0.03, decay: 0.012 });
  },
  /** A disk lifted out of the box. */
  lift(): void {
    const a = audio();
    if (!a || !gate("lift", 80)) return;
    const t = a.currentTime;
    burst(a, t, { type: "bandpass", f: 900, f2: 2600, q: 1.2, peak: 0.07, attack: 0.02, decay: 0.12 });
  },
  /** A disk dropped home into its slot. */
  drop(): void {
    const a = audio();
    if (!a || !gate("drop", 80)) return;
    const t = a.currentTime;
    burst(a, t, { type: "lowpass", f: 1400, peak: 0.22, decay: 0.05 });
    tone(a, t, { type: "sine", f: 190, f2: 90, peak: 0.12, decay: 0.08 });
  },
  /** The metal shutter sliding, then its spring snapping home. */
  shutter(snapDelay = 0.1): void {
    const a = audio();
    if (!a || !gate("shutter", 120)) return;
    const t = a.currentTime;
    burst(a, t, { type: "bandpass", f: 3200, f2: 7000, q: 2, peak: 0.06, attack: 0.01, decay: Math.max(0.09, snapDelay - 0.01) });
    burst(a, t + snapDelay, { type: "highpass", f: 4000, peak: 0.12, decay: 0.012 });
  },
  /** The disk reaches the slot's mouth and the latch catches it: a firm click with a little body. */
  latch(): void {
    const a = audio();
    if (!a || !gate("latch", 200)) return;
    const t = a.currentTime;
    burst(a, t, { type: "highpass", f: 2200, peak: 0.16, decay: 0.012 });
    burst(a, t, { type: "lowpass", f: 900, peak: 0.12, decay: 0.03 });
    tone(a, t, { type: "sine", f: 240, f2: 150, peak: 0.06, decay: 0.04 });
  },
  /** The drive drawing the disk in: soft friction under the motor, for as long as the slide takes. */
  slide(duration = 1.1): void {
    const a = audio();
    if (!a || !gate("slide", 300)) return;
    const t = a.currentTime;
    // Friction under the motor for the whole draw: rises to its loudest with the seat's speed, then falls away linearly
    // to the seat's arrival, so the picture is never silent before the hub's clunk (sound group, experiment v2).
    const src = a.createBufferSource();
    src.buffer = noise;
    src.loop = true; // the noise buffer is one second; the draw can last longer
    const bp = a.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(700, t);
    bp.frequency.linearRampToValueAtTime(1400, t + duration);
    const ng = a.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.045, t + duration * 0.35);
    ng.gain.linearRampToValueAtTime(0.0001, t + duration);
    src.connect(bp).connect(ng).connect(master!);
    src.start(t);
    src.stop(t + duration + 0.05);
    const hum = a.createOscillator();
    hum.type = "sawtooth";
    hum.frequency.setValueAtTime(46, t);
    hum.frequency.linearRampToValueAtTime(58, t + duration);
    const lp = a.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 220;
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.025, t + duration * 0.3);
    g.gain.linearRampToValueAtTime(0.0001, t + duration);
    hum.connect(lp).connect(g).connect(master!);
    hum.start(t);
    hum.stop(t + duration + 0.05);
  },
  /** Seated: the hub's clunk as the disk drops onto the spindle. */
  seated(): void {
    const a = audio();
    if (!a || !gate("seated", 200)) return;
    const t = a.currentTime;
    burst(a, t, { type: "lowpass", f: 700, peak: 0.3, decay: 0.07 });
    tone(a, t, { type: "sine", f: 120, f2: 70, peak: 0.16, decay: 0.1 });
  },
  /** The drive reading: the head stepping, over the motor's hum. */
  seek(duration = 0.7): void {
    const a = audio();
    if (!a || !gate("seek", 300)) return;
    const t = a.currentTime + 0.05;
    const hum = a.createOscillator();
    hum.type = "sawtooth";
    hum.frequency.value = 58;
    const lp = a.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 260;
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.035, t + 0.08);
    g.gain.setValueAtTime(0.035, t + duration - 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    hum.connect(lp).connect(g).connect(master!);
    hum.start(t);
    hum.stop(t + duration + 0.05);
    let at = t + 0.06;
    while (at < t + duration - 0.08) {
      const run = 2 + Math.floor(Math.random() * 4);
      for (let k = 0; k < run; k++) {
        tone(a, at, { type: "square", f: 95 + Math.random() * 30, peak: 0.05, decay: 0.014 });
        burst(a, at, { type: "bandpass", f: 1600, q: 3, peak: 0.05, decay: 0.012 });
        at += 0.028;
      }
      at += 0.05 + Math.random() * 0.07;
    }
  },
  /** Out of the drive: the spring kicks the disk back. */
  eject(): void {
    const a = audio();
    if (!a || !gate("eject", 200)) return;
    const t = a.currentTime;
    burst(a, t, { type: "lowpass", f: 900, peak: 0.24, decay: 0.05 });
    tone(a, t, { type: "sine", f: 320, f2: 120, peak: 0.1, decay: 0.07 });
    burst(a, t + 0.04, { type: "lowpass", f: 1600, peak: 0.06, attack: 0.02, decay: 0.1 });
  },
  /** A small hard click: the write-protect tab, the index. */
  click(): void {
    const a = audio();
    if (!a || !gate("click", 40)) return;
    const t = a.currentTime;
    burst(a, t, { type: "highpass", f: 2500, peak: 0.14, decay: 0.01 });
    tone(a, t, { type: "square", f: 900, peak: 0.02, decay: 0.008 });
  },
};
