// Michael's ideal house, v3. From his drawings, corrected against two rounds
// of in-game edits (WorldEdit exports idealhouse-v2.json and idealhousev3.json).
//
// The big structural change in v3: the house, both 45-degree wings and the
// tower are now ONE footprint, and the walls are derived from that footprint's
// boundary. That is what he did by hand at the game-room junction, deleting the
// wing's end wall and running its side wall diagonally into the house wall. A
// boundary-derived shell does that everywhere, on both storeys, for free.
//
// v3 fixes, from his list and his export:
//   - ladders must be continuous      -> the deck cut the ladder; it is now
//     laid after the decks, with a stone pier behind it for the whole climb
//   - bookshelves invisible and janky -> dropped entirely
//   - remove the roof ridges          -> the two top courses meet, no ridge cap
//   - chimney topped by oak stairs    -> exactly his blocks and facings
//   - smoother wing junctions, ground -> one footprint, boundary walls, both floors
//   - tower banding and glazing       -> glass shaft, stone band, slate cornice
//   - railing variants                -> corner variants where the ring turns
//
//   node tools/gen-idealhouse.mjs      ->  examples/idealhouse3.txt
//   /build idealhouse3                 (stand on the front doorstep, face north)

import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let seed = 20260916;
function rnd() { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
const chance = (p) => rnd() < p;

// ── palette ──────────────────────────────────────────────────────────────
const WALL = 'planks-oak-ud';
const BEAM = 'log-placed-oak-ud';
const BEAM_WE = 'log-placed-oak-we';
const BEAM_NS = 'log-placed-oak-ns';
const FLOOR = 'planks-oak-we';
const FLOOR2 = 'planks-oak-ns';
const SLAB_UP = 'plankslab-oak-up-free';
const SLAB_DN = 'plankslab-oak-down-free';
const STONE = 'stonebricks-granite';
const COBBLE = 'cobblestone-granite';
const GLASS = 'glass-plain';
const PANE_IN_EW_WALL = 'glasspane-leaded-oak-ns';
const PANE_IN_NS_WALL = 'glasspane-leaded-oak-ew';
const ROOF_N = 'slantedroofing-slate-south-free';
const ROOF_S = 'slantedroofing-slate-north-free';
const ROOFBLOCK = 'stonebricks-slate';
const LADDER = 'ladder-wood-oak-north';
const AIR = 'air';

// ── model ────────────────────────────────────────────────────────────────
const M = new Map();      // structure, includes explicit air
const F = new Map();      // furniture, emitted last so nothing drops
const DIRECT = [];
const key = (x, y, z) => `${x},${y},${z}`;
const set = (x, y, z, c) => M.set(key(x | 0, y | 0, z | 0), c);
const get = (x, y, z) => M.get(key(x | 0, y | 0, z | 0));
const put = (x, y, z, c) => F.set(key(x | 0, y | 0, z | 0), c);
function box(x1, y1, z1, x2, y2, z2, c) {
  for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++)
    for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++)
      for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++) set(x, y, z, c);
}
const FOOT = new Map();
const claim = (x, z, top) => FOOT.set(`${x | 0},${z | 0}`, Math.max(FOOT.get(`${x | 0},${z | 0}`) ?? 0, top));

// ── geometry ─────────────────────────────────────────────────────────────
const MX1 = -24, MX2 = 24;
const MZ1 = -15, MZ2 = 0;
const G0 = 0, G1 = 6;
const U0 = 7, U1 = 13;
const CEIL = 14;
const RIDGE_ZN = -8, RIDGE_ZS = -7;
const BFLOOR = -9, BCEIL = -1;

// The wings run INTO the house far enough that both inner corners land inside
// the main footprint. That is what makes the junction one continuous diagonal
// wall instead of two walls meeting with a wedge of gap between them; the part
// of the wing inside the house is pure interior and grows no wall at all.
// Outer ends are unchanged from v2, so the wings look the same from outside.
// half is how far a wing reaches INTO the house and must stay at 15, because
// that is what lands both inner corners inside the main footprint and keeps the
// junction one continuous wall. halfOut is the outer end, and he pulled the
// game room's end wall one cell in before glazing it, so west stops at 14.5.
const WING = {
  west: { cx: -30, cz: 3, dx: -Math.SQRT1_2, dz: Math.SQRT1_2, half: 15, halfOut: 14.5, wide: 6 },
  east: { cx: 30, cz: 3, dx: Math.SQRT1_2, dz: Math.SQRT1_2, half: 15, halfOut: 15, wide: 6 },
};
const TOWER = { cx: 40, cz: 13, r: 5.6, top: 32, deck: 30, domeFrom: 33 };
const CHIM_X1 = 20, CHIM_X2 = 21, CHIM_Z1 = -11, CHIM_Z2 = -10, CHIM_TOP = CEIL + 11;

function wingLocal(w, x, z) {
  const px = x + 0.5 - w.cx, pz = z + 0.5 - w.cz;
  return { u: px * w.dx + pz * w.dz, v: -px * w.dz + pz * w.dx };
}
const inWing = (w, x, z) => { const { u, v } = wingLocal(w, x, z); return u >= -w.half && u <= w.halfOut && Math.abs(v) <= w.wide; };
const dist = (x, z, cx, cz) => Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
const inTower = (x, z) => dist(x, z, TOWER.cx, TOWER.cz) <= TOWER.r;
const towerWall = (x, z) => { const d = dist(x, z, TOWER.cx, TOWER.cz); return d > TOWER.r - 1 && d <= TOWER.r; };
const inMainFoot = (x, z) => x >= MX1 && x <= MX2 && z >= MZ1 && z <= MZ2;

// ONE footprint for the whole ground plan. Walls come from its boundary, so a
// wing running into the house makes a continuous diagonal wall with no stub.
const inside = (x, z) => inMainFoot(x, z) || inWing(WING.west, x, z) || inWing(WING.east, x, z) || inTower(x, z);
const isBoundary = (x, z) => inside(x, z) && (!inside(x + 1, z) || !inside(x - 1, z) || !inside(x, z + 1) || !inside(x, z - 1));

const BB = { x1: -50, x2: 52, z1: -20, z2: 24 };

// ════════════════════════════════════════════════════ 1. SHELL
function shell() {
  for (let x = BB.x1; x <= BB.x2; x++)
    for (let z = BB.z1; z <= BB.z2; z++) {
      if (!inside(x, z)) continue;
      claim(x, z, CEIL + 2);
      set(x, G0, z, FLOOR);
      set(x, U0, z, FLOOR2);
      set(x, CEIL, z, WALL);
      // he filled the whole underside solid rather than leaving a void under
      // the wing floors, so the foundation is a slab, not a ring of footings
      box(x, -5, z, x, G0 - 1, z, STONE);
      if (isBoundary(x, z)) {
        box(x, G0 + 1, z, x, G1, z, WALL);
        box(x, U0 + 1, z, x, U1, z, WALL);
      } else {
        box(x, G0 + 1, z, x, G1, z, AIR);
        box(x, U0 + 1, z, x, U1, z, AIR);
      }
      // stone skirt one block proud of the shell
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]])
        if (!inside(x + dx, z + dz)) { set(x + dx, G0, z + dz, STONE); claim(x + dx, z + dz, 1); }
    }
  // corner posts on the straight main-block walls, between the window bays
  for (const x of [MX1, MX2, -13, -4, 3, 12])
    for (const z of [MZ1, MZ2])
      if (isBoundary(x, z)) { box(x, G0 + 1, z, x, G1, z, BEAM); box(x, U0 + 1, z, x, U1, z, BEAM); }
  for (let x = MX1; x <= MX2; x++) for (const z of [MZ1, MZ2]) if (isBoundary(x, z)) set(x, U0, z, BEAM_WE);
  for (let z = MZ1; z <= MZ2; z++) for (const x of [MX1, MX2]) if (isBoundary(x, z)) set(x, U0, z, BEAM_NS);
}

function basement() {
  box(MX1 + 1, BFLOOR + 1, MZ1 + 1, MX2 - 1, BCEIL - 1, MZ2 - 1, AIR);
  box(MX1, BFLOOR, MZ1, MX2, BFLOOR, MZ2, STONE);
  for (let y = BFLOOR + 1; y <= BCEIL - 1; y++) {
    for (let x = MX1; x <= MX2; x++) { set(x, y, MZ1, STONE); set(x, y, MZ2, STONE); }
    for (let z = MZ1; z <= MZ2; z++) { set(MX1, y, z, STONE); set(MX2, y, z, STONE); }
  }
  box(MX1, BCEIL, MZ1, MX2, BCEIL, MZ2, STONE);
  for (let x = -16; x <= 16; x += 8)
    for (let z = -11; z <= -4; z += 7) box(x, BFLOOR + 1, z, x, BCEIL - 1, z, COBBLE);
}

function openingsAndStairs() {
  // windows: two-wide bays on a five block rhythm, mirrored about x = -0.5
  const FRONT_BAYS = [];
  for (let k = 0; k < 4; k++) { FRONT_BAYS.push(5 + 5 * k); FRONT_BAYS.push(-7 - 5 * k); }
  const BACK_BAYS = [-1, ...FRONT_BAYS];
  const SIDE_BAYS = [-13];                       // he deleted the z -8 bay
  const bay = (x, z, y0) => { if (isBoundary(x, z)) box(x, y0 + 2, z, x + 1, y0 + 4, z, PANE_IN_EW_WALL); };
  for (const bx of FRONT_BAYS) { bay(bx, MZ2, G0); bay(bx, MZ2, U0); }
  for (const bx of BACK_BAYS) { bay(bx, MZ1, G0); bay(bx, MZ1, U0); }
  for (const bz of SIDE_BAYS)
    for (const x of [MX1, MX2]) {
      box(x, G0 + 2, bz, x, G0 + 4, bz + 1, PANE_IN_NS_WALL);
      box(x, U0 + 2, bz, x, U0 + 4, bz + 1, PANE_IN_NS_WALL);
    }

  // Wing glazing. The wings are meant to read as glass halls: most of each long
  // wall is window on BOTH storeys, broken by a plank pier every fourth cell and
  // by a solid cell at each corner, with a sill course under and a head course
  // over so the roof still lands on timber.
  const wingWall = (w, side) => {
    const out = [];
    for (let x = BB.x1; x <= BB.x2; x++)
      for (let z = BB.z1; z <= BB.z2; z++) {
        if (!inWing(w, x, z) || !isBoundary(x, z)) continue;
        const { u, v } = wingLocal(w, x, z);
        if (Math.abs(v) < w.wide - 1 || (v > 0 ? 1 : -1) !== side) continue;
        out.push({ x, z, u });
      }
    return out.sort((a, b) => a.u - b.u);
  };
  for (const w of [WING.west, WING.east])
    for (const side of [-1, 1]) {
      const wall = wingWall(w, side);
      wall.forEach((c, i) => {
        if (i === 0 || i === wall.length - 1 || i % 4 === 0) return;   // corner, or a pier
        for (const y0 of [G0, U0])
          for (let y = y0 + 2; y <= y0 + 5; y++) if (get(c.x, y, c.z) === WALL) set(c.x, y, c.z, GLASS);
      });
    }

  // The game room's end wall: one six wide, four tall window on EACH storey,
  // everything but the two corner cells. The end wall cells are the only
  // boundary cells out there with |v| under 5; the long walls start at 5.
  {
    const w = WING.west, end = [];
    for (let x = BB.x1; x <= BB.x2; x++)
      for (let z = BB.z1; z <= BB.z2; z++) {
        if (!inWing(w, x, z) || !isBoundary(x, z)) continue;
        const { u, v } = wingLocal(w, x, z);
        if (u < w.halfOut - 1 || Math.abs(v) >= w.wide - 1) continue;
        end.push({ x, z, v });
      }
    end.sort((a, b) => a.v - b.v);
    for (const c of end.slice(1, -1))
      for (const y0 of [G0, U0])
        for (let y = y0 + 2; y <= y0 + 5; y++) if (get(c.x, y, c.z) === WALL) set(c.x, y, c.z, GLASS);
  }

  // front door and the porch posts that carry the balcony
  box(-1, G0 + 1, MZ2, 0, G0 + 3, MZ2, AIR);
  box(-2, G0, MZ2 + 1, 1, G0, MZ2 + 3, STONE);
  for (let x = -2; x <= 1; x++) for (let z = MZ2 + 1; z <= MZ2 + 3; z++) claim(x, z, 1);
  for (const x of [-4, 3]) { box(x, G0 + 1, MZ2 + 3, x, U0 - 1, MZ2 + 3, BEAM); claim(x, MZ2 + 3, U0 + 3); }

  // staircases against the back wall
  const ZA = -13, ZB = -12;
  const stair = (x0, dx, y0, dy, steps, tread) => {
    for (let i = 0; i < steps; i++) {
      const x = x0 + dx * i, y = y0 + dy * i;
      box(x, y, ZA, x, y, ZB, tread);
      box(x, y + 1, ZA, x, y + 3, ZB, AIR);
    }
  };
  box(-5, G0 + 1, ZA, 3, U1, ZB, AIR);
  box(5, BFLOOR + 1, ZA, 14, G1, ZB, AIR);
  stair(-4, 1, G0 + 1, 1, 7, WALL);
  stair(5, 1, G0 - 1, -1, 9, STONE);
}

// ════════════════════════════════════════════════════ 2. TOWER
const RAIL = [];

// Every wall cell of the shaft, in order around the circle. The banding, the
// mullions and the openings under the dome are all expressed against this list.
const TOWER_RING = (() => {
  const { cx, cz, r } = TOWER, out = [];
  for (let x = Math.floor(cx - r - 2); x <= Math.ceil(cx + r + 2); x++)
    for (let z = Math.floor(cz - r - 2); z <= Math.ceil(cz + r + 2); z++)
      if (towerWall(x, z)) out.push({ x, z, a: Math.atan2(z + 0.5 - cz, x + 0.5 - cx) });
  return out.sort((p, q) => p.a - q.a);
})();

// Granite mullions between the ground floor windows, and the four two-wide
// openings he left in the drum below the dome: both copied cell for cell from
// his export. They are tied to the tower's exact radius, so if that ever moves
// this throws instead of quietly putting a pier in the middle of a window.
const MULLIONS = [[44, 10], [44, 11], [44, 14], [41, 17], [38, 17], [37, 17]];
const DRUM_GAPS = [[39, 7], [40, 7], [45, 12], [45, 13], [39, 18], [40, 18], [34, 12], [34, 13]];
for (const [mx, mz] of [...MULLIONS, ...DRUM_GAPS])
  if (!TOWER_RING.some((c) => c.x === mx && c.z === mz))
    throw new Error('tower geometry moved: ' + mx + ',' + mz + ' is no longer a shaft wall cell');

function tower() {
  const { cx, cz, r, top, deck, domeFrom } = TOWER;
  const x0 = Math.floor(cx - r - 5), x1 = Math.ceil(cx + r + 5);
  const z0 = Math.floor(cz - r - 5), z1 = Math.ceil(cz + r + 5);
  const DECKS = [U0, 16, 23, deck];
  const lx = Math.round(cx), lz = Math.round(cz - r + 1);

  // Where the library wing runs into the shaft the wall opens for the FULL
  // height of both storeys. v3 opened only four courses, which is why the rest
  // of the glass was left hanging off the ceiling with nothing under it.
  const junction = (x, z) =>
    inWing(WING.east, x, z) && Math.abs(wingLocal(WING.east, x, z).v) <= WING.east.wide - 1.5;
  const isMullion = (x, z) => MULLIONS.some(([mx, mz]) => mx === x && mz === z);

  // his banding, read off the export course by course
  const mat = (y) => {
    if (y <= 1) return STONE;
    if (y <= 5) return GLASS;              // ground floor windows
    if (y <= 7) return STONE;              // solid head, then the second floor line
    if (y === 8) return BEAM;              // the wooden band he asked for at the
    if (y <= 13) return GLASS;             //   base, so glass never reaches the floor
    if (y === 14) return STONE;
    if (y === 15) return ROOFBLOCK;        // slate cornice
    if (y === 16 || y === 24) return BEAM; // the same band on the floors above
    return GLASS;
  };

  // Ground floor glazing runs y2..y4 between the mullions. At y5 only the bays
  // two or more cells wide stay glass, so a one-cell gap reads as a pier rather
  // than a slot, which is how he left it.
  const n = TOWER_RING.length;
  const glazed = TOWER_RING.map((c) =>
    !isMullion(c.x, c.z) && !junction(c.x, c.z) && !(c.x === lx && c.z === lz - 1));
  const bayWidth = new Array(n).fill(0);
  const from = glazed.indexOf(false);
  if (from < 0) throw new Error('tower ring has no pier at all, the bay walk would never end');
  for (let i = 0; i < n;) {
    if (!glazed[(from + i) % n]) { i++; continue; }
    let len = 0;
    while (len < n && glazed[(from + i + len) % n]) len++;
    for (let k = 0; k < len; k++) bayWidth[(from + i + k) % n] = len;
    i += len;
  }

  // shaft interior and floors
  for (let x = x0; x <= x1; x++)
    for (let z = z0; z <= z1; z++) {
      if (!inTower(x, z)) continue;
      claim(x, z, domeFrom + 10);
      box(x, -5, z, x, G0 - 1, z, STONE);
      set(x, G0, z, FLOOR);
      if (towerWall(x, z)) continue;
      for (let y = G0 + 1; y <= top; y++) set(x, y, z, AIR);
      for (const fy of DECKS) set(x, fy, z, FLOOR2);
    }

  // the wall
  TOWER_RING.forEach((c, i) => {
    for (let y = G0 + 1; y <= top; y++) {
      let m = mat(y);
      if (y >= 2 && y <= 5 && isMullion(c.x, c.z)) m = STONE;
      if (y === 5 && glazed[i] && bayWidth[i] < 2) m = STONE;
      set(c.x, y, c.z, m);
    }
  });

  // the library wing junction, both storeys, floor to ceiling and through the
  // cornice. y7 stays solid because that course is the second floor's own edge.
  for (const c of TOWER_RING) {
    if (!junction(c.x, c.z)) continue;
    box(c.x, G0 + 1, c.z, c.x, G1, c.z, AIR);
    box(c.x, U0 + 1, c.z, c.x, CEIL + 1, c.z, AIR);
  }

  // ── ladder ──
  // v2 cut the ladder at every deck. Lay the decks first, then run the ladder
  // straight through them, and give it a solid pier to hang on all the way up.
  for (let y = G0 + 1; y <= deck; y++) {
    set(lx, y, lz - 1, STONE);          // backing the ladder attaches to
    set(lx, y, lz, LADDER);             // continuous, no gaps
  }
  set(lx, G0, lz, FLOOR);

  // ── balcony ──
  // The deck is a rasterised disk and the fence is its outer boundary. That
  // boundary steps diagonally in four places, which is where his fence broke,
  // so every diagonal step is closed by adding the cell OUTSIDE the deck that
  // joins the two. That is exactly the one-cell widening he made by hand at the
  // four cardinal points, and it leaves a ring that is 4-connected the whole way
  // round, so every post has two square neighbours and the fence never breaks.
  const WALK = deck, OUT = r + 3;
  const k2 = (x, z) => x + ',' + z;
  const deckSet = new Set(), ringSet = new Set();
  for (let x = x0 - 4; x <= x1 + 4; x++)
    for (let z = z0 - 4; z <= z1 + 4; z++)
      if (dist(x, z, cx, cz) <= OUT) deckSet.add(k2(x, z));
  for (const k of deckSet) {
    const [x, z] = k.split(',').map(Number);
    if (!deckSet.has(k2(x + 1, z)) || !deckSet.has(k2(x - 1, z)) ||
        !deckSet.has(k2(x, z + 1)) || !deckSet.has(k2(x, z - 1))) ringSet.add(k);
  }
  for (let pass = 0; pass < 4; pass++)
    for (const k of [...ringSet]) {
      const [x, z] = k.split(',').map(Number);
      for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        if (!ringSet.has(k2(x + dx, z + dz))) continue;
        if (ringSet.has(k2(x + dx, z)) || ringSet.has(k2(x, z + dz))) continue;
        const a = k2(x + dx, z), b = k2(x, z + dz);
        const add = deckSet.has(a) ? b : a;
        deckSet.add(add); ringSet.add(add);
      }
    }
  for (const k of deckSet) {
    const [x, z] = k.split(',').map(Number);
    if (dist(x, z, cx, cz) <= r - 0.5) continue;   // that is the shaft's own floor
    set(x, WALK, z, FLOOR2);
    set(x, WALK - 1, z, SLAB_DN);
    // headroom over the walkway only. Clearing it over the shaft wall too is
    // what cut the drum into a comb of gaps in v3.
    if (!towerWall(x, z)) box(x, WALK + 1, z, x, WALK + 2, z, AIR);
    claim(x, z, WALK + 4);
  }
  for (const k of ringSet) {
    const [x, z] = k.split(',').map(Number);
    RAIL.push([x, WALK + 1, z]);
  }

  // The drum between the deck and the dome is sealed apart from four two-wide
  // openings on the cardinal points; the south one is the way out onto the
  // balcony. v3 left it as a comb of alternating gaps.
  for (const [gx, gz] of DRUM_GAPS) { set(gx, WALK + 1, gz, AIR); set(gx, WALK + 2, gz, AIR); }

  const profile = [r + 0.8, r + 1.0, r + 0.9, r + 0.5, r - 0.4, r - 1.6, r - 2.8, r - 4.0];
  for (let i = 0; i < profile.length; i++) {
    const rr = profile[i], y = domeFrom + i;
    for (let x = x0 - 2; x <= x1 + 2; x++)
      for (let z = z0 - 2; z <= z1 + 2; z++) {
        const d = dist(x, z, cx, cz);
        if (d <= rr && d > rr - 1.2) { set(x, y, z, GLASS); claim(x, z, y + 2); }
        else if (d <= rr - 1.2 && i === profile.length - 1) { set(x, y, z, GLASS); claim(x, z, y + 2); }
      }
  }
  set(Math.round(cx), domeFrom + profile.length, Math.round(cz), BEAM);
  claim(Math.round(cx), Math.round(cz), domeFrom + profile.length + 3);
}

// ════════════════════════════════════════════════════ 3. ROOFS
function mainRoof() {
  const COURSES = RIDGE_ZN - MZ1 + 1;
  for (let i = 0; i < COURSES; i++) {
    const y = CEIL + 1 + i;
    const zN = MZ1 + i, zS = MZ2 - i;
    for (let x = MX1 - 1; x <= MX2 + 1; x++) {
      set(x, y, zN, ROOF_N); claim(x, zN, y + 1);
      set(x, y, zS, ROOF_S); claim(x, zS, y + 1);
      for (let z = zN + 1; z <= zS - 1; z++) {
        if (x === MX1 - 1 || x === MX2 + 1) { set(x, y, z, WALL); claim(x, z, y + 1); }
        else if (get(x, y, z) === undefined) { set(x, y, z, AIR); claim(x, z, y + 1); }
      }
    }
  }
  // no ridge course: he removed every one of them, the two top slopes meet

  // chimney, capped with his oak stairs
  box(CHIM_X1, CEIL, CHIM_Z1, CHIM_X2, CHIM_TOP, CHIM_Z2, COBBLE);
  for (let x = CHIM_X1; x <= CHIM_X2; x++) {
    set(x, CHIM_TOP + 1, CHIM_Z1, 'plankstairs-oak-down-south-free');
    set(x, CHIM_TOP + 1, CHIM_Z2, 'plankstairs-oak-down-north-free');
    for (let z = CHIM_Z1; z <= CHIM_Z2; z++) claim(x, z, CHIM_TOP + 3);
  }
}

function wingRoofs() {
  for (const w of [WING.west, WING.east]) {
    const x0 = Math.floor(w.cx - w.half - w.wide - 3), x1 = Math.ceil(w.cx + w.half + w.wide + 3);
    const z0 = Math.floor(w.cz - w.half - w.wide - 3), z1 = Math.ceil(w.cz + w.half + w.wide + 3);
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        if (!inWing(w, x, z) || inTower(x, z)) continue;
        // deep inside the house the main gable already covers it
        if (x >= MX1 + 4 && x <= MX2 - 4 && z >= MZ1 + 4 && z <= MZ2 - 4) continue;
        const { v } = wingLocal(w, x, z);
        let top = CEIL + Math.max(0, Math.round((w.wide - Math.abs(v)) * 0.8));
        if (inMainFoot(x, z)) top = Math.max(top, CEIL + 1 + (z <= RIDGE_ZN ? z - MZ1 : MZ2 - z));
        for (let y = CEIL + 1; y <= top; y++) { const c = get(x, y, z); if (c === undefined || c === AIR) set(x, y, z, ROOFBLOCK); }
        claim(x, z, top + 2);
      }
  }
}

// ════════════════════════════════════════════════════ 4. FURNISH
function furnish() {
  const wallLantern = (x, y, z) => { set(x, y + 1, z, SLAB_DN); put(x, y, z, 'lantern-small-down'); };
  const ceilingLight = (x, ceilY, z) => { const c = get(x, ceilY, z); if (c && c !== AIR) put(x, ceilY - 1, z, 'chandelier-candle4'); };

  // kitchen, east end
  put(17, G0 + 1, -12, 'firepit-cold'); put(19, G0 + 1, -12, 'firepit-cold');
  put(15, G0 + 1, -12, 'quern-granite');
  for (let x = 12; x <= 22; x += 2) put(x, G0 + 1, -14, 'shelf-normal-north');
  for (let x = 11; x <= 23; x += 2) put(x, G0 + 1, -2, 'barrel');
  for (let x = 10; x <= 15; x++) put(x, G0 + 1, -7, 'table-normal');
  for (const x of [10, 12, 14]) put(x, G0 + 1, -6, 'chair-brown');
  for (const x of [11, 13, 15]) put(x, G0 + 1, -8, 'chair-brown');
  for (const x of [20, 21, 22]) put(x, G0 + 1, -4, 'chest-north');
  put(23, G0 + 1, -14, 'crate'); put(22, G0 + 1, -14, 'crate');

  // relic room and museum, west end (no bookshelves anywhere in v3)
  for (let x = -22; x <= -11; x += 3) { put(x, G0 + 1, -14, 'displaycase-generic'); put(x + 1, G0 + 1, -14, 'displaycase-generic'); }
  put(-18, G0 + 1, -7, 'table-normal'); put(-18, G0 + 1, -6, 'chair-brown');
  put(-13, G0 + 1, -7, 'omoktabletop');
  DIRECT.push(`translocator ~-6 ~${G0 + 1} ~-12 north`);
  DIRECT.push(`translocator ~-9 ~${G0 + 1} ~-12 north`);

  // upper floor
  put(-7, U0 + 1, -5, 'bed-wood-head-north'); put(-7, U0 + 1, -4, 'bed-wood-feet-north');
  put(-5, U0 + 1, -5, 'bed-wood-head-north'); put(-5, U0 + 1, -4, 'bed-wood-feet-north');
  put(-9, U0 + 1, -5, 'mannequin-reed-complete');
  for (const x of [-12, -13]) put(x, U0 + 1, -2, 'chest-north');
  put(-17, U0 + 1, -13, 'table-normal'); put(-17, U0 + 1, -12, 'chair-brown');
  put(17, U0 + 1, -13, 'table-normal'); put(17, U0 + 1, -12, 'chair-brown');
  put(21, U0 + 1, -14, 'displaycase-generic');   // 20 is one of his bookshelves now

  box(-4, U0, MZ2 + 1, 3, U0, MZ2 + 3, FLOOR2);
  for (let x = -4; x <= 3; x++) for (let z = MZ2 + 1; z <= MZ2 + 3; z++) claim(x, z, U0 + 3);
  box(-1, U0 + 1, MZ2, 0, U0 + 3, MZ2, AIR);
  for (let x = -4; x <= 3; x++) RAIL.push([x, U0 + 1, MZ2 + 3]);
  for (let z = MZ2 + 1; z <= MZ2 + 3; z++) { RAIL.push([-4, U0 + 1, z]); RAIL.push([3, U0 + 1, z]); }

  // basement laboratory
  for (let x = -20; x <= 20; x += 5) { put(x, BFLOOR + 1, -13, 'displaycase-generic'); put(x, BFLOOR + 1, -2, 'barrel'); }
  for (let x = -7; x <= 7; x += 2) put(x, BFLOOR + 1, -7, 'table-normal');
  put(-9, BFLOOR + 1, -7, 'forge'); put(-11, BFLOOR + 1, -7, 'anvil-iron');
  for (let x = 9; x <= 19; x += 2) put(x, BFLOOR + 1, -4, 'chest-north');
  for (let x = -18; x <= 18; x += 6) { wallLantern(x, BFLOOR + 3, MZ1 + 1); wallLantern(x, BFLOOR + 3, MZ2 - 1); }

  for (let x = -20; x <= 20; x += 8) { ceilingLight(x, U0, -4); ceilingLight(x, U0, -11); ceilingLight(x, CEIL, -7); }
  for (let x = -20; x <= 20; x += 10) { wallLantern(x, G0 + 3, MZ1 + 1); wallLantern(x, G0 + 3, MZ2 - 1); }

  // game room wing
  const w = WING.west;
  for (let t = -8; t <= 8; t += 5) {
    const gx = Math.round(w.cx + w.dx * t), gz = Math.round(w.cz + w.dz * t);
    put(gx, G0 + 1, gz, 'omoktabletop');
    put(gx + 1, G0 + 1, gz, 'chair-brown'); put(gx - 1, G0 + 1, gz, 'chair-brown');
    ceilingLight(gx, U0, gz); ceilingLight(gx, CEIL, gz);
    put(gx, U0 + 1, gz, 'table-normal');
  }

  // library wing: tables and cases instead of the broken bookshelves
  const e = WING.east;
  for (let t = -10; t <= 10; t += 2) {
    for (const side of [-1, 1]) {
      const bx = Math.round(e.cx + e.dx * t - e.dz * side * (e.wide - 1));
      const bz = Math.round(e.cz + e.dz * t + e.dx * side * (e.wide - 1));
      if (get(bx, G0 + 1, bz) === AIR && chance(0.5)) put(bx, G0 + 1, bz, 'displaycase-generic');
    }
    const cx2 = Math.round(e.cx + e.dx * t), cz2 = Math.round(e.cz + e.dz * t);
    if (t % 4 === 0) { put(cx2, G0 + 1, cz2, 'table-normal'); ceilingLight(cx2, U0, cz2); ceilingLight(cx2, CEIL, cz2); }
  }
  for (const fy of [16, 23, TOWER.deck]) {
    put(Math.round(TOWER.cx) + 3, fy + 1, Math.round(TOWER.cz), 'table-normal');
    put(Math.round(TOWER.cx) + 3, fy + 1, Math.round(TOWER.cz) + 1, 'chair-brown');
  }

  // v3 dug a high fertility bed at x -42..-30, z -15..-5, but the west wing
  // sweeps through its corner, so the plot cut a hole in the game room floor.
  // Dropped entirely; shell() lays the floor over the whole footprint anyway.

  // Bookshelves are back. v2 used `bookshelf`, which is class BlockBookshelf
  // and renders as a question mark without the block entity a script cannot
  // give it; `clutteredbookshelf` has no such requirement, and he placed these
  // himself in the export to prove it.
  const SHELF = 'clutteredbookshelf', LORE = 'clutteredbookshelfwithlore';
  for (const [bx, by, bz, kind] of [
    [-19, U0 + 1, -13, SHELF],
    [-17, G0 + 1, -2, LORE], [-16, G0 + 1, -2, SHELF], [-14, G0 + 1, -2, SHELF],
    [-13, G0 + 1, -2, SHELF], [-12, G0 + 1, -2, SHELF],
    [10, U0 + 1, -14, SHELF], [12, U0 + 1, -14, LORE], [14, U0 + 1, -14, SHELF],
    [16, U0 + 1, -14, SHELF], [18, U0 + 1, -14, SHELF], [19, U0 + 1, -13, SHELF],
    [20, U0 + 1, -14, SHELF], [22, U0 + 1, -14, SHELF],
    [28, U0 + 1, -6, SHELF],
    [31, G0 + 1, 11, LORE], [31, G0 + 2, 11, LORE],
    [37, 17, 13, SHELF], [37, 24, 13, SHELF],
  ]) put(bx, by, bz, kind);
}

// ════════════════════════════════════════════════════ build
shell();
basement();
openingsAndStairs();
tower();
mainRoof();
wingRoofs();
furnish();

// railings. A ring rasterised from a circle steps diagonally, so a cell whose
// only neighbour is diagonal gets the CORNER variant that turns toward it,
// which is exactly what he hand-corrected in v3.
const railSet = new Set(RAIL.map(([x, y, z]) => key(x, y, z)));
const DIRS = [['n', 0, -1], ['e', 1, 0], ['s', 0, 1], ['w', -1, 0]];
for (const [x, y, z] of RAIL) {
  const conn = DIRS.filter(([, dx, dz]) => railSet.has(key(x + dx, y, z + dz))).map(([d]) => d);
  if (conn.length < 2) {
    for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      if (conn.length >= 2) break;
      if (!railSet.has(key(x + dx, y, z + dz))) continue;
      const nsUsed = conn.includes('n') || conn.includes('s');
      const ewUsed = conn.includes('e') || conn.includes('w');
      if (!nsUsed) conn.push(dz < 0 ? 'n' : 's');
      else if (!ewUsed) conn.push(dx > 0 ? 'e' : 'w');
    }
  }
  const order = ['n', 'e', 's', 'w'].filter((d) => conn.includes(d));
  put(x, y, z, `woodenfence-oak-${order.length ? order.join('') : 'empty'}-free`);
  claim(x, z, y + 2);
}

for (const k of M.keys()) { const [x, y, z] = k.split(',').map(Number); if (y >= 0) claim(x, z, y + 1); }
for (const [k, top] of FOOT) {
  const [x, z] = k.split(',').map(Number);
  for (let y = 1; y <= top; y++) if (!M.has(key(x, y, z))) set(x, y, z, AIR);
}

// ── emit ─────────────────────────────────────────────────────────────────
const t = (n) => '~' + (n === 0 ? '' : n);
function emit(map, filter) {
  const lines = [], done = new Set();
  const cells = [...map.entries()].filter(([, c]) => filter(c))
    .map(([k, c]) => { const [x, y, z] = k.split(',').map(Number); return { x, y, z, c, k }; })
    .sort((a, b) => a.y - b.y || a.z - b.z || a.x - b.x);
  for (const cell of cells) {
    if (done.has(cell.k)) continue;
    const { x, y, z, c } = cell;
    let x2 = x; while (map.get(key(x2 + 1, y, z)) === c && !done.has(key(x2 + 1, y, z))) x2++;
    let z2 = z;
    outerZ: while (true) {
      for (let xi = x; xi <= x2; xi++) { const kk = key(xi, y, z2 + 1); if (map.get(kk) !== c || done.has(kk)) break outerZ; }
      z2++;
    }
    let y2 = y;
    outerY: while (true) {
      for (let xi = x; xi <= x2; xi++) for (let zi = z; zi <= z2; zi++) { const kk = key(xi, y2 + 1, zi); if (map.get(kk) !== c || done.has(kk)) break outerY; }
      y2++;
    }
    for (let xi = x; xi <= x2; xi++) for (let yi = y; yi <= y2; yi++) for (let zi = z; zi <= z2; zi++) done.add(key(xi, yi, zi));
    lines.push(x === x2 && y === y2 && z === z2
      ? `setblock ${t(x)} ${t(y)} ${t(z)} ${c}`
      : `fill ${t(x)} ${t(y)} ${t(z)} ${t(x2)} ${t(y2)} ${t(z2)} ${c}`);
  }
  return lines;
}

const airLines = emit(M, (c) => c === AIR);
const solidLines = emit(M, (c) => c !== AIR);
const furnLines = emit(F, () => true);
const all = [
  "# Michael's ideal house, v4. Stand on the front doorstep, face NORTH, then /build idealhouse4",
  '# House, both wings and the tower are one footprint, so the junctions are continuous',
  '# walls on both storeys. v4: continuous balcony fence, banded tower with a wooden band',
  '# at each floor, drum sealed but for four openings, big window in the game room end,',
  '# solid foundation, no raised bed cutting the floor. Needs Building Commands 0.8.0.',
  '',
  '# Which way the build faces as written, so /build idealhouse4 north can turn it.',
  'facing south',
  '', '# --- clear the volume ---', ...airLines,
  '', '# --- structure ---', ...solidLines,
  '', '# --- furniture, placed last so nothing is dropped for want of support ---', ...furnLines,
  ...(DIRECT.length ? ['', '# --- repaired translocators ---', ...DIRECT] : []),
];

writeFileSync(join(root, 'examples', 'idealhouse4.txt'), all.join('\n'));
const solids = [...M.values()].filter((c) => c !== AIR).length;
console.log(`idealhouse4.txt: ${all.length} lines (${airLines.length} clear + ${solidLines.length} build + ${furnLines.length} furniture), ${solids + F.size} blocks`);
