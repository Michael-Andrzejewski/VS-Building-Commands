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
const WING = {
  west: { cx: -30, cz: 3, dx: -Math.SQRT1_2, dz: Math.SQRT1_2, half: 15, wide: 6 },
  east: { cx: 30, cz: 3, dx: Math.SQRT1_2, dz: Math.SQRT1_2, half: 15, wide: 6 },
};
const TOWER = { cx: 40, cz: 13, r: 5.6, top: 32, deck: 30, domeFrom: 33 };
const CHIM_X1 = 20, CHIM_X2 = 21, CHIM_Z1 = -11, CHIM_Z2 = -10, CHIM_TOP = CEIL + 11;

function wingLocal(w, x, z) {
  const px = x + 0.5 - w.cx, pz = z + 0.5 - w.cz;
  return { u: px * w.dx + pz * w.dz, v: -px * w.dz + pz * w.dx };
}
const inWing = (w, x, z) => { const { u, v } = wingLocal(w, x, z); return Math.abs(u) <= w.half && Math.abs(v) <= w.wide; };
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
      if (isBoundary(x, z)) {
        box(x, G0 + 1, z, x, G1, z, WALL);
        box(x, U0 + 1, z, x, U1, z, WALL);
        box(x, -4, z, x, G0 - 1, z, STONE);          // footing under the wall
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

  // wing glazing: he replaced plank walls with glass, so glaze half of each
  // long side on both storeys
  for (const w of [WING.west, WING.east])
    for (let x = BB.x1; x <= BB.x2; x++)
      for (let z = BB.z1; z <= BB.z2; z++) {
        if (!inWing(w, x, z) || !isBoundary(x, z)) continue;
        const { u, v } = wingLocal(w, x, z);
        if (Math.abs(v) < w.wide - 1 || Math.abs(u) > w.half - 2) continue;
        if (((Math.round(u) % 4) + 4) % 4 > 1) continue;
        for (let y = G0 + 2; y <= G0 + 5; y++) if (get(x, y, z) === WALL) set(x, y, z, GLASS);
        for (let y = U0 + 2; y <= U0 + 5; y++) if (get(x, y, z) === WALL) set(x, y, z, GLASS);
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
function tower() {
  const { cx, cz, r, top, deck, domeFrom } = TOWER;
  const x0 = Math.floor(cx - r - 5), x1 = Math.ceil(cx + r + 5);
  const z0 = Math.floor(cz - r - 5), z1 = Math.ceil(cz + r + 5);
  const DECKS = [U0, 16, 23, deck];
  // his banding: glass shaft, stone band, slate cornice under the second deck
  const mat = (y) => {
    if (y <= 1) return STONE;
    if (y <= 11) return GLASS;
    if (y <= 14) return STONE;
    if (y === 15) return ROOFBLOCK;
    if (y === 16 || y === 24) return BEAM;
    return GLASS;
  };

  for (let x = x0; x <= x1; x++)
    for (let z = z0; z <= z1; z++) {
      if (!inTower(x, z)) continue;
      claim(x, z, domeFrom + 10);
      box(x, -4, z, x, G0 - 1, z, STONE);
      set(x, G0, z, FLOOR);
      const wall = towerWall(x, z);
      for (let y = G0 + 1; y <= top; y++) set(x, y, z, wall ? mat(y) : AIR);
      if (!wall) for (const fy of DECKS) set(x, fy, z, FLOOR2);
    }

  // open the tower where the library wing meets it, both storeys
  for (let x = x0; x <= x1; x++)
    for (let z = z0; z <= z1; z++) {
      if (!towerWall(x, z) || !inWing(WING.east, x, z)) continue;
      box(x, G0 + 1, z, x, G0 + 4, z, AIR);
      box(x, U0 + 1, z, x, U0 + 4, z, AIR);
    }

  // ── ladder ──
  // v2 cut the ladder at every deck. Lay the decks first, then run the ladder
  // straight through them, and give it a solid pier to hang on all the way up.
  const lx = Math.round(cx), lz = Math.round(cz - r + 1);
  for (let y = G0 + 1; y <= deck; y++) {
    set(lx, y, lz - 1, STONE);          // backing the ladder attaches to
    set(lx, y, lz, LADDER);             // continuous, no gaps
  }
  set(lx, G0, lz, FLOOR);

  // walkable balcony ring at the top of the shaft
  const WALK = deck, OUT = r + 3;
  for (let x = x0; x <= x1; x++)
    for (let z = z0; z <= z1; z++) {
      const d = dist(x, z, cx, cz);
      if (d > r - 0.5 && d <= OUT) {
        set(x, WALK, z, FLOOR2);
        set(x, WALK - 1, z, SLAB_DN);
        box(x, WALK + 1, z, x, WALK + 2, z, AIR);
        claim(x, z, WALK + 4);
        if (d > OUT - 1) RAIL.push([x, WALK + 1, z]);
      }
    }
  for (let x = Math.round(cx) - 1; x <= Math.round(cx); x++)
    for (let z = Math.round(cz); z <= Math.round(cz + r); z++)
      if (dist(x, z, cx, cz) > r - 1.2) box(x, WALK + 1, z, x, WALK + 2, z, AIR);

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
  for (const x of [20, 21]) put(x, U0 + 1, -14, 'displaycase-generic');

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

  for (let x = -42; x <= -30; x++)
    for (let z = -15; z <= -5; z++) { set(x, G0 - 1, z, 'soil-compost-normal'); set(x, G0, z, AIR); claim(x, z, 1); }
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
  "# Michael's ideal house, v3. Stand on the front doorstep, face NORTH, then /build idealhouse3",
  '# House, both wings and the tower are one footprint, so the junctions are continuous',
  '# walls on both storeys. No roof ridges, chimney capped with oak stairs, tower ladder',
  '# runs unbroken to the balcony. Needs Building Commands 0.8.0 for the translocators.',
  '', '# --- clear the volume ---', ...airLines,
  '', '# --- structure ---', ...solidLines,
  '', '# --- furniture, placed last so nothing is dropped for want of support ---', ...furnLines,
  ...(DIRECT.length ? ['', '# --- repaired translocators ---', ...DIRECT] : []),
];

writeFileSync(join(root, 'examples', 'idealhouse3.txt'), all.join('\n'));
const solids = [...M.values()].filter((c) => c !== AIR).length;
console.log(`idealhouse3.txt: ${all.length} lines (${airLines.length} clear + ${solidLines.length} build + ${furnLines.length} furniture), ${solids + F.size} blocks`);
