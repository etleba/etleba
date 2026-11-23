import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { hashSeed, rng } from "./random";
import { tokens } from "./tokens";

/**
 * The 3.5" floppy disk and its box (recipe/direction-v4.md, disks), in scene units of ten
 * centimetres. Disk frame: origin at the centre, +y towards the shutter edge, +z out of the
 * label face. Geometry and the plastic and metal materials are shared by every disk; each
 * disk owns only its label material. The body is one extrusion with the clipped corner and the
 * write-protect and density holes cut through it. The head opening is not cut: its walls would
 * be seen exactly edge on, which some rasterisers leak through the shutter in front. Instead a
 * dark recess of exposed media lies under the shutter on each face, and shows once the shutter
 * slides across.
 */

export const DISK = { W: 0.9, H: 0.94, T: 0.033 } as const;
/** How far the shutter slides to open, along +x. */
export const SHUTTER_SLIDE = 0.2;
/** The label's printed area, in disk units. */
export const LABEL = { x0: -0.36, x1: 0.36, y0: -0.45, y1: 0.11 } as const;
const OPENING = { x0: -0.06, x1: 0.06, y0: 0.2, y1: 0.44 };
const SHUTTER = { x0: -0.32, x1: 0.2, y0: 0.15, y1: 0.47 };
const WINDOW = { x0: -0.26, x1: -0.14, y0: 0.2, y1: 0.44 };
const WP_HOLE = { x0: -0.425, x1: -0.38, y0: -0.445, y1: -0.385 };
const HD_HOLE = { x0: 0.38, x1: 0.425, y0: -0.445, y1: -0.385 };

export interface Disk {
  /** The disk frame. */
  group: THREE.Group;
  body: THREE.Mesh;
  shutter: THREE.Group;
  label: THREE.Mesh;
  labelMat: THREE.MeshStandardMaterial;
  /** Parts only seen up close: hidden while the disk is in the box. */
  detail: THREE.Object3D[];
  writeProtect: THREE.Mesh;
  /** Fade the whole disk (1 opaque, 0 gone): disks enter and leave the one-size box this way, never through its floor. */
  fade(opacity: number): void;
}

function rectPath(p: THREE.Path, r: { x0: number; x1: number; y0: number; y1: number }): void {
  p.moveTo(r.x0, r.y0);
  p.lineTo(r.x0, r.y1);
  p.lineTo(r.x1, r.y1);
  p.lineTo(r.x1, r.y0);
  p.lineTo(r.x0, r.y0);
}

function outline(): THREE.Shape {
  const { W, H } = DISK;
  const r = 0.012;
  const c = 0.04;
  const s = new THREE.Shape();
  s.moveTo(-W / 2 + r, -H / 2);
  s.lineTo(W / 2 - r, -H / 2);
  s.quadraticCurveTo(W / 2, -H / 2, W / 2, -H / 2 + r);
  s.lineTo(W / 2, H / 2 - c);
  s.lineTo(W / 2 - c, H / 2);
  s.lineTo(-W / 2 + r, H / 2);
  s.quadraticCurveTo(-W / 2, H / 2, -W / 2, H / 2 - r);
  s.lineTo(-W / 2, -H / 2 + r);
  s.quadraticCurveTo(-W / 2, -H / 2, -W / 2 + r, -H / 2);
  for (const hole of [WP_HOLE, HD_HOLE]) {
    const h = new THREE.Path();
    rectPath(h, hole);
    s.holes.push(h);
  }
  return s;
}

interface Shared {
  body: THREE.BufferGeometry;
  plate: THREE.BufferGeometry;
  cap: THREE.BufferGeometry;
  label: THREE.BufferGeometry;
  opening: THREE.BufferGeometry;
  hub: THREE.BufferGeometry;
  hubHole: THREE.BufferGeometry;
  arrow: THREE.BufferGeometry;
  slider: THREE.BufferGeometry;
  plastic: THREE.MeshPhysicalMaterial;
  metal: THREE.MeshStandardMaterial;
  mediaMat: THREE.MeshStandardMaterial;
  black: THREE.MeshBasicMaterial;
  emboss: THREE.MeshStandardMaterial;
}

let shared: Shared | null = null;

/** A brushed-steel texture: fine streaks along the shutter's slide. */
function brushed(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  for (let y = 0; y < c.height; y++) {
    const v = 178 + Math.round(Math.random() * 30);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(0, y, c.width, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 3);
  return t;
}

function build(): Shared {
  const { T } = DISK;
  const bevel = 0.0028;
  const body = new THREE.ExtrudeGeometry(outline(), { depth: T - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: 0.0022, bevelSegments: 2, curveSegments: 4 });
  body.translate(0, 0, -(T - 2 * bevel) / 2);
  body.computeVertexNormals();

  const plateShape = new THREE.Shape();
  rectPath(plateShape, SHUTTER);
  const win = new THREE.Path();
  rectPath(win, WINDOW);
  plateShape.holes.push(win);
  const plate = new THREE.ExtrudeGeometry(plateShape, { depth: 0.0012, bevelEnabled: false, curveSegments: 1 });
  const cap = new THREE.BoxGeometry(SHUTTER.x1 - SHUTTER.x0, 0.003, T + 0.0066);
  cap.translate((SHUTTER.x0 + SHUTTER.x1) / 2, DISK.H / 2 + 0.0015, 0);

  const label = new THREE.PlaneGeometry(LABEL.x1 - LABEL.x0, LABEL.y1 - LABEL.y0);
  label.translate(0, (LABEL.y0 + LABEL.y1) / 2, T / 2 + 0.0011);

  const opening = new THREE.PlaneGeometry(OPENING.x1 - OPENING.x0, OPENING.y1 - OPENING.y0);
  opening.translate((OPENING.x0 + OPENING.x1) / 2, (OPENING.y0 + OPENING.y1) / 2, 0);

  const hub = new THREE.CylinderGeometry(0.125, 0.125, 0.0026, 40);
  hub.rotateX(Math.PI / 2);
  hub.translate(0, -0.03, -T / 2 - 0.0013);
  const hubHole = new THREE.PlaneGeometry(0.042, 0.042);
  hubHole.rotateY(Math.PI);
  hubHole.translate(0, -0.03, -T / 2 - 0.0028);

  const tri = new THREE.Shape();
  tri.moveTo(-0.38, 0.44);
  tri.lineTo(-0.36, 0.405);
  tri.lineTo(-0.4, 0.405);
  tri.lineTo(-0.38, 0.44);
  const arrow = new THREE.ShapeGeometry(tri);
  arrow.translate(0, 0, T / 2 + 0.0004);

  const slider = new THREE.BoxGeometry(WP_HOLE.x1 - WP_HOLE.x0 - 0.004, 0.028, T * 0.72);
  slider.translate((WP_HOLE.x0 + WP_HOLE.x1) / 2, 0, 0);

  return {
    body,
    plate,
    cap,
    label,
    opening,
    hub,
    hubHole,
    arrow,
    slider,
    // Black plastic that stays black. Even black reflects about 4% head on, and the studio
    // environment is bright, so the plastic takes only a trace of it and a softened highlight;
    // the side and rim lights do the shaping.
    plastic: new THREE.MeshPhysicalMaterial({ color: 0x111111, roughness: LOOK.plasticRoughness, metalness: 0, specularIntensity: 0.6, clearcoat: LOOK.plasticCoat, clearcoatRoughness: 0.3, envMapIntensity: 0.16 }),
    // Brushed steel: streaks along the slide, a soft sheen, not a mirror.
    metal: new THREE.MeshStandardMaterial({ color: 0xc4c4c4, map: brushed(), metalness: 1, roughness: 0.4, envMapIntensity: 0.12, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
    mediaMat: new THREE.MeshStandardMaterial({ color: 0x1c160f, metalness: 0.1, roughness: 0.38, envMapIntensity: 0.25 }),
    black: new THREE.MeshBasicMaterial({ color: 0x000000 }),
    emboss: new THREE.MeshStandardMaterial({ color: 0x232323, roughness: 0.6, envMapIntensity: 0.04 }),
  };
}

export function sharedDisk(): Shared {
  if (!shared) shared = build();
  return shared;
}

let environment: THREE.Texture | null = null;

/**
 * Give the disks (and the box) their reflections. Set on each material rather than on the
 * scene: with only a scene environment, three.js uses the scene's intensity for every
 * material and ignores each one's own `envMapIntensity`, and black plastic needs far less of
 * the room than steel does.
 */
export function applyEnvironment(tex: THREE.Texture): void {
  environment = tex;
  const s = sharedDisk();
  for (const m of [s.plastic, s.metal, s.mediaMat, s.emboss, boxMaterial()]) {
    m.envMap = tex;
    m.needsUpdate = true;
  }
}

export function buildDisk(): Disk {
  const s = sharedDisk();
  const { T } = DISK;
  const group = new THREE.Group();
  // Each disk has its own copies of the shared materials, so it can fade on its own (the shaders are still shared).
  const plastic = s.plastic.clone();
  const metal = s.metal.clone();
  const mediaMat = s.mediaMat.clone();
  const emboss = s.emboss.clone();
  const black = s.black.clone();
  const body = new THREE.Mesh(s.body, plastic);
  const shutter = new THREE.Group();
  // The shutter stands a little proud of the body, enough for coarse depth buffers to keep apart.
  const front = new THREE.Mesh(s.plate, metal);
  front.position.z = T / 2 + 0.0012;
  const back = new THREE.Mesh(s.plate, metal);
  back.position.z = -T / 2 - 0.0024;
  const cap = new THREE.Mesh(s.cap, metal);
  shutter.add(front, back, cap);
  // Paper, and matte: the sticker's own colour is in its texture (src/labels.ts), so the material is white, rough and takes little of the room.
  const labelMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0, envMapIntensity: 0.12, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  const label = new THREE.Mesh(s.label, labelMat);
  // The exposed media, front and back, under the shutter.
  const media = new THREE.Mesh(s.opening, mediaMat);
  media.position.z = T / 2 + 0.0005;
  const mediaBack = new THREE.Mesh(s.opening, mediaMat);
  mediaBack.rotation.y = Math.PI;
  mediaBack.position.z = -T / 2 - 0.0005;
  const hub = new THREE.Mesh(s.hub, metal);
  const hubHole = new THREE.Mesh(s.hubHole, black);
  const arrow = new THREE.Mesh(s.arrow, emboss);
  const writeProtect = new THREE.Mesh(s.slider, plastic);
  group.add(body, shutter, label, media, mediaBack, hub, hubHole, arrow, writeProtect);
  for (const m of [body, front, back, cap, label]) {
    m.castShadow = true;
    m.receiveShadow = true;
  }
  // The shutter lies a fraction of a millimetre over the body: too close for the shadow map to
  // tell apart, so it casts but does not receive (no acne along the opening's edges).
  for (const m of [front, back, cap]) m.receiveShadow = false;
  if (environment) labelMat.envMap = environment;
  const mats: THREE.Material[] = [plastic, metal, mediaMat, emboss, black, labelMat];
  let shown = 1;
  function fade(opacity: number): void {
    const o = Math.max(0, Math.min(1, opacity));
    if (Math.abs(o - shown) < 1e-3) return;
    const was = shown < 0.999;
    shown = o;
    const now = o < 0.999;
    for (const m of mats) {
      m.opacity = o;
      if (was !== now) {
        m.transparent = now;
        m.depthWrite = !now;
        m.needsUpdate = true;
      }
    }
  }
  return { group, body, shutter, label, labelMat, detail: [media, mediaBack, hub, hubHole, arrow, writeProtect], writeProtect, fade };
}

/** Write-protect slider: 0 covers the hole (writable), 1 leaves it open (protected). */
export function setWriteProtect(d: Disk, t: number): void {
  const y0 = WP_HOLE.y0 + 0.016;
  const y1 = WP_HOLE.y1 - 0.016;
  d.writeProtect.position.y = y0 + (y1 - y0) * t;
}

// ---------- the box ----------

/**
 * The box (the polish pass, after "Box should be one size, fairly large and needs to have some
 * thicker looking boxy shape to it, and texture"): one fixed size whatever the catalogue holds,
 * thick walls and floor with softened edges, in a charcoal board with a fibre texture. It stands
 * still; the disks glide through it as you flip (src/stage.ts), entering at the back and leaving
 * at the front. Inner floor from z = `front` (towards the viewer) to z = `back`.
 */
export const BOX = { W: 1.0, H: 0.56, wall: 0.045, floor: 0.04 } as const;

export interface Box {
  group: THREE.Group;
}

let boxMaterialCache: THREE.MeshStandardMaterial | null = null;

/** A charcoal board: broad mottling, fibre clumps and a fine tooth; seamless (every mark wraps) and seeded (always the same). */
function boardTexture(): THREE.CanvasTexture {
  const size = 512;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const r = rng(hashSeed("box:board"));
  ctx.fillStyle = "rgb(232,232,232)";
  ctx.fillRect(0, 0, size, size);
  const wraps = [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size], [size, size], [-size, -size], [size, -size], [-size, size]];
  const blob = (x: number, y: number, rad: number, light: boolean, alpha: number): void => {
    for (const [ox, oy] of wraps) {
      const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
      const col = light ? "255,255,255" : "0,0,0";
      g.addColorStop(0, `rgba(${col},${alpha})`);
      g.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
    }
  };
  // Macro: broad, faint mottling.
  for (let i = 0; i < 40; i++) blob(r() * size, r() * size, 60 + r() * 120, r() > 0.5, 0.05);
  // Meso: fibre clumps.
  for (let i = 0; i < 700; i++) blob(r() * size, r() * size, 3 + r() * 8, r() > 0.5, 0.06);
  // Fibres: short strokes, mostly along one direction (board is laid one way).
  for (let f = 0; f < 1100; f++) {
    const x = r() * size;
    const y = r() * size;
    const len = 4 + r() * 14;
    const a = (r() - 0.5) * 0.9;
    ctx.strokeStyle = r() > 0.5 ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)";
    ctx.lineWidth = 0.6 + r() * 0.6;
    ctx.beginPath();
    for (const [ox, oy] of wraps) {
      ctx.moveTo(x + ox, y + oy);
      ctx.lineTo(x + ox + Math.cos(a) * len, y + oy + Math.sin(a) * len);
    }
    ctx.stroke();
  }
  // Micro: a fine tooth, per pixel (wraps by construction).
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * 14;
    img.data[i] = Math.max(0, Math.min(255, img.data[i] + n));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** The box: a warm charcoal board (LOOK.boxTone), satin, with the fibre texture as colour and a little relief. */
function boxMaterial(): THREE.MeshStandardMaterial {
  if (!boxMaterialCache) {
    // boxTone < 0 keeps the ink token; otherwise a warm charcoal of that sRGB level.
    const t = LOOK.boxTone;
    const color = t < 0 ? new THREE.Color(tokens().ink) : new THREE.Color().setRGB(t, t * 0.985, t * 0.95, THREE.SRGBColorSpace);
    const tex = LOOK.boxTexture > 0 ? boardTexture() : null;
    boxMaterialCache = new THREE.MeshStandardMaterial({ color, roughness: LOOK.boxRoughness, metalness: 0, envMapIntensity: LOOK.boxEnv, map: tex, bumpMap: tex, bumpScale: 0.6 * LOOK.boxTexture });
  }
  return boxMaterialCache;
}

/** Box-project UVs in object space, `perUnit` texture repeats per scene unit, so the texture keeps one scale on every face. */
function boxUV(geo: THREE.BufferGeometry, perUnit: number): void {
  const pos = geo.getAttribute("position");
  const nor = geo.getAttribute("normal");
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(nor.getX(i));
    const ay = Math.abs(nor.getY(i));
    const az = Math.abs(nor.getZ(i));
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const [a, b] = ax >= ay && ax >= az ? [z, y] : ay >= az ? [x, z] : [x, y];
    uv[i * 2] = a * perUnit;
    uv[i * 2 + 1] = b * perUnit;
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}

/**
 * The look's tuned values (.motion/04-lookdev). They are read once, before anything is built;
 * review builds (?review=1) may override them from the address for lookdev wedges (src/stage.ts).
 */
export const LOOK = {
  plasticRoughness: 0.6,
  plasticCoat: 0,
  boxRoughness: 0.4,
  boxEnv: 0.2,
  boxBevel: 0.012,
  boxTone: 0.26,
  boxTexture: 1,
};

/** Build the box with its inner floor running from z = `front` (positive, towards the viewer) back to z = `back`. */
export function buildBox(front: number, back: number): Box {
  const mat = boxMaterial();
  const { W, H, wall, floor: fl } = BOX;
  const r = LOOK.boxBevel;
  const L = front - back;
  const outerW = W + wall * 2;
  const outerL = L + wall * 2;
  const zc = (front + back) / 2;
  const part = (w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh => {
    const geo = r > 0 ? new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2.2, h / 2.2, d / 2.2)) : new THREE.BoxGeometry(w, h, d);
    boxUV(geo, 1.6);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };
  const group = new THREE.Group();
  group.add(
    part(outerW, fl, outerL, 0, -fl / 2, zc),
    part(wall, H, outerL, -(W + wall) / 2, H / 2, zc),
    part(wall, H, outerL, (W + wall) / 2, H / 2, zc),
    part(outerW, H * 0.9, wall, 0, (H * 0.9) / 2, front + wall / 2),
    part(outerW, H, wall, 0, H / 2, back - wall / 2),
  );
  return { group };
}
