# Direction v6: The Reader

**Request:** "review the website, perfect the motion, sizing, everything else etc. Essentially, get it polished, should be pretty fun!"

**Choices along the way, in the user's words:**
- Scope: "Desktop for now, honestly I'd show a please use the desktop site until then."
- Taking a disk out: "personally it should be when you click right?"
- The old README sheet: "Probably the slide out menu is a pain the way it behaves."
- The direction: "the original intention was the drive is inserted into the side panel … By that logic you'd imagine a screen." Then "Yeah D", and "I'd go docked too".
- The look: "v5 shouldn't of really made rules … Glow would be fine … the disks and box need to look slightly better and the room lighting needs improving too right?"
- Lookdev: "I'd add some slight movement to the screen since it's floating and some camera sway". Then: "Box should be one size, fairly large and needs to have some thicker looking boxy shape to it, and texture i think."
- Motion: "things need more weight and varied motion, slight micro things here and there". And "can we have sound on by default".
- At the first review: "the disk flies out of the tray very quickly and it's soooo fast … more on the stuff like satisfaction? like the disk is in the air, micro movements, when it clicks in it then slides in a bit slower". The reworked phrase: "Yeah that feels NICE, really nice. Almost REAL ha, yes love that." 

**Reading:**
- v5's paper, ink, type, figures and labels stay.
- What changes is the reading machine, the box, the room light and the motion. The README no longer slides out on a sheet over the page: it plays on a screen that stands beside the box, and the disk goes into that screen's drive.
- A disk comes out of the box only when you ask for it.

## The reader

- **Docked beside the box** on screens 1024 px and wider: `--reader-w: clamp(500px, 40vw, 880px)`, fixed to the right of the stage. The stage's field ends at the reader's slot.
- **A machine, not a panel.** It has a bezel, a drive slot with a light, a `1.44 MB` badge, and a screen.
  - **At rest** the screen is on dark standby (`--screen-standby: #252422`) and shows the box as points, one per disk, with the current disk lit, plus "No disk" and the count.
  - **When a disk is in**, the slot light comes on, the screen wakes to `--screen-on: #FBFAF6`, and the README is read on it.
  - The alternative paper idle screen (`--screen-off: #E1E0DC`) is kept behind `?review=1&look.screenOff=paper`.
- **The screen is a light.** A warm point light (`0xfff4e2`) stands just off the screen, beside the disk in your hand. Its intensity follows the drive (peak 120), so the box and the disk catch the screen's light as it wakes. A CSS glow was tried at every spread from 0 to 80 px and is invisible on light paper, so the glow is 0 and the light does that job.
- **The drive answers the disk.** The slot light flashes once as the latch catches the disk, then stays lit while the drive draws it in. Meanwhile the standby glass warms from `#252422` to `--screen-warm: #363532` over the 1.1 s slide, as if the drive is spinning up.
- **The wake** comes when the disk is seated. The screen fades from standby in 260 ms after an 80 ms delay, and the background crossfades over 320 ms. The light then blinks three even times and stays lit while you read.
- **It floats.** The reader drifts ±3 px vertically over 3.2 s and ±1.2 px sideways over 4.85 s. The two periods don't share a beat, so the path never visibly repeats. Both use an eased sine (`cubic-bezier(0.37, 0, 0.63, 1)`, alternate). The float fades out over 600 ms while a disk is held or read, so the screen is steady when you look at it. CSS `@property` registers the float variables so they animate.
- **Module:** `src/ui/reader.ts`, with its markup in `index.html` and its styles in `styles.css`.

## States

`src/state.ts` gains `held`, between the box and the reader:

| From | Input | To |
|---|---|---|
| settled, browsing | click the disk, or Enter | held: the disk comes out to your hand |
| held | click it, or Enter | open: into the reader |
| open | Esc, or Eject | held: the drive pops it back to your hand |
| held | Esc | settled: back in the box |
| held, open | flip (arrows, wheel on the box, drag) | browsing |

- **While open,** the reading keys belong to the screen:
  - Arrow Up and Arrow Down move 48 px;
  - Page Up, Page Down and Space (Shift+Space goes back) move 0.9 of the screen, smoothly;
  - Home and End jump straight there.
  - The wheel scrolls the README too. The left and right arrows still flip.
- **The title and caption stay up** while a disk is held or read on wide screens, because nothing covers them now.
- **The address** follows held as well as open.

## The box

- **One size.** The box is a fixed object, 10 slots in front of the gap and 12 behind, whatever the number of disks. It stands still and the disks glide through it. A disk past either end fades out as it goes. Fading avoids clipping: sinking disks showed through the floor and the transparent page.
- **Built thick.** `BOX` in `src/floppy.ts`:
  - 1.0 wide, sides 0.56 tall, front wall 0.9 of that;
  - walls 4.5 mm, floor 4 mm;
  - every part a `RoundedBoxGeometry` with 12 mm edges.
  
  The front wall stands just clear of the frontmost leaning disk: `(FRONT_VIS − 1) × GAP + wall × tan(lean) + 3 mm`. So it shows, and nothing passes through it.
- **Charcoal board.** A seeded, seamless 512 px canvas texture (`boardTexture()`, seed `box:board`): broad mottling, fibre clumps, fibres laid one way, and a fine tooth. It is used as colour and as a light bump (0.6). It is box-projected in the box's own space at one scale on every face (`boxUV`, 1.6 per unit), so it can't swim. The colour is warm charcoal, tone 0.26.

## Room and look

All values were chosen by wedges, each holding the scene, camera, exposure and tone mapping (three.js `NeutralToneMapping`, sRGB), and each pushed until it failed.

| Value | Where | Chosen | Fails at |
|---|---|---|---|
| Contact shadow | `ROOM.shadow` (a `ShadowMaterial` desk plane) | 0.22 | 0.35 reads as a grey floor |
| Key height | `ROOM.keyHeight` | 14 (shadow radius 8) | below 11 the shadow reads as a second object |
| Key warmth | `ROOM.keyWarm` | 0.04 towards `#ffd9a8` | not wedged; kept small |
| Screen light peak | `ROOM.screenLight` | 120 | 400 washes the labels to cream |
| Disk plastic | `LOOK.plasticRoughness`, `plasticCoat` | 0.6, no coat | 0.42 reads grey; 0.78 flattens the form |
| Box roughness | `LOOK.boxRoughness` | 0.4 | 0.25 looks like the disks' plastic |
| Box tone | `LOOK.boxTone` | 0.26 | 0.36 drifts brown |

## Framing

The camera is framed once for the one-size box. The box takes 24% of the stage at 70% down; the disk in your hand takes 30% at 41%. The disk is aimed at the reader's real slot, read from `[data-reader-slot]`.

A lens shift (`camera.filmOffset`, 0.18 of the half-height) moves the picture without turning the camera, so the box clears the caption. This was checked through the stage's projection at 1366 × 768, 1440 × 900, 1920 × 1080 and 2560 × 1440. The whole box is in frame at every size, and the box and the disk in your hand never touch.

## Motion

The flip springs and the gates' order are as in v4. The disk's own phrase was rebuilt after the first review (timing lock v2, tempo 0.85: `PHRASE_TEMPO` in `src/gates.ts`). Weight comes from resistance, carry and recovery, not from slowing everything down:
- **The grip.** Each move chases a critically damped lead (`lead` in `src/motion.ts`), so it starts at zero acceleration instead of being kicked. The disk is drawn up the snug slot, a short beat as it clears its neighbours, then carried over to your hand. It is in the hand at 1.43 s (it was 0.77 s), at about half the old peak speed.
- **A turn that lags.** The disk's rotation follows the carry as an attached follower (k 45, ratio 0.72): it lags by about 0.2 s and settles just past square.
- **Landing with mass.** A `land` spring (stiffness 200, ratio 0.5) tips the disk forward and drops it a touch as it arrives in the hand, and again when it comes back from the drive.
- **Life in the hand.** A slow roll (±0.7° over 6.1 s), yaw (±1.0° over 9.4 s), drift (±3 mm over 7.3 s) and breath (±5 mm over 4.2 s). The periods never line up, and each disk's phases are seeded by its name. It fades in once the disk is in the hand.
- **Into the drive in two stages.** The disk rolls onto its side and travels to the slot's mouth with 30% of it inside. The latch catches it: a click, the light, a hair of recoil and a 0.14 s hold. Then the drive draws it in slowly, at about a third of the approach's speed, and the README wakes when it is seated, about 2.4 s after Enter.
- **Out of the drive.** The drive's spring pushes the disk out with a little give past the mouth. After a beat, the hand takes it back as one carry, in 0.9 s. Esc mid-slide stops the disk dead and pushes it out the same way.
- **The way home stays quicker.** Put back is home in 0.65 s; exits lead, entries settle.
- **Follow-through.** When a disk goes back in, both neighbours take a small lean kick, as if they took its weight.
- **No two disks alike.** Each disk's lean stiffness (×0.85 to 1.15), lean damping ratio (0.5 to 0.62) and peek stiffness (×0.9 to 1.1) are seeded from its name. The box settles unevenly, and the same disk always settles the same way.
- **Camera sway.** Yaw ±0.12° over 8.3 s and pitch ±0.07° over 12.1 s, never in step. It eases to a quarter while reading and stops for reduced motion.
- **The arrival's fog** travels with the camera as the page comes in.
- **Reduced motion:** springs snap; there is no latch hold, no life in the hand, no sway, float or neighbour bump. The landing kick stays, because it is part of the event.

## Sound

On by default. Browsers won't play audio before a gesture, so the first click or key unlocks it, and nothing plays before that. "Sound off" is remembered.

Each cue fires in the frame of its event. The sound group's cue map at tempo 0.85 puts each one within its bound:
- **lift** and **shutter** start with the press, so both actions are answered at once; the shutter's snap lands as the shutter opens;
- **latch:** a firm click at the catch;
- **slide:** friction under the motor for the whole draw (1.3 × tempo), fading to the arrival;
- **seated:** the hub's clunk, then **seek**, the head reading;
- **eject** at the push, **drop** when a disk lands home, **tick** as disks pass the gap.

## Phones and tablets

`src/entry.ts` is the page's script now: it loads the font and the stylesheet, then decides.
- **Below 1024 px wide,** or on a device with no hover and a coarse pointer, it shows "Please use the desktop site" with a link to GitHub, and never loads the app or three.js. The app and three.js are split into their own chunks. There is no way past the notice.
- **A window that crosses the line** reloads into the other mode.

The notice marks the body with `data-desktop-only`. An earlier `data-notice` on the body also matched the notice's own selector and kept it hidden.

## Performance

- **The shadow map redraws only on frames where the scene moved.** The sway and the arrival move only the camera, which a shadow map does not depend on.
- **Rendering is at 1× with MSAA** on 1× displays and native 2× on 2× displays (capped at 2). Rendering at 2× on a 1× screen would cost four times the pixels for a faint gain.
- **Measured in a real browser** with the GPU, before the shadow change: median 16.7 ms a frame and p95 16.8 ms, idle and flipping, with no frame over 33 ms.

## Validation

- `pnpm build`, which type-checks.
- `simulate-gates.ts`, on v6's rule (a disk is out only while held or read) with the two-stage insert, at tempo 0.85: PASS on seven scenarios, results in `evidence/gate-simulation-v6.result.json`. Minimum clearance while turning is 0.021. Two disks are never out at once, a disk is drawn in only from the slot's mouth, and it leaves the mouth only once pushed out. The scenarios include an eject while the disk is still being drawn in, and re-taking a disk on its way home.
- `figure-check`: 24 passed.
- **Notice check in headless Chromium:** phone, tablet and a 900 px window show the notice and load neither `main` nor `three`; 1280 px loads the app.
- **The look against the lookdev frames:** the signature matches in every state and nothing in material, light or colour drifted. The glass warming during the slide is a declared exception.
- **The motion, measured on the review clock:** speeds, accelerations, spacing, follower lag and the event timeline at three tempos (0.85, 1.0, 1.25) before 0.85 was chosen and approved.
- **Interaction:** the state contract lints clean (12 states, 13 scenarios). Interruptions keep their state and nothing strands. The press is answered by sound on the first frame.
- **Layout:** the slot is centred on the disk going in, within 1 px, at 1366, 1920 and 2560. Every title in the 60-disk stress set clears the disk in your hand.

## Limits

- Desktop only. A phone layout is a later pass.
- **The browser composites the canvas over the paper in encoded sRGB, as CSS defines.** The shadow strength was chosen on that composited result.
- **At 1× pixel ratio, fine lines on the box can crawl slightly under the sway.**
- **The title reveal opens from the left** (it used to open centre-out, which showed the middle words first); its edge still slices the last visible glyph during its 0.3 s.
- **A 77-character name at 1366 × 768** needs three lines at the smallest title size and touches the disk in your hand by 16 px; real names are far shorter. A two-line clamp with an ellipsis is the fix if it ever matters.
- **During the roll at 1366,** the disk's corner briefly passes over the end of a very wide one-line title (about 0.1 s).
- **Not yet tested:** real displays other than the author's, and people other than the author.
