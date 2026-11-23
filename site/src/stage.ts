import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { Entry } from "./catalogue";
import { BOX, DISK, LOOK, SHUTTER_SLIDE, applyEnvironment, buildBox, buildDisk, type Disk, setWriteProtect } from "./floppy";
import { FRONT_CLEAR, OPEN_AT_MOUTH, PHRASE_TEMPO, TURN_BLOCK, gateCase, setTempo } from "./gates";
import { labelCanvas } from "./labels";
import { Spring, clamp, easeOutCubic, smoothstep } from "./motion";
import { hashSeed, rng } from "./random";
import { sound } from "./sound";
import type { State, Store } from "./state";
import { tokens } from "./tokens";

/**
 * The disk box (recipe/direction-v4.md). Every repository is a 3.5" floppy standing in an
 * open box, and browsing is flipping through them: the disks already passed lean towards the
 * viewer, the rest lean back, and the gap opens at the current one.
 *
 * Coordinate contract (3d-motion-design: transforms and pivots):
 *   world: right-handed, +y up, +z towards the viewer, units of ten centimetres. The box
 *     floor is y = 0. The current slot is always at z = 0: the box moves, the camera stays.
 *   slot i stands at z = (pos - i) × GAP, its foot on the floor; a disk's lean is a rotation
 *     about +x at its foot (positive tips its top towards the viewer).
 *   disk frame (src/floppy.ts): origin at the centre, +y the shutter edge, +z the label face.
 *
 * Each disk owns gated springs (src/gates.ts):
 *   pull  0..1  straight up out of the box, along the disk's own plane, clear of its neighbours
 *   turn  0..1  from the box to the presentation spot, square to the camera
 *   open  0..1  the shutter slides, the disk turns on its side and goes into the drive, which is
 *               the left edge of the open sheet
 * Out runs pull, then turn, then open; back runs eject, then turn back, then drop home. Only one
 * disk is out of the box at a time.
 *
 * Its own springs, outside the gates: `lean` follows its place relative to the gap and stops hard
 * against its neighbours (a small bounce, a tick); `peek` lifts it a little under the pointer;
 * `lift` sinks it under the floor for a reflow and raises it again.
 */

const GAP = 0.055;
const LEAN_F = 0.6; // flipped past: leaning towards the viewer, resting on the disk in front
const LEAN_B = 0.16; // still to come: leaning back
const PULL_LIFT = 0.98 * DISK.H;
const SINK = DISK.H + 0.12;
const FRONT_WINDOW = 16;
/**
 * The two-stage insert (review notes: "when it clicks in it then slides in a bit slower"): the disk
 * comes to the slot's mouth with 30% of it inside, the latch catches it and holds it for LATCH_HOLD,
 * then the drive draws it the rest of the way. MOUTH is how far short of seated the mouth is.
 */
const MOUTH = 0.7 * DISK.H + 0.12;
const LATCH_HOLD = 0.16;
/** The rotation follower (timing-and-easing spring_response.py, turn-follower: 3.8% overshoot, settles in 1.08 s);
 *  going home it tracks tightly, so a disk is square to its slot before it drops. */
const FOLLOW = { out: { k: 45, ratio: 0.72 }, back: { k: 400, ratio: 1 } };
/** The box is one size (the polish pass): it holds FRONT_VIS slots in front of the gap and BACK_VIS behind it, and
 *  stands still while the disks glide through it. Disks past either end lie down out of sight. */
const FRONT_VIS = 10;
const BACK_VIS = 12;
const BOX_MARGIN = 0.07;
const BACK_WINDOW = 26;
const RACK_TONE = 0.62;
const HERO_KEEP = 6;
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

/** The lean a disk wants, from its slot's distance `d` past the gap (negative: already flipped). */
export function leanFor(d: number): number {
  return -LEAN_B + (LEAN_F + LEAN_B) * smoothstep((-d - 0.15) / 0.7);
}

interface DiskNode {
  entry: Entry;
  disk: Disk;
  slot: number;
  alive: boolean;
  pull: Spring;
  turn: Spring;
  open: Spring;
  lift: Spring;
  lean: Spring;
  peek: Spring;
  shutterPeek: Spring;
  /** Mass in the hand: a small dip and settle when the disk lands square, or pops back out of the drive. */
  land: Spring;
  wp: Spring;
  liftDelay: number;
  rackTex: THREE.CanvasTexture | null;
  rackReady: Promise<void> | null;
  hero: boolean;
  tone: number;
  /** Which side of the gap the disk was on last frame, for the flip tick. */
  side: number;
  /** Was out of the box (for the drop sound). */
  wasOut: boolean;
  /** Had arrived square in the hand (for the landing). */
  wasPresented: boolean;
  /** Had been in the drive (for the pop on eject). */
  wasRead: boolean;
  /** Into the drive after the latch: 0 at the slot's mouth, 1 seated (the drive draws it in; it pushes it out). */
  seat: Spring;
  /** The turn's rotation, lagging the carry as an attached follower, and settling into the hand. */
  follow: Spring;
  /** How long the disk has sat latched at the slot's mouth (s): the catch holds before the drive draws it in. */
  latchT: number;
  /** Seeded phases (0..1) for the held disk's life in the air: roll, yaw, drift. */
  air: [number, number, number];
}

export interface StageHandle {
  /** Draw and upload what the first view needs; reports progress as disks become ready. */
  warm(onProgress: (done: number, total: number, entry: Entry | null) => void): Promise<void>;
  /** The reveal after the boot screen: the camera settles and the disks rise into the box. */
  arrive(): void;
  dispose(): void;
}

function texture(canvas: HTMLCanvasElement, renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

export function createStage(canvas: HTMLCanvasElement, field: HTMLElement, store: Store): StageHandle | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch {
    return null;
  }
  const small = Math.min(innerWidth, innerHeight) < 700;
  const params = new URLSearchParams(location.search);
  // Lookdev wedges (review builds only): ?review=1&look.plasticRoughness=0.6&look.shadow=0.3 ...
  const ROOM = { shadow: 0.22, screenLight: 120, keyWarm: 0.04, keyHeight: 14, shift: 0.18, sway: 1 };
  if (params.has("review")) {
    for (const [k, v] of params) {
      if (!k.startsWith("look.")) continue;
      const name = k.slice(5);
      const n = Number(v);
      if (!Number.isFinite(n)) continue;
      if (name in LOOK) (LOOK as Record<string, number>)[name] = n;
      if (name in ROOM) (ROOM as Record<string, number>)[name] = n;
    }
  }
  // The disk phrase's tempo (gates.ts PHRASE_TEMPO); review builds may override it: ?review=1&motion.tempo=1.
  let motionTempo = PHRASE_TEMPO;
  if (params.has("review") && params.has("motion.tempo")) {
    const tempoParam = Number(params.get("motion.tempo"));
    if (Number.isFinite(tempoParam) && tempoParam > 0.2 && tempoParam < 5) {
      motionTempo = tempoParam;
      setTempo(tempoParam);
    }
  }
  let quality: "high" | "low" = params.get("quality") === "low" ? "low" : "high";
  renderer.setPixelRatio(quality === "low" ? 1 : Math.min(devicePixelRatio || 1, small ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = quality === "high";
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  let shadowsDirty = true;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  // Reflections are given per material (src/floppy.ts, applyEnvironment), so each takes its own share.
  applyEnvironment(pmrem.fromScene(new RoomEnvironment(), 0.04).texture);
  pmrem.dispose();

  // Near at one unit: nothing comes closer, and coarse depth buffers keep the shutter off the body.
  const camera = new THREE.PerspectiveCamera(30, 1, 1, 30);
  const camBase = new THREE.Vector3(0, 4, 8);
  const lookDir = new THREE.Vector3(0, -0.5, -1).normalize();

  // Light for a paper field (recipe/direction-v5.md): a neutral soft key from high on the left,
  // off the camera's axis so the flat faces never mirror it into the lens; a lower rim from
  // behind that draws the disks' edges against the paper; and an even, bright fill, because the
  // room around the box is paper. The metal shutters catch the key and the rim.
  const page = new THREE.Color(tokens().page);
  // The key: a little warmer than white (ROOM.keyWarm mixes towards a lamp's tungsten), still high on the left.
  const key = new THREE.DirectionalLight(new THREE.Color(0xffffff).lerp(new THREE.Color(0xffd9a8), ROOM.keyWarm), 2.8);
  key.position.set(-5.5, ROOM.keyHeight, 1.6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 20;
  key.shadow.camera.left = -2.4;
  key.shadow.camera.right = 2.4;
  key.shadow.camera.top = 2.4;
  key.shadow.camera.bottom = -2.4;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.01;
  key.shadow.radius = 8;
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(0xffffff, 1.2);
  rim.position.set(2.5, 2.4, -6);
  scene.add(rim);
  scene.add(new THREE.HemisphereLight(page, page.clone().multiplyScalar(0.55), 1.0));
  // A soft spot straight down into the box at the gap, so the labels and shutters there read.
  const boxSpot = new THREE.SpotLight(0xffffff, 26, 7, 0.55, 0.85, 1.6);
  boxSpot.position.set(0, 3.6, 0.9);
  boxSpot.target.position.set(0, 0.35, -0.25);
  scene.add(boxSpot, boxSpot.target);

  // The page is a desk: a shadow-only ground under the box, so it sits on the paper (the polish pass).
  const desk = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: ROOM.shadow }));
  desk.rotation.x = -Math.PI / 2;
  desk.position.y = -0.02;
  desk.receiveShadow = true;
  desk.visible = ROOM.shadow > 0;
  scene.add(desk);

  // The reader's screen is a light: off at rest, and lit while a disk is read (src/ui/reader.ts).
  const screenLight = new THREE.PointLight(0xfff4e2, 0, 0, 2);
  scene.add(screenLight);
  let screenLevel = 0;
  let screenTarget = 0;
  addEventListener("drive", (e) => {
    screenTarget = (e as CustomEvent).detail === "reading" ? 1 : 0;
    dirty = true;
  });

  // The front wall stands just clear of the flipped disks: the frontmost one leans forward over the wall's top
  // edge instead of through it (the polish pass, "is the box invisible at the front?").
  const boxFront = (FRONT_VIS - 1) * GAP + BOX.H * 0.9 * Math.tan(LEAN_F) + 0.03;
  const box = buildBox(boxFront, -(BACK_VIS * GAP + BOX_MARGIN));
  scene.add(box.group);

  // Fog is the page's own colour, so the far disks fade into the paper. (three.js applies fog after tone
  // mapping, so the token colour lands on the page exactly: recipe/studies/fog-check.html samples it.)
  const fog = new THREE.Fog(page, 6, 12);
  scene.fog = fog;
  let fogNear = 6;
  let fogFar = 12;

  const nodes = new Map<string, DiskNode>();
  let order: Entry[] = [];
  const pos = new Spring(0, { stiffness: 120, ratio: 1 });
  const inspectYaw = new Spring(0, { stiffness: 90, ratio: 0.8 });
  const inspectPitch = new Spring(0, { stiffness: 120, ratio: 1 });
  const lookYaw = new Spring(0, { stiffness: 40, ratio: 1 });
  const lookPitch = new Spring(0, { stiffness: 40, ratio: 1 });
  let frame = 0;
  let lastTime = performance.now();
  let disposed = false;
  let dirty = true;
  let reduced = store.state.motion === "reduced";
  let settledFor = -1;
  let arrivalT = 1;
  /** Before the reveal, the disks wait under the floor. */
  let held = true;
  let hovered: DiskNode | null = null;
  let hoverPart: "shutter" | "wp" | "body" | null = null;
  let currentNode: DiskNode | null = null;
  let reflow: null | { phase: "sink" | "rise"; slots: Map<DiskNode, number> } = null;
  let dragging: null | { kind: "box" | "inspect"; startX: number; startY: number; startPos: number; startYaw: number; startPitch: number; lastT: number; velocity: number; axis: "x" | "y" | null; moved: boolean; pointerId: number } = null;
  const heroCache = new Map<string, THREE.CanvasTexture>();
  let drive: "empty" | "inserting" | "latched" | "seating" | "reading" | "ejecting" = "empty";
  document.body.dataset.drive = drive;

  function setDrive(next: typeof drive): void {
    if (next === drive) return;
    drive = next;
    document.body.dataset.drive = next;
    window.dispatchEvent(new CustomEvent("drive", { detail: next }));
  }

  // ---------- disks ----------
  function buildNode(entry: Entry): DiskNode {
    const disk = buildDisk();
    const vary = rng(hashSeed(`motion:${entry.name}`));
    const node: DiskNode = {
      entry,
      disk,
      slot: 0,
      alive: true,
      // Tuned every frame by the gates (src/gates.ts STIFFNESS), out and back.
      pull: new Spring(0, { stiffness: 160, ratio: 1 }),
      turn: new Spring(0, { stiffness: 80, ratio: 1 }),
      open: new Spring(0, { stiffness: 90, ratio: 1 }),
      seat: new Spring(0, { stiffness: 22, ratio: 1 }),
      follow: new Spring(0, { stiffness: FOLLOW.out.k, ratio: FOLLOW.out.ratio }),
      latchT: 0,
      air: [vary(), vary(), vary()],
      lift: new Spring(0, { stiffness: 170, ratio: 1 }),
      // Varied motion (the polish pass): each disk's lean and lift vary a little, seeded by its name, so the
      // stack never moves in lockstep. Ranges: lean stiffness 272 to 368, ratio 0.50 to 0.62; lift 234 to 286.
      lean: new Spring(-LEAN_B, { stiffness: 320 * (0.85 + 0.3 * vary()), ratio: 0.5 + 0.12 * vary() }),
      peek: new Spring(0, { stiffness: 260 * (0.9 + 0.2 * vary()), ratio: 0.7 }),
      // land-b in .motion/06-specialists/timing-and-easing: k 200, zeta 0.5; dips 3.5 mm, settles in 0.56 s.
      land: new Spring(0, { stiffness: 200, ratio: 0.5 }),
      shutterPeek: new Spring(0, { stiffness: 300, ratio: 0.6 }),
      wp: new Spring(0, { stiffness: 400, ratio: 0.7 }),
      liftDelay: 0,
      rackTex: null,
      rackReady: null,
      hero: false,
      tone: 1,
      side: 0,
      wasOut: false,
      wasPresented: false,
      wasRead: false,
    };
    disk.group.traverse((o) => (o.userData.node = node));
    disk.writeProtect.userData.part = "wp";
    disk.shutter.traverse((o) => (o.userData.part = "shutter"));
    for (const d of disk.detail) d.visible = false;
    return node;
  }

  function priorityFor(node: DiskNode): number {
    return 2 + Math.min(60, Math.abs(node.slot - Math.max(0, store.state.current)));
  }

  function paintRack(node: DiskNode): Promise<void> {
    if (!node.rackReady) {
      node.rackReady = labelCanvas(node.entry, small ? 256 : 320, priorityFor(node)).then((c) => {
        if (disposed) return;
        const t = texture(c, renderer);
        renderer.initTexture(t);
        node.rackTex = t;
        if (!node.hero) {
          node.disk.labelMat.map = t;
          node.disk.labelMat.needsUpdate = true;
        }
        dirty = true;
      });
    }
    return node.rackReady;
  }

  async function paintHero(node: DiskNode): Promise<void> {
    let t = heroCache.get(node.entry.name);
    if (!t) {
      const c = await labelCanvas(node.entry, small ? 640 : 1024, 0);
      if (disposed) return;
      t = texture(c, renderer);
      renderer.initTexture(t);
      heroCache.set(node.entry.name, t);
      if (heroCache.size > HERO_KEEP) {
        const oldest = heroCache.keys().next().value as string;
        const dropped = heroCache.get(oldest)!;
        heroCache.delete(oldest);
        const owner = nodes.get(oldest);
        if (owner?.hero) dropHero(owner);
        dropped.dispose();
      }
    }
    if (currentNode !== node) return;
    node.disk.labelMat.map = t;
    node.disk.labelMat.needsUpdate = true;
    node.hero = true;
    dirty = true;
  }

  function dropHero(node: DiskNode): void {
    if (!node.hero) return;
    node.hero = false;
    node.disk.labelMat.map = node.rackTex;
    node.disk.labelMat.needsUpdate = true;
  }

  function staggerFor(slot: number, front: number): number {
    return reduced ? 0 : Math.min(0.55, Math.abs(slot - front) * 0.03);
  }

  function syncCatalogue(state: State): void {
    const firstLoad = nodes.size === 0;
    order = state.visible;
    const front = Math.max(0, state.current);
    const slots = new Map<DiskNode, number>();
    const alive = new Set<string>();
    let visibleChange = false;
    order.forEach((entry, i) => {
      alive.add(entry.name);
      let node = nodes.get(entry.name);
      if (!node) {
        node = buildNode(entry);
        node.slot = i;
        node.lift.snap(0);
        node.alive = false;
        nodes.set(entry.name, node);
        scene.add(node.disk.group);
      }
      if (node.slot !== i || !node.alive) {
        slots.set(node, i);
        if (node.alive && Math.abs(node.slot - pos.x) < BACK_WINDOW) visibleChange = true;
      }
    });
    for (const node of nodes.values()) {
      if (!alive.has(node.entry.name) && node.alive) {
        node.alive = false;
        visibleChange = true;
      }
    }
    for (const entry of order) void paintRack(nodes.get(entry.name)!);

    if (reduced || firstLoad || held || (!visibleChange && !reflow)) {
      for (const [node, slot] of slots) {
        node.slot = slot;
        node.alive = true;
        node.lean.snap(leanFor(slot - front));
        node.liftDelay = staggerFor(slot, front);
        if (!held) node.lift.target = 1;
        if (reduced && !held) node.lift.snap(1);
      }
      for (const node of nodes.values()) if (!alive.has(node.entry.name)) node.lift.snap(0);
      if (reduced || firstLoad || held) pos.snap(front);
    } else {
      // Sink everything in view, re-slot unseen, rise from the gap out.
      const all = new Map<DiskNode, number>();
      order.forEach((entry, i) => all.set(nodes.get(entry.name)!, i));
      reflow = { phase: "sink", slots: all };
      for (const node of nodes.values()) node.lift.target = 0;
    }
    dirty = true;
  }

  function completeReflow(): void {
    if (!reflow) return;
    const front = Math.max(0, store.state.current);
    for (const node of nodes.values()) {
      const slot = reflow.slots.get(node);
      if (slot === undefined) {
        node.alive = false;
        node.lift.snap(0);
        continue;
      }
      node.slot = slot;
      node.alive = true;
      node.pull.snap(0);
      node.turn.snap(0);
      node.open.snap(0);
      node.lean.snap(leanFor(slot - front));
      node.lift.target = 0;
      node.liftDelay = staggerFor(slot, front);
    }
    pos.snap(front);
    reflow.phase = "rise";
  }

  // ---------- framing ----------
  const layout = {
    wide: true,
    present: new THREE.Vector3(0, 1.4, 3),
    face: new THREE.Quaternion(),
    drive: new THREE.Vector3(3, 1.4, 3),
    pxPerSlot: 34,
  };
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const qA = new THREE.Quaternion();
  const qB = new THREE.Quaternion();
  const qC = new THREE.Quaternion();

  function resize(): void {
    const w = Math.max(1, field.clientWidth);
    const h = Math.max(1, field.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    layout.wide = matchMedia("(min-width: 1024px)").matches;
    const halfV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    // Framing by proportion and position (recipe/direction-v4.md, composition): the title holds
    // the top of the stage; the presented disk, about two fifths of the stage tall, floats just
    // below the middle; the box sits at the foot, its current disk a fifth of the stage tall,
    // seen from above at about thirty-five degrees, so the label tops show over the disks in front.
        // Re-chosen for the one-size box (.motion/04-lookdev/framing, candidate G2, after the front wall moved clear of the leaning disks): the largest box that keeps
    // clear of the disk in the hand and the title at every size from 1366x768 to 2560x1440.
    const boxShare = layout.wide ? 0.24 : 0.2;
    const presentShare = layout.wide ? 0.3 : 0.34;
    const boxAt = layout.wide ? 0.7 : 0.85;
    const presentAt = layout.wide ? 0.41 : 0.55;
    // Wide: shift the picture right within the field with a lens shift (no parallax), so the box and the disk
    // sit clear of the caption on the left and the neighbours on the right (ndc shift; 0 on narrow screens).
    const shift = layout.wide ? ROOM.shift : 0;
    camera.filmGauge = 35;
    camera.filmOffset = -shift * halfV * Math.max(1, camera.aspect) * 35;
    const elevation = 0.62;
    const dBox = DISK.H / (2 * halfV * boxShare);
    const target = tmp.set(0, DISK.H * 0.55, 0);
    camBase.set(0, target.y + Math.sin(elevation) * dBox, Math.cos(elevation) * dBox);
    // Tilt the view up so the box lands at boxAt down the frame.
    const alpha = Math.atan((2 * boxAt - 1) * halfV);
    const pitch = elevation - alpha;
    lookDir.set(0, -Math.sin(pitch), -Math.cos(pitch));
    // The presented disk: on the ray through presentAt, at the depth that gives presentShare.
    const beta = Math.atan((1 - 2 * presentAt) * halfV);
    const rayPitch = pitch - beta;
    const dPresent = DISK.H / (2 * halfV * presentShare);
    const ray = tmp2.set(0, -Math.sin(rayPitch), -Math.cos(rayPitch));
    layout.present.copy(camBase).addScaledVector(ray, dPresent / Math.cos(beta));
    layout.face.setFromAxisAngle(X, -rayPitch);
    // The drive: the open sheet's left edge, at the presented disk's height and depth. The disk
    // turns on its side, so half its height runs ahead of its centre.
    const rect = field.getBoundingClientRect();
    // The drive is the reader's slot (src/ui/reader.ts): the disk goes in at its centre line.
    const slot = document.querySelector<HTMLElement>("[data-reader-slot]");
    const slotRect = slot?.getBoundingClientRect();
    if (layout.wide) {
      const edgePx = slotRect && slotRect.width > 0 ? slotRect.left + slotRect.width / 2 - rect.left : w;
      const ndcX = (edgePx / w) * 2 - 1;
      const halfH = halfV * camera.aspect;
      layout.drive.copy(layout.present);
      layout.drive.x = (ndcX - shift) * halfH * dPresent + DISK.H / 2 + 0.12;
    } else {
      layout.drive.copy(layout.present);
      layout.drive.x = halfV * camera.aspect * dPresent + DISK.H;
    }
    // The screen's light stands just past the slot, a little in front, at the disk's height.
    screenLight.position.set(layout.drive.x + 1.2, layout.present.y, layout.present.z + 0.6);
    // Where the slot is drawn on the sheet, in page pixels.
    const root = document.documentElement.style;
    root.setProperty("--drive-y", `${(rect.top + presentAt * h).toFixed(1)}px`);
    root.setProperty("--drive-h", `${((DISK.W / (2 * halfV * dPresent)) * h).toFixed(1)}px`);
    layout.pxPerSlot = layout.wide ? 34 : 26;
    fogNear = dBox - 1.2;
    fogFar = dBox + 3.2;
    fog.near = fogNear;
    fog.far = fogFar;
    camera.updateProjectionMatrix();
    placeCamera(1);
    dirty = true;
  }

  // The camera breathes (your note: "some camera sway"): two slow sines on yaw and pitch at periods that never
  // line up (8.3 s and 12.1 s, seam-checked with motion_builder.py loop), at full strength at rest, damped while
  // a disk is read, off for reduced motion. It turns in place; it never travels or reframes.
  const SWAY = { yaw: 0.12, pitch: 0.07, yawPeriod: 8.3, pitchPeriod: 12.1 };
  // The held disk's life in the air (built and closure-checked with motion_builder.py loop,
  // .motion/05-experiment/loops/held-*.json): roll ±0.7° over 6.1 s, yaw ±1.0° over 9.4 s, drift ±3 mm over 7.3 s,
  // and the breath (±5 mm over 4.2 s). The periods never line up, and each disk's phases are seeded by its name.
  // Comes in and goes with airLevel (critical, k 6): only while held, never for reduced motion.
  const AIR = { roll: 0.7, rollPeriod: 6.1, yaw: 1.0, yawPeriod: 9.4, drift: 0.003, driftPeriod: 7.3, breath: 0.005, breathPeriod: 4.2 };
  const airLevel = new Spring(0, { stiffness: 6, ratio: 1 });
  const swayLevel = new Spring(1, { stiffness: 6, ratio: 1 });
  let swayT = 0;
  let breathT = 0;

  function placeCamera(arrival: number): void {
    const a = 1 - arrival;
    camera.position.set(camBase.x, camBase.y + a * 0.9, camBase.z + a * 1.6);
    // The fog travels with the camera's arrival, so the box never shows as a grey ghost while the camera settles.
    fog.near = fogNear + a * 1.85;
    fog.far = fogFar + a * 1.85;
    const k = swayLevel.x * ROOM.sway * (Math.PI / 180);
    const yaw = k * SWAY.yaw * Math.sin((2 * Math.PI * swayT) / SWAY.yawPeriod);
    const pitch = k * SWAY.pitch * Math.sin((2 * Math.PI * swayT) / SWAY.pitchPeriod + 1.1);
    tmp2.set(lookDir.x + yaw, lookDir.y + pitch, lookDir.z);
    camera.lookAt(tmp.copy(camera.position).add(tmp2));
    camera.updateMatrixWorld();
  }

  const ro = new ResizeObserver(resize);
  ro.observe(field);
  resize();

  // ---------- placement ----------
  const boxPos = new THREE.Vector3();

  function presented(): DiskNode | null {
    return currentNode && currentNode.turn.x > 0.9 ? currentNode : null;
  }

  function placeNode(node: DiskNode, isPresented: boolean): void {
    const g = node.disk.group;
    const d = node.slot - pos.x;
    const out = node.pull.x > 0.001 || node.turn.x > 0.001 || node.open.x > 0.001;
    g.visible = (out || (d > -FRONT_WINDOW && d < BACK_WINDOW)) && node.lift.x > 0.001;
    if (!g.visible) return;
    // In the box: the foot on the floor at its slot, the disk raised along its own plane.
    // Past either end of the one-size box the disk fades out (or in), over one slot; it never passes through the box.
    const past = Math.max(smoothstep(-d - (FRONT_VIS - 1)), smoothstep(d - (BACK_VIS - 1)));
    const lean = node.lean.x;
    const along = DISK.H / 2 + node.pull.x * PULL_LIFT + node.peek.x * 0.07;
    boxPos.set(0, Math.cos(lean) * along, -d * GAP + Math.sin(lean) * along);
    qA.setFromAxisAngle(X, lean);
    // Out: the turn travels only once it is under way, so near home the disk is exactly over
    // its slot (the gate lets it drop only then).
    const t = node.turn.x;
    const travel = smoothstep(clamp((t - 0.1) / 0.9, 0, 1));
    // The rotation lags the carry a little and settles into the hand (an attached follower, not the carry itself).
    const square = clamp(node.follow.x, 0, 1.06);
    const o = node.open.x;
    // To the mouth: the disk rolls onto its side, then travels; the seat then draws it from the mouth into the drive.
    const roll = smoothstep(clamp((o - 0.05) / 0.65, 0, 1));
    const approach = smoothstep(clamp((o - 0.3) / 0.7, 0, 1));
    const seat = clamp(node.seat.x, -0.3, 1);
    const inspect = isPresented ? 1 - smoothstep(o / 0.3) : 0;
    qB.copy(layout.face);
    qC.setFromAxisAngle(Y, (inspectYaw.x + lookYaw.x) * inspect);
    qB.multiply(qC);
    qC.setFromAxisAngle(X, (inspectPitch.x + lookPitch.x) * inspect);
    qB.multiply(qC);
    qC.setFromAxisAngle(Z, (-Math.PI / 2) * roll);
    qB.multiply(qC);
    // Life in the air while held: a slow roll and yaw, never in step (AIR).
    const air = isPresented ? airLevel.x * inspect : 0;
    if (air > 0.0005) {
      const deg = Math.PI / 180;
      qC.setFromAxisAngle(Z, Math.sin(2 * Math.PI * (breathT / AIR.rollPeriod + node.air[0])) * AIR.roll * deg * air);
      qB.multiply(qC);
      qC.setFromAxisAngle(Y, Math.sin(2 * Math.PI * (breathT / AIR.yawPeriod + node.air[1])) * AIR.yaw * deg * air);
      qB.multiply(qC);
    }
    g.quaternion.slerpQuaternions(qA, qB, square);
    // Mass: the landing dips and nods the disk in the hand, then settles.
    if (node.land.x !== 0) {
      qC.setFromAxisAngle(X, node.land.x * 1.2);
      g.quaternion.multiply(qC);
    }
    g.position.lerpVectors(boxPos, layout.present, travel);
    g.position.y += Math.sin(Math.PI * travel) * 0.14 + node.land.x * square;
    // A held disk breathes very slightly, as a hand would hold it; not while it is read, and not for reduced motion.
    if (air > 0.0005) {
      g.position.y += Math.sin((2 * Math.PI * breathT) / AIR.breathPeriod) * AIR.breath * air;
      g.position.x += Math.sin(2 * Math.PI * (breathT / AIR.driftPeriod + node.air[2])) * AIR.drift * air;
    }
    if (approach > 0 || seat !== 0) {
      tmp.copy(layout.drive);
      tmp.x -= MOUTH;
      g.position.lerp(tmp, approach);
      if (seat !== 0) g.position.x += MOUTH * seat;
    }
    // Sinking clears the floor from wherever the disk is.
    const lift = easeOutCubic(node.lift.x);
    // Entering, leaving or re-sorting, a disk fades rather than showing itself through the floor.
    node.disk.fade(out ? 1 : Math.min(1 - past, lift));
    if (past > 0.999 && !out) g.visible = false;
    g.position.y -= (SINK + Math.max(0, g.position.y - DISK.H / 2)) * (1 - lift);
    // Shutter: slides fully as the disk opens, and part way under the pointer.
    node.disk.shutter.position.x = SHUTTER_SLIDE * Math.max(smoothstep(o / 0.3), node.shutterPeek.x * 0.32);
    setWriteProtect(node.disk, node.wp.x);
    const close = node.pull.x > 0.02;
    for (const part of node.disk.detail) part.visible = close;
  }

  // ---------- input ----------
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const tip = document.querySelector<HTMLElement>("[data-tip]");

  function hit(x: number, y: number): { node: DiskNode; part: "shutter" | "wp" | "body" } | null {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((x - rect.left) / rect.width) * 2 - 1, -(((y - rect.top) / rect.height) * 2 - 1));
    raycaster.setFromCamera(ndc, camera);
    const meshes: THREE.Object3D[] = [];
    for (const n of nodes.values()) {
      if (!n.disk.group.visible || !n.alive) continue;
      meshes.push(n.disk.body, n.disk.label, ...n.disk.shutter.children);
      if (n === currentNode) meshes.push(n.disk.writeProtect);
    }
    const found = raycaster.intersectObjects(meshes, false);
    if (!found.length) return null;
    const o = found[0].object;
    return { node: o.userData.node as DiskNode, part: (o.userData.part as "shutter" | "wp" | undefined) ?? "body" };
  }

  /** Is the presented disk showing its back? (Its yaw rests on an odd half turn.) */
  function showingBack(): boolean {
    return Math.abs(Math.round(inspectYaw.target / Math.PI)) % 2 === 1;
  }

  let wheelAccum = 0;
  let wheelTimer = 0;
  /** The README's scroller on the reader's screen. */
  const readerSheet = document.querySelector<HTMLElement>("[data-booklet-sheet]");

  function onWheel(e: WheelEvent): void {
    if (store.state.mode === "loading" || store.state.mode === "failed") return;
    // While a disk is read, the wheel belongs to the screen, wherever the pointer is (.motion/02-arc/sheet-behaviour.md).
    if (store.state.mode === "open" && readerSheet) {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? readerSheet.clientHeight : 1;
      readerSheet.scrollBy({ top: e.deltaY * unit, left: 0 });
      return;
    }
    const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);
    // On narrow layouts the page scrolls vertically; only horizontal wheels flip there.
    if (!layout.wide && !horizontal) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1;
    wheelAccum += (horizontal ? e.deltaX : e.deltaY) * unit;
    const threshold = 60;
    const steps = Math.trunc(wheelAccum / threshold);
    if (steps !== 0) {
      wheelAccum -= steps * threshold;
      store.step(steps, "wheel");
    }
    clearTimeout(wheelTimer);
    wheelTimer = window.setTimeout(() => (wheelAccum = 0), 240);
  }

  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if (store.state.mode === "loading" || store.state.mode === "failed") return;
    const h = hit(e.clientX, e.clientY);
    const inspecting = h !== null && h.node === presented() && store.state.mode === "held";
    dragging = {
      kind: inspecting ? "inspect" : "box",
      startX: e.clientX,
      startY: e.clientY,
      startPos: pos.x,
      startYaw: inspectYaw.x,
      startPitch: inspectPitch.x,
      lastT: performance.now(),
      velocity: 0,
      axis: null,
      moved: false,
      pointerId: e.pointerId,
    };
    canvas.setPointerCapture(e.pointerId);
  }

  function setHover(next: DiskNode | null, part: typeof hoverPart, x: number, y: number): void {
    if (next !== hovered || part !== hoverPart) {
      hovered = next;
      hoverPart = part;
      canvas.dataset.hover = next ? (next === currentNode ? "current" : "case") : "";
      dirty = true;
    }
    if (tip) {
      // Names in the box are small; the pointer says which disk it is on.
      const show = next !== null && next !== presented() && store.state.mode !== "open";
      tip.hidden = !show;
      if (show) {
        tip.textContent = next.entry.title;
        tip.style.transform = `translate3d(${Math.round(x + 14)}px, ${Math.round(y + 16)}px, 0)`;
      }
    }
  }

  function onPointerMove(e: PointerEvent): void {
    if (!dragging) {
      if (e.pointerType !== "mouse") return;
      const h = hit(e.clientX, e.clientY);
      setHover(h?.node ?? null, h?.part ?? null, e.clientX, e.clientY);
      // The presented disk turns a touch towards the pointer.
      if (presented() && !reduced) {
        const rect = canvas.getBoundingClientRect();
        lookYaw.target = clamp(((e.clientX - rect.left) / rect.width - 0.5) * 0.5, -0.2, 0.2);
        lookPitch.target = clamp(((e.clientY - rect.top) / rect.height - 0.54) * 0.4, -0.14, 0.14);
        dirty = true;
      }
      return;
    }
    const dx = e.clientX - dragging.startX;
    const dy = e.clientY - dragging.startY;
    if (!dragging.moved && Math.hypot(dx, dy) > 6) {
      dragging.moved = true;
      dragging.axis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
      if (dragging.kind === "box") {
        // Narrow pages scroll vertically, so there only sideways drags flip.
        if (!layout.wide && dragging.axis === "y") {
          if (canvas.hasPointerCapture(dragging.pointerId)) canvas.releasePointerCapture(dragging.pointerId);
          dragging = null;
          return;
        }
        store.unsettle();
      }
      setHover(null, null, 0, 0);
    }
    if (!dragging.moved) return;
    const now = performance.now();
    const dt = Math.max(1, now - dragging.lastT) / 1000;
    if (dragging.kind === "box") {
      // Drag left, or down towards you, to flip forward.
      const travel = dragging.axis === "x" ? -dx : dy;
      const next = clamp(dragging.startPos + travel / layout.pxPerSlot, -0.6, Math.max(0, order.length - 1) + 0.6);
      dragging.velocity = (next - pos.x) / dt;
      pos.x = next;
      pos.target = next;
      pos.v = 0;
    } else {
      // Turn it in the hand: freely round its vertical axis, a little over its horizontal one.
      const yaw = dragging.startYaw + dx / 140;
      dragging.velocity = (yaw - inspectYaw.x) / dt;
      inspectYaw.x = yaw;
      inspectYaw.target = yaw;
      inspectYaw.v = 0;
      inspectPitch.target = clamp(dragging.startPitch + dy / 320, -0.5, 0.5);
    }
    dragging.lastT = now;
    dirty = true;
  }

  function onPointerUp(e: PointerEvent): void {
    if (!dragging) return;
    const d = dragging;
    dragging = null;
    if (canvas.hasPointerCapture(d.pointerId)) canvas.releasePointerCapture(d.pointerId);
    if (!d.moved) {
      if (e.type === "pointercancel") return;
      const h = hit(e.clientX, e.clientY);
      if (!h) return;
      if (h.node === currentNode && presented()) {
        if (showingBack()) {
          if (h.part === "wp") {
            h.node.wp.target = h.node.wp.target > 0.5 ? 0 : 1;
            sound.click();
          } else inspectYaw.target += Math.PI;
        } else if (store.state.mode === "held") store.open();
      } else if (h.node === currentNode) {
        // In the box: a click takes it out. Already on its way out: a second click carries on into the reader.
        if (store.state.mode === "settled" || store.state.mode === "browsing") store.take();
        else if (store.state.mode === "held") store.open();
      } else {
        const idx = order.indexOf(h.node.entry);
        if (idx >= 0) store.select(idx, "drag");
      }
      dirty = true;
      return;
    }
    if (d.kind === "box") {
      // Keep the gesture's velocity and settle on the slot the fling reaches.
      const v = clamp(d.velocity, -60, 60);
      const target = Math.round(clamp(pos.x + v * 0.14, 0, Math.max(0, order.length - 1)));
      pos.v = v;
      store.select(target, "drag");
    } else {
      // Let go: a flick keeps spinning and comes to rest face or back, whichever it reaches.
      const v = clamp(d.velocity, -40, 40);
      inspectYaw.v = v;
      inspectYaw.target = Math.round((inspectYaw.x + v * 0.22) / Math.PI) * Math.PI;
      inspectPitch.target = 0;
    }
    dirty = true;
  }

  // Type-ahead: letters jump to the next disk whose name starts with what was typed.
  let typed = "";
  let typedAt = 0;
  function typeAhead(ch: string): void {
    const now = performance.now();
    typed = now - typedAt > 800 ? ch : typed + ch;
    typedAt = now;
    const n = order.length;
    const start = typed.length > 1 ? Math.max(0, store.state.current) : Math.max(0, store.state.current) + 1;
    for (let k = 0; k < n; k++) {
      const i = (start + k) % n;
      if (order[i].title.toLowerCase().startsWith(typed)) {
        store.select(i, "keys");
        return;
      }
    }
  }

  function onKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (t && t.closest("[data-list]")) return;
    if (document.body.dataset.index === "open" || document.body.dataset.boot) return;
    const mode = store.state.mode;
    if (mode === "loading" || mode === "failed") return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // While a disk is read, the reading keys scroll the screen instead of flipping the box (state-proposed.json).
    if (mode === "open" && readerSheet) {
      const page = readerSheet.clientHeight * 0.9;
      const by: Record<string, number> = { ArrowDown: 48, ArrowUp: -48, PageDown: page, PageUp: -page, " ": e.shiftKey ? -page : page };
      if (e.key in by) {
        e.preventDefault();
        readerSheet.scrollBy({ top: by[e.key], behavior: reduced ? "auto" : "smooth" });
        return;
      }
      if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        readerSheet.scrollTo({ top: e.key === "Home" ? 0 : readerSheet.scrollHeight, behavior: "auto" });
        return;
      }
    }
    switch (e.key) {
      case "ArrowRight":
        e.preventDefault();
        store.step(1, "keys");
        return;
      case "ArrowLeft":
        e.preventDefault();
        store.step(-1, "keys");
        return;
      case "ArrowDown":
      case "ArrowUp":
        if (!layout.wide) return;
        e.preventDefault();
        store.step(e.key === "ArrowDown" ? 1 : -1, "keys");
        return;
      case "PageDown":
      case "PageUp":
        e.preventDefault();
        store.step(e.key === "PageDown" ? 5 : -5, "keys");
        return;
      case "Home":
        e.preventDefault();
        store.select(0, "keys");
        return;
      case "End":
        e.preventDefault();
        store.select(order.length - 1, "keys");
        return;
      case "Enter":
      case " ":
        if (t && (t.tagName === "BUTTON" || t.tagName === "A")) return;
        e.preventDefault();
        // Enter takes the disk out; again puts it in the reader.
        if (mode === "settled" || mode === "browsing") store.take();
        else if (mode === "held") store.open();
        return;
      case "Escape":
        if (mode === "open") {
          e.preventDefault();
          store.close();
        } else if (mode === "held") {
          e.preventDefault();
          store.put();
        }
        return;
      case "f":
      case "F":
        // Turn the presented disk over.
        if (presented() && mode === "held") {
          e.preventDefault();
          inspectYaw.target += Math.PI;
          dirty = true;
        }
        return;
    }
    if (mode === "open") return;
    if (e.key.length === 1 && /[a-z0-9]/i.test(e.key) && e.key.toLowerCase() !== "i") typeAhead(e.key.toLowerCase());
  }

  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  function onPointerLeave(): void {
    if (!dragging) setHover(null, null, 0, 0);
    lookYaw.target = 0;
    lookPitch.target = 0;
  }
  canvas.addEventListener("pointerleave", onPointerLeave);
  window.addEventListener("keydown", onKey);
  canvas.dataset.hover = "";

  // ---------- state coupling ----------
  const unsubscribe = store.on((state, previous) => {
    reduced = state.motion === "reduced";
    if (state.visible !== previous.visible || state.all !== previous.all) syncCatalogue(state);
    if (state.current !== previous.current || state.selectionTick !== previous.selectionTick || state.visible !== previous.visible) {
      if (!reflow) pos.target = Math.max(0, state.current);
      if (reduced) pos.snap(pos.target);
      settledFor = -1;
      const next = state.current >= 0 ? nodes.get(state.visible[state.current]?.name) ?? null : null;
      if (next !== currentNode) {
        // The old disk keeps its springs and runs its own way home.
        currentNode = next;
        inspectYaw.snap(0);
        inspectPitch.target = 0;
      }
    }
    if (state.mode !== previous.mode) {
      if ((state.mode === "held" || state.mode === "open") && currentNode) void paintHero(currentNode);
      // Opening from the back turns the disk face up first.
      if (state.mode === "open") inspectYaw.target = Math.round(inspectYaw.target / (2 * Math.PI)) * 2 * Math.PI;
      if (state.mode === "open" || state.mode === "browsing") setHover(null, null, 0, 0);
    }
    dirty = true;
  });

  // ---------- gates ----------
  function gate(node: DiskNode, mode: State["mode"]): void {
    const out = node === currentNode && node.alive && !reflow && !held && node.lift.x > 0.98 && (mode === "held" || mode === "open");
    let anotherTurned = false;
    let anotherForward = false;
    if (out && node.turn.target < 1)
      for (const other of nodes.values()) {
        if (other === node) continue;
        if (other.turn.x > TURN_BLOCK) anotherTurned = true;
        if (other.turn.x > FRONT_CLEAR) anotherForward = true;
      }
    gateCase(node, out, mode === "open", anotherTurned, anotherForward, reduced || node.latchT >= LATCH_HOLD * motionTempo);
  }

  // ---------- frame loop ----------
  let slowFrames = 0;
  let sampled = 0;
  let renderedLastFrame = false;
  function applyQuality(): void {
    renderer.setPixelRatio(quality === "low" ? 1 : Math.min(devicePixelRatio || 1, small ? 1.5 : 2));
    renderer.shadowMap.enabled = quality === "high";
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.needsUpdate = true;
    });
    resize();
  }

  let frozen = false;
  function tick(now: number): void {
    if (disposed) return;
    frame = requestAnimationFrame(tick);
    const rawDt = (now - lastTime) / 1000;
    lastTime = now;
    if (frozen) return;
    advance(Math.min(0.05, rawDt), rawDt);
  }

  function step(s: Spring, dt: number): boolean {
    s.step(dt);
    return !s.settled(0.001, 0.003);
  }

  function advance(dt: number, rawDt: number, draw = true): void {
    if (quality === "high" && renderedLastFrame) {
      sampled++;
      if (rawDt > 0.045) slowFrames++;
      if (sampled >= 40) {
        if (slowFrames > 24) {
          quality = "low";
          applyQuality();
        }
        sampled = 0;
        slowFrames = 0;
      }
    }
    renderedLastFrame = false;

    const state = store.state;
    let moving = false;
    if (!dragging || dragging.kind !== "box") moving = step(pos, dt) || moving;
    else moving = true;
    if (!dragging || dragging.kind !== "inspect") moving = step(inspectYaw, dt) || moving;
    else moving = true;
    for (const s of [inspectPitch, lookYaw, lookPitch]) moving = step(s, dt) || moving;
    const pres = presented();
    if (!pres) {
      lookYaw.target = 0;
      lookPitch.target = 0;
    }

    if (reflow?.phase === "sink") {
      let down = true;
      for (const n of nodes.values()) if (n.lift.x > 0.02 && n.disk.group.visible) down = false;
      if (down) completeReflow();
      moving = true;
    } else if (reflow?.phase === "rise") {
      let up = true;
      for (const n of nodes.values()) {
        if (!n.alive) continue;
        if (n.liftDelay > 0) {
          n.liftDelay -= dt;
          up = false;
        } else n.lift.target = 1;
        if (n.lift.x < 0.98) up = false;
      }
      if (up) reflow = null;
      moving = true;
    }

    for (const n of nodes.values()) {
      if (!reflow && n.alive && !held) {
        if (n.liftDelay > 0) {
          n.liftDelay -= dt;
          moving = true;
        } else n.lift.target = 1;
      }
      for (let pass = 0; pass < (reduced ? 4 : 1); pass++) {
        gate(n, state.mode);
        if (reduced) for (const s of [n.pull, n.turn, n.open, n.seat, n.lift]) s.snap();
      }
      // The flip: lean follows the gap, and stops hard against the neighbours with a small bounce.
      const d = n.slot - pos.x;
      n.lean.target = leanFor(d);
      if (reduced) n.lean.snap();
      else {
        n.lean.step(dt);
        if (n.lean.x > LEAN_F) {
          n.lean.x = LEAN_F;
          if (n.lean.v > 0) n.lean.v *= -0.3;
        } else if (n.lean.x < -LEAN_B) {
          n.lean.x = -LEAN_B;
          if (n.lean.v < 0) n.lean.v *= -0.3;
        }
        if (!n.lean.settled(0.001, 0.01)) moving = true;
      }
      const side = d + 0.5 > 0 ? 1 : -1;
      if (n.side !== 0 && side !== n.side && n.alive && n.disk.group.visible && n.pull.x < 0.05) sound.tick();
      n.side = side;
      n.peek.target = n === hovered && n.pull.x < 0.02 && !dragging ? 1 : 0;
      n.shutterPeek.target = n === pres && hoverPart === "shutter" && hovered === n && state.mode === "held" ? 1 : 0;
      for (const s of [n.pull, n.turn, n.open, n.seat, n.lift, n.peek, n.shutterPeek, n.wp, n.land]) moving = step(s, dt) || moving;
      // The rotation follows the carry (out: lagging, settling into the hand; home: tight, square before the drop).
      const f = n.turn.target === 1 ? FOLLOW.out : FOLLOW.back;
      n.follow.tune(f.k / (motionTempo * motionTempo), f.ratio);
      n.follow.target = smoothstep(n.turn.x);
      if (reduced) n.follow.snap();
      else moving = step(n.follow, dt) || moving;
      // The latch: how long the disk has sat at the slot's mouth on its way in.
      // Counts only while the disk is wanted in the drive, so a re-insert after an eject clicks and holds again.
      n.latchT = n === currentNode && state.mode === "open" && n.open.target === 1 && n.open.x > OPEN_AT_MOUTH ? n.latchT + dt : 0;
      // Mass: the disk lands square in the hand with a small dip, and pops back out of the drive the same way.
      if (!reduced) {
        if (n.turn.target === 1 && n.turn.x > 0.85 && !n.wasPresented) {
          n.wasPresented = true;
          n.land.v -= 0.9;
        } else if (n.turn.x < 0.5) n.wasPresented = false;
        if (n.seat.x > 0.9) n.wasRead = true;
        else if (n.wasRead && n.open.x < 0.15) {
          n.wasRead = false;
          n.land.v -= 0.7;
        }
      }
      // Sounds at the moments that matter.
      // The lift's scrape starts with the grip, on the frame the disk is taken (interaction group: acknowledge the press).
      if (n.pull.target === 1 && n.pull.x < 0.5 && !n.wasOut) {
        n.wasOut = true;
        sound.lift();
      } else if (n.pull.target === 0 && n.pull.x < 0.04 && n.wasOut) {
        // Only once it is really going home: the gripped lift stays under 0.04 for its first frames (interaction N1).
        n.wasOut = false;
        sound.drop();
        // The neighbours take the dropped disk's weight: a small bump to each side (attached response).
        if (!reduced)
          for (const k of [-1, 1]) {
            const e = order[n.slot + k];
            const nb = e ? nodes.get(e.name) : undefined;
            if (nb && nb.alive) nb.lean.v += 0.5 * (k < 0 ? 1 : -1);
          }
      }
    }

    // The drive, from the current disk's open and seat springs: to the mouth, the latch catches it (a click and the
    // light), the drive draws it in, it seats (the hub's clunk, then the head reading). Each cue fires in the frame its
    // motion reaches the event.
    const cur = currentNode;
    if (cur && state.mode === "open") {
      if (cur.seat.x > 0.97) {
        if (drive !== "reading") {
          setDrive("reading");
          sound.seated();
          sound.seek();
        }
      } else if (cur.seat.target === 1) {
        if (drive !== "seating") {
          setDrive("seating");
          sound.slide(1.3 * motionTempo);
        }
      } else if (cur.open.x > OPEN_AT_MOUTH) {
        if (drive !== "latched") {
          setDrive("latched");
          sound.latch();
          // The catch: a small recoil against the latch before the drive takes it.
          if (!reduced) cur.seat.v -= 0.5;
        }
      } else if (cur.open.target === 1 && (drive === "empty" || drive === "ejecting")) {
        // Sounds as the disk starts for the slot: on the press when it is already in the hand, or once it reaches the
        // hand when Enter came while it was still being taken out (interaction N2).
        // The press is answered at once: the shutter's sound starts with it, its snap lands as the shutter opens (open 0.3).
        setDrive("inserting");
        sound.shutter(0.3 * motionTempo);
      }
    } else if (drive === "latched" || drive === "seating" || drive === "reading") {
      setDrive("ejecting");
      sound.eject();
    } else if (drive === "inserting") {
      setDrive("ejecting");
    } else if (drive === "ejecting") {
      let anyOpen = 0;
      for (const n of nodes.values()) anyOpen = Math.max(anyOpen, n.open.x, n.seat.x);
      if (anyOpen < 0.03) setDrive("empty");
    }

    // The held disk's life in the air comes in once it is in the hand and goes when it leaves.
    airLevel.target = !reduced && state.mode === "held" && presented() ? 1 : 0;
    if (reduced) airLevel.snap(airLevel.target);
    if (step(airLevel, dt) || airLevel.x > 0.001) moving = true;

    // The scene itself moved this frame (disks, box springs, input): only then does the shadow map need redrawing.
    // The arrival and the sway move only the camera, which a shadow map does not depend on.
    if (moving || dirty) shadowsDirty = true;

    if (arrivalT < 1) {
      arrivalT = Math.min(1, arrivalT + dt / 1.3);
      moving = true;
    }

    // Sway: full at rest, a quarter while reading, none for reduced motion.
    swayLevel.target = reduced || ROOM.sway === 0 ? 0 : state.mode === "open" ? 0.25 : 1;
    if (reduced) swayLevel.snap(swayLevel.target);
    step(swayLevel, dt);
    if (swayLevel.x > 0.001) {
      swayT += dt;
      moving = true;
    }
    breathT += dt;
    if (state.mode === "held" && !reduced) moving = true;

    // The screen's light comes up as the screen wakes and goes as it sleeps (reduced motion: at once).
    if (Math.abs(screenTarget - screenLevel) > 0.002) {
      screenLevel = reduced ? screenTarget : screenLevel + (screenTarget - screenLevel) * Math.min(1, dt * 10);
      screenLight.intensity = ROOM.screenLight * screenLevel;
      moving = true;
    }

    if (!dragging && !reflow && !held && state.mode === "browsing" && state.current >= 0 && pos.settled(0.004, 0.02) && settledFor !== state.selectionTick) {
      settledFor = state.selectionTick;
      store.settle();
    }

    if ((!moving && !dirty) || !draw) return;
    dirty = false;
    renderedLastFrame = true;

    placeCamera(easeOutCubic(arrivalT));
    for (const n of nodes.values()) {
      placeNode(n, n === pres);
      // Tone: the disk in the light at full brightness, the box in the dark, the one under the pointer lifted a little.
      const k = RACK_TONE + (1 - RACK_TONE) * smoothstep(n.turn.x) + (n === hovered && n.pull.x < 0.02 ? 0.18 * n.peek.x : 0);
      if (Math.abs(k - n.tone) > 0.002) {
        n.tone = k;
        n.disk.labelMat.color.setScalar(Math.min(1, k));
      }
    }
    // Shadows are redrawn only when the scene moved (the polish pass: the always-on sway costs no shadow passes).
    renderer.shadowMap.needsUpdate = shadowsDirty;
    shadowsDirty = false;
    renderer.render(scene, camera);
  }
  frame = requestAnimationFrame(tick);

  function onVisibility(): void {
    if (document.hidden) cancelAnimationFrame(frame);
    else {
      lastTime = performance.now();
      frame = requestAnimationFrame(tick);
    }
  }
  document.addEventListener("visibilitychange", onVisibility);

  function arrive(): void {
    if (!held) return;
    held = false;
    const front = Math.max(0, store.state.current);
    for (const n of nodes.values()) {
      if (!n.alive) continue;
      n.liftDelay = 0.12 + staggerFor(n.slot, front);
      if (reduced) {
        n.liftDelay = 0;
        n.lift.snap(1);
      }
    }
    arrivalT = reduced ? 1 : 0;
    dirty = true;
  }

  function snapAll(): void {
    if (reflow?.phase === "sink") completeReflow();
    reflow = null;
    held = false;
    for (const sp of [pos, inspectYaw, inspectPitch, lookYaw, lookPitch]) sp.snap();
    for (let pass = 0; pass < 4; pass++) {
      for (const n of nodes.values()) {
        n.liftDelay = 0;
        // Snapped into the drive (a #/name/readme link): it was latched and drawn in already.
        n.latchT = store.state.mode === "open" && n === currentNode ? LATCH_HOLD * motionTempo : 0;
        if (n.alive) n.lift.target = 1;
        gate(n, store.state.mode);
        n.lean.target = leanFor(n.slot - pos.x);
        for (const s of [n.pull, n.turn, n.open, n.seat, n.lift, n.lean, n.peek, n.shutterPeek]) s.snap();
        n.follow.snap(smoothstep(n.turn.x));
      }
    }
    if (store.state.mode === "browsing") store.settle();
    arrivalT = 1;
    dirty = true;
  }

  if (params.get("review")) {
    (window as unknown as { __rack: unknown }).__rack = {
      freeze() {
        frozen = true;
      },
      step(ms: number) {
        const n = Math.max(1, Math.round(ms / (1000 / 60)));
        for (let k = 0; k < n; k++) advance(1 / 60, 1 / 60, k === n - 1);
      },
      snap: snapAll,
      /** The current disk's centre on screen (CSS px) and its springs, for sampling motion on the fixed clock. */
      probe() {
        const n = currentNode;
        if (!n) return null;
        const p = n.disk.group.getWorldPosition(new THREE.Vector3()).project(camera);
        const r = canvas.getBoundingClientRect();
        const q = n.disk.group.quaternion;
        return {
          x: r.left + ((p.x + 1) / 2) * r.width,
          y: r.top + ((1 - p.y) / 2) * r.height,
          pull: n.pull.x,
          turn: n.turn.x,
          open: n.open.x,
          seat: n.seat.x,
          follow: n.follow.x,
          land: n.land.x,
          quat: [q.x, q.y, q.z, q.w],
          mode: store.state.mode,
        };
      },
      flip() {
        inspectYaw.snap(Math.PI);
        dirty = true;
      },
      scene,
      redraw() {
        dirty = true;
      },
    };
  }

  syncCatalogue(store.state);
  if (store.state.current >= 0) {
    pos.snap(store.state.current);
    currentNode = nodes.get(store.state.visible[store.state.current].name) ?? null;
  }

  return {
    async warm(onProgress) {
      // The disks nearest the gap first: those are the ones on screen.
      const front = Math.max(0, store.state.current);
      // Ten either side of the gap is what the first view shows; the rest draw in the background.
      const near = [...nodes.values()].filter((n) => n.alive).sort((a, b) => Math.abs(a.slot - front) - Math.abs(b.slot - front)).slice(0, 10);
      const total = near.length;
      let done = 0;
      onProgress(0, total, null);
      await Promise.all([...near.map((n) => paintRack(n).then(() => onProgress(++done, total, n.entry))), currentNode ? paintHero(currentNode) : null]);
      performance.mark("boot:labels");
      // Compile every shader the scene will need now, not on the first frame that needs it.
      // The disks wait out of sight until the reveal, so show them for the compile.
      const hidden: THREE.Object3D[] = [];
      for (const n of nodes.values())
        for (const part of [n.disk.group, ...n.disk.detail])
          if (!part.visible) {
            part.visible = true;
            hidden.push(part);
          }
      try {
        // In parallel where the driver can; otherwise here and now, while the boot screen is up.
        if (renderer.extensions.has("KHR_parallel_shader_compile")) await renderer.compileAsync(scene, camera);
        else renderer.compile(scene, camera);
      } catch {
        /* compiling ahead is an optimisation only */
      }
      for (const part of hidden) part.visible = false;
      performance.mark("boot:compiled");
      dirty = true;
      onProgress(total, total, null);
    },
    arrive,
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      unsubscribe();
      ro.disconnect();
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisibility);
      for (const t of heroCache.values()) t.dispose();
      heroCache.clear();
      for (const n of nodes.values()) n.rackTex?.dispose();
      renderer.dispose();
    },
  };
}
