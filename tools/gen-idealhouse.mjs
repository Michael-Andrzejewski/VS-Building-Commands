// Michael's ideal house, built from his own drawings.
//
// Sources:
//   - Google Doc "Michael's House (Michael's Base, Rocket Elite HQ, Soarethierix,
//     Island Paradise)", hand-drawn map 7: a long central block labelled
//     Sleeping Rooms / Underground Lab and Basement / Kitchen, with a Game Room
//     wing angled down-left and a Library Tower wing angled down-right, both at
//     about 45 degrees, embracing the lawn to the south.
//   - Google Doc "Michael and Xael Vintage Story Utopia" -> Excalidraw "Ideal
//     House Schematics", which is the Vintage Story room program: kitchen and
//     kitchen storage, tool storage, smithing, ore storage, fermenting barrels,
//     relic room / lore / museum, translocators, staircase, and a second floor
//     with the bedroom, Michael's and Xael's desks, an armour stand and a
//     ladder to the library tower.
//   - Doc prose: glass library tower with a dome and a balcony a little below
//     the library floor, a huge basement laboratory, a big open kitchen.
//
// Output: examples/idealhouse.txt, a /build script of fill/setblock lines,
// tilde-relative to the player. STAND WHERE THE FRONT DOOR SHOULD BE, on the
// ground, facing north; the house grows north and the two wings sweep around
// you to the south-west and south-east.
//
//   node tools/gen-idealhouse.mjs
//   /build idealhouse
//
// Every block code was checked against the game's own assets (14,475 survival
// codes enumerated from assets/survival/blocktypes).

import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── deterministic rng ────────────────────────────────────────────────────
let seed = 20260915;
function rnd() { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
const chance = (p) => rnd() < p;
const pick = (a) => a[Math.floor(rnd() * a.length)];

// ── palette (all verified present in survival assets) ────────────────────
const WALL      = 'planks-oak-ud';        // outer wall infill
const BEAM      = 'log-placed-oak-ud';    // corner posts / frame
const BEAM_WE   = 'log-placed-oak-we';
const BEAM_NS   = 'log-placed-oak-ns';
const FLOOR     = 'planks-oak-we';        // floorboards
const FLOOR2    = 'planks-oak-ns';
const SLAB_UP   = 'plankslab-oak-up-free';
const SLAB_DN   = 'plankslab-oak-down-free';
const STONE     = 'stonebricks-granite';  // foundation, basement, plinth
const COBBLE    = 'cobblestone-granite';
const GLASS     = 'glass-plain';
const PANE_EW   = 'glasspane-leaded-oak-ew';
const PANE_NS   = 'glasspane-leaded-oak-ns';
const ROOF_N    = 'slantedroofing-slate-north-free';
const ROOF_S    = 'slantedroofing-slate-south-free';
const ROOF_RIDGE= 'slantedroofingridge-slate-we-free';
const ROOFBLOCK = 'stonebricks-slate';    // stepped roofs on the 45-degree wings
const ROOFSLAB  = 'stonebrickslab-slate-up-free';
const AIR       = 'air';

// ── voxel model ──────────────────────────────────────────────────────────
const M = new Map();                       // "x,y,z" -> code
const key = (x, y, z) => `${x},${y},${z}`;
const set = (x, y, z, c) => { M.set(key(x | 0, y | 0, z | 0), c); };
const get = (x, y, z) => M.get(key(x | 0, y | 0, z | 0));
function box(x1, y1, z1, x2, y2, z2, c) {
  for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++)
    for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++)
      for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++) set(x, y, z, c);
}
// hollow shell: walls only, interior untouched
function shell(x1, y1, z1, x2, y2, z2, c) {
  for (let x = x1; x <= x2; x++)
    for (let y = y1; y <= y2; y++)
      for (let z = z1; z <= z2; z++)
        if (x === x1 || x === x2 || z === z1 || z === z2 || y === y1 || y === y2) set(x, y, z, c);
}

// columns the build occupies, so we can clear exactly the structure's volume
// (and never gouge the surrounding lawn): "x,z" -> highest y to clear
const FOOT = new Map();
function claim(x, z, top) {
  const k = `${x | 0},${z | 0}`;
  FOOT.set(k, Math.max(FOOT.get(k) ?? 0, top));
}

// ── geometry of the house, from the drawing ──────────────────────────────
// origin = the front doorstep, ground floor level. x east, z south, y up.
const MX1 = -20, MX2 = 20;        // main block, 41 wide
const MZ1 = -12, MZ2 = 0;         // main block, 13 deep, front wall at z=0
const G0 = 0, G1 = 5;             // ground floor: floor y0, walls y1..5
const U0 = 6, U1 = 11;            // upper floor: floor y6, walls y7..11
const CEIL = 12;                  // flat ceiling over the upper floor
const RIDGE_Z = -6;               // roof ridge runs east-west down the middle
const BFLOOR = -7, BCEIL = -1;    // basement floor / ceiling slab

// wings: rotated 45 degrees, sweeping south-west and south-east
const WING = {
  west: { cx: -26, cz: 4, dx: -Math.SQRT1_2, dz: Math.SQRT1_2, half: 10, wide: 5 },
  east: { cx: 26, cz: 4, dx: Math.SQRT1_2, dz: Math.SQRT1_2, half: 10, wide: 5 },
};
const TOWER = { cx: 33, cz: 11, r: 4.6, top: 26 };   // glass library tower

// local coords inside a rotated wing: u along its length, v across it
function wingLocal(w, x, z) {
  const px = x + 0.5 - w.cx, pz = z + 0.5 - w.cz;
  return { u: px * w.dx + pz * w.dz, v: -px * w.dz + pz * w.dx };
}
const inWing = (w, x, z, pad = 0) => {
  const { u, v } = wingLocal(w, x, z);
  return Math.abs(u) <= w.half + pad && Math.abs(v) <= w.wide + pad;
};
const wingWall = (w, x, z) => {
  const { u, v } = wingLocal(w, x, z);
  return Math.abs(u) > w.half - 1 || Math.abs(v) > w.wide - 1;
};

const inTower = (x, z, pad = 0) => {
  const dx = x + 0.5 - TOWER.cx, dz = z + 0.5 - TOWER.cz;
  return Math.hypot(dx, dz) <= TOWER.r + pad;
};
const towerWall = (x, z) => {
  const dx = x + 0.5 - TOWER.cx, dz = z + 0.5 - TOWER.cz;
  const d = Math.hypot(dx, dz);
  return d > TOWER.r - 1 && d <= TOWER.r;
};

// ════════════════════════════════════════════════════════════════════════
// 1. MAIN BLOCK
// ════════════════════════════════════════════════════════════════════════
function mainBlock() {
  // plinth + ground floor slab
  box(MX1, G0, MZ1, MX2, G0, MZ2, FLOOR);
  // stone skirt one block proud of the wall, so it reads as a foundation
  for (let x = MX1 - 1; x <= MX2 + 1; x++)
    for (let z = MZ1 - 1; z <= MZ2 + 1; z++)
      if (x < MX1 || x > MX2 || z < MZ1 || z > MZ2) { set(x, G0, z, STONE); claim(x, z, 1); }

  // ── basement: excavate, then line it in stone ──
  box(MX1 + 1, BFLOOR + 1, MZ1 + 1, MX2 - 1, BCEIL - 1, MZ2 - 1, AIR);
  box(MX1, BFLOOR, MZ1, MX2, BFLOOR, MZ2, STONE);            // basement floor
  for (let y = BFLOOR + 1; y <= BCEIL - 1; y++) {            // basement walls
    for (let x = MX1; x <= MX2; x++) { set(x, y, MZ1, STONE); set(x, y, MZ2, STONE); }
    for (let z = MZ1; z <= MZ2; z++) { set(MX1, y, z, STONE); set(MX2, y, z, STONE); }
  }
  box(MX1, BCEIL, MZ1, MX2, BCEIL, MZ2, STONE);              // basement ceiling
  // pillars so the lab does not read as one empty cavern
  for (let x = -14; x <= 14; x += 7)
    for (let z = -9; z <= -3; z += 6) box(x, BFLOOR + 1, z, x, BCEIL - 1, z, COBBLE);

  // ── ground + upper floor walls ──
  for (const [y0, y1] of [[G0 + 1, G1], [U0 + 1, U1]]) {
    for (let y = y0; y <= y1; y++) {
      for (let x = MX1; x <= MX2; x++) { set(x, y, MZ1, WALL); set(x, y, MZ2, WALL); }
      for (let z = MZ1; z <= MZ2; z++) { set(MX1, y, z, WALL); set(MX2, y, z, WALL); }
    }
  }
  // corner posts and mid-span posts
  for (const x of [MX1, MX2, -13, -7, 7, 13])
    for (const z of [MZ1, MZ2]) { box(x, G0 + 1, z, x, G1, z, BEAM); box(x, U0 + 1, z, x, U1, z, BEAM); }
  // floor band between storeys, expressed outside as a beam course
  for (let x = MX1; x <= MX2; x++) { set(x, U0, MZ1, BEAM_WE); set(x, U0, MZ2, BEAM_WE); }
  for (let z = MZ1; z <= MZ2; z++) { set(MX1, U0, z, BEAM_NS); set(MX2, U0, z, BEAM_NS); }

  // upper floor deck + flat ceiling
  box(MX1 + 1, U0, MZ1 + 1, MX2 - 1, U0, MZ2 - 1, FLOOR2);
  box(MX1, CEIL, MZ1, MX2, CEIL, MZ2, WALL);

  // hollow both storeys
  box(MX1 + 1, G0 + 1, MZ1 + 1, MX2 - 1, G1, MZ2 - 1, AIR);
  box(MX1 + 1, U0 + 1, MZ1 + 1, MX2 - 1, U1, MZ2 - 1, AIR);

  // ── windows ──
  for (let x = MX1 + 3; x <= MX2 - 3; x += 4) {
    for (const z of [MZ1, MZ2]) {
      const pane = PANE_EW;
      box(x, G0 + 2, z, x + 1, G0 + 4, z, pane);
      box(x, U0 + 2, z, x + 1, U0 + 4, z, pane);
    }
  }
  for (let z = MZ1 + 3; z <= MZ2 - 3; z += 4) {
    for (const x of [MX1, MX2]) {
      box(x, G0 + 2, z, x, G0 + 4, z + 1, PANE_NS);
      box(x, U0 + 2, z, x, U0 + 4, z + 1, PANE_NS);
    }
  }

  // ── front door, centred, with a stone step ──
  box(-1, G0 + 1, MZ2, 0, G0 + 3, MZ2, AIR);
  // two-leaf door: the -plank- family carries its own half/hinge in the code,
  // so it places correctly from a script
  set(-1, G0 + 1, MZ2, 'door-plank-south-down-closed-left');
  set(-1, G0 + 2, MZ2, 'door-plank-south-up-closed-left');
  set(0, G0 + 1, MZ2, 'door-plank-south-down-closed-right');
  set(0, G0 + 2, MZ2, 'door-plank-south-up-closed-right');
  box(-2, G0, MZ2 + 1, 1, G0, MZ2 + 2, STONE);
  claim(-2, MZ2 + 1, 1); claim(1, MZ2 + 2, 1);
  // porch posts and a small canopy over the door
  for (const x of [-3, 2]) box(x, G0 + 1, MZ2 + 2, x, G0 + 4, MZ2 + 2, BEAM);
  box(-3, G0 + 5, MZ2 + 1, 2, G0 + 5, MZ2 + 2, SLAB_DN);

  // ── the grand staircase, back of the entry hall ──
  // down to the basement and up to the bedrooms, both in the same shaft
  box(-2, G0, -11, 2, G0, -8, AIR);                 // opening down
  box(-2, U0, -11, 2, U0, -8, AIR);                 // opening up
  for (let i = 0; i < 6; i++) {                     // ground -> upper
    const z = -8 - i;
    box(-2, G0 + 1 + i, z, 1, G0 + 1 + i, z, WALL);
    box(-2, G0 + 2 + i, z, 1, G1 + 1, z, AIR);
  }
  for (let i = 0; i < 6; i++) {                     // ground -> basement
    const z = -8 - i;
    box(2, G0 - 1 - i, z, 2, G0 - 1 - i, z, STONE);
    box(2, G0 - i, z, 2, G0, z, AIR);
  }
  box(2, BCEIL, -11, 2, BCEIL, -8, AIR);
  set(2, G0, -8, AIR);
}

// ════════════════════════════════════════════════════════════════════════
// 2. THE TWO 45-DEGREE WINGS
// ════════════════════════════════════════════════════════════════════════
function wing(w, roofTop) {
  const pad = 2;
  const x0 = Math.floor(w.cx - w.half - w.wide - pad), x1 = Math.ceil(w.cx + w.half + w.wide + pad);
  const z0 = Math.floor(w.cz - w.half - w.wide - pad), z1 = Math.ceil(w.cz + w.half + w.wide + pad);
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      if (!inWing(w, x, z)) continue;
      const { v } = wingLocal(w, x, z);
      const isWall = wingWall(w, x, z);
      claim(x, z, roofTop + 2);
      // foundation under the wing
      box(x, -4, z, x, G0 - 1, z, STONE);
      set(x, G0, z, FLOOR);                                   // ground floor
      if (isWall) {
        box(x, G0 + 1, z, x, G1, z, WALL);
        box(x, U0 + 1, z, x, U1, z, WALL);
      } else {
        box(x, G0 + 1, z, x, G1, z, AIR);
        box(x, U0 + 1, z, x, U1, z, AIR);
      }
      set(x, U0, z, FLOOR2);                                  // upper deck
      set(x, CEIL, z, WALL);                                  // ceiling
      // stepped gable roof, pitched across the wing's own axis
      const h = Math.max(0, Math.round((w.wide - Math.abs(v)) * 0.75));
      for (let y = CEIL + 1; y <= CEIL + h; y++) set(x, y, z, ROOFBLOCK);
      set(x, CEIL + h + 1, z, ROOFSLAB);
    }
  }
  // windows: walk the wing's own cells so both wings get them regardless of
  // which way the 45-degree rounding falls
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      if (!inWing(w, x, z) || !wingWall(w, x, z)) continue;
      const { u, v } = wingLocal(w, x, z);
      if (Math.abs(v) < w.wide - 1) continue;              // long sides only
      if (Math.abs(u) > w.half - 2) continue;              // not at the ends
      if (((Math.round(u) % 3) + 3) % 3 !== 0) continue;   // every third bay
      for (let y = G0 + 2; y <= G0 + 4; y++) if (get(x, y, z) === WALL) set(x, y, z, GLASS);
      for (let y = U0 + 2; y <= U0 + 4; y++) if (get(x, y, z) === WALL) set(x, y, z, GLASS);
    }
  }
  // doorway where the wing meets the main block: carve the shared wall through
  const innerU = -w.half + 1;
  for (let s = -2; s <= 2; s++) {
    const dx2 = Math.round(w.cx + w.dx * innerU - w.dz * s);
    const dz2 = Math.round(w.cz + w.dz * innerU + w.dx * s);
    box(dx2, G0 + 1, dz2, dx2, G0 + 3, dz2, AIR);
    box(dx2, U0 + 1, dz2, dx2, U0 + 3, dz2, AIR);
  }
  // and punch through the main block's own south wall at that junction
  const jx = Math.round(w.cx + w.dx * (-w.half - 1));
  for (let x = jx - 2; x <= jx + 2; x++) {
    box(x, G0 + 1, MZ2, x, G0 + 3, MZ2, AIR);
    box(x, U0 + 1, MZ2, x, U0 + 3, MZ2, AIR);
  }
}

// ════════════════════════════════════════════════════════════════════════
// 3. THE LIBRARY TOWER  (glass walls, dome, balcony below the library floor)
// ════════════════════════════════════════════════════════════════════════
function tower() {
  const r = TOWER.r, top = TOWER.top;
  const x0 = Math.floor(TOWER.cx - r - 3), x1 = Math.ceil(TOWER.cx + r + 3);
  const z0 = Math.floor(TOWER.cz - r - 3), z1 = Math.ceil(TOWER.cz + r + 3);
  const FLOORS = [U0, 13, 20];              // library decks; 20 = astronomy lab

  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      if (!inTower(x, z)) continue;
      claim(x, z, top + 8);
      box(x, -4, z, x, G0 - 1, z, STONE);
      set(x, G0, z, FLOOR);
      const wall = towerWall(x, z);
      for (let y = G0 + 1; y <= top; y++) {
        if (!wall) { set(x, y, z, AIR); continue; }
        // stone to the first deck, then glass all the way up
        set(x, y, z, y <= U0 ? STONE : (y % 7 === 0 ? BEAM : GLASS));
      }
      for (const fy of FLOORS) if (!wall) set(x, fy, z, FLOOR2);
    }
  }
  // stair/ladder shaft up the north face of the tower
  const lx = Math.round(TOWER.cx), lz = Math.round(TOWER.cz - r + 1);
  for (let y = G0 + 1; y <= top - 1; y++) { set(lx, y, lz, 'ladder-wood-oak-north'); }
  for (const fy of FLOORS) { set(lx, fy, lz, AIR); set(lx, fy, lz + 1, AIR); }

  // balcony ring, a little below the library floor, as the doc describes
  const by = FLOORS[2] - 3;
  for (let x = x0; x <= x1; x++)
    for (let z = z0; z <= z1; z++) {
      const d = Math.hypot(x + 0.5 - TOWER.cx, z + 0.5 - TOWER.cz);
      if (d > r && d <= r + 1.6) {
        set(x, by, z, SLAB_UP); claim(x, z, by + 3);
        if (d > r + 0.9) set(x, by + 1, z, 'woodenfence-oak-free' in {} ? 'planks-oak-ud' : SLAB_UP);
      }
    }
  // doorway from the balcony into the tower
  box(Math.round(TOWER.cx), by + 1, Math.round(TOWER.cz - r), Math.round(TOWER.cx), by + 2, Math.round(TOWER.cz - r), AIR);

  // onion dome: a stack of shrinking rings, capped with glass
  let ry = top + 1;
  const profile = [r + 0.8, r + 1.0, r + 0.9, r + 0.5, r - 0.4, r - 1.6, r - 2.8, r - 3.8];
  for (let i = 0; i < profile.length; i++) {
    const rr = profile[i];
    for (let x = x0 - 2; x <= x1 + 2; x++)
      for (let z = z0 - 2; z <= z1 + 2; z++) {
        const d = Math.hypot(x + 0.5 - TOWER.cx, z + 0.5 - TOWER.cz);
        if (d <= rr && d > rr - 1.15) { set(x, ry + i, z, GLASS); claim(x, z, ry + i + 2); }
        else if (d <= rr - 1.15 && i === profile.length - 1) set(x, ry + i, z, GLASS);
      }
  }
  set(Math.round(TOWER.cx), ry + profile.length, Math.round(TOWER.cz), BEAM);
  set(Math.round(TOWER.cx), ry + profile.length + 1, Math.round(TOWER.cz), 'lantern-small-up');
}

// ════════════════════════════════════════════════════════════════════════
// 4. FURNISHING  (the Excalidraw room program)
// ════════════════════════════════════════════════════════════════════════
function furnish() {
  const put = (x, y, z, c) => set(x, y, z, c);

  // ---- GROUND FLOOR, east end: the big open kitchen ----
  put(14, G0 + 1, -10, 'firepit-cold');
  put(16, G0 + 1, -10, 'firepit-cold');
  put(12, G0 + 1, -10, 'quern-granite');
  for (let x = 10; x <= 18; x += 2) put(x, G0 + 1, -11, 'shelf-normal-north');
  for (let x = 9; x <= 19; x += 2) put(x, G0 + 1, -2, 'barrel');            // fermenting barrels
  for (let x = 8; x <= 12; x++) put(x, G0 + 1, -6, 'table-normal');         // dining table
  put(8, G0 + 1, -5, 'chair-brown'); put(10, G0 + 1, -5, 'chair-brown'); put(12, G0 + 1, -5, 'chair-brown');
  put(9, G0 + 1, -7, 'chair-brown'); put(11, G0 + 1, -7, 'chair-brown');
  for (const x of [17, 18, 19]) put(x, G0 + 1, -4, 'chest-north');          // kitchen storage
  put(19, G0 + 1, -11, 'crate'); put(18, G0 + 1, -11, 'crate');

  // ---- GROUND FLOOR, west end: relic room, lore and museum ----
  for (let x = -18; x <= -9; x += 3) {
    put(x, G0 + 1, -11, 'displaycase-generic');
    put(x + 1, G0 + 1, -11, 'displaycase-generic');
  }
  for (let x = -19; x <= -10; x += 1) if (chance(0.55)) put(x, G0 + 1, -2, 'bookshelf');
  put(-15, G0 + 1, -6, 'table-normal'); put(-15, G0 + 1, -5, 'chair-brown');
  put(-11, G0 + 1, -6, 'omoktabletop');
  // translocators, tucked behind the stairs on the west side of the hall
  put(-5, G0 + 1, -10, 'statictranslocator-normal-north');
  put(-7, G0 + 1, -10, 'statictranslocator-normal-north');
  // tool rack and a working corner by the door
  put(-4, G0 + 2, MZ1 + 1, 'toolrack-north');

  // lighting, both storeys
  for (let x = -16; x <= 16; x += 8) {
    put(x, G1, -3, 'chandelier-candle4');
    put(x, G1, -9, 'chandelier-candle4');
    put(x, U1, -6, 'chandelier-candle4');
  }

  // ---- UPPER FLOOR, west end: the bedroom, Michael and Xael ----
  put(-6, U0 + 1, -4, 'bed-wood-head-north'); put(-6, U0 + 1, -3, 'bed-wood-feet-north');
  put(-4, U0 + 1, -4, 'bed-wood-head-north'); put(-4, U0 + 1, -3, 'bed-wood-feet-north');
  put(-8, U0 + 1, -4, 'mannequin-reed-complete');                 // armour stand
  for (const x of [-10, -11]) put(x, U0 + 1, -2, 'chest-north');
  box(-9, U0 + 1, -6, -3, U0 + 1, -6, 'rug-blue-diamond-center');
  // the two desks, one each, as drawn
  put(-14, U0 + 1, -10, 'table-normal'); put(-14, U0 + 1, -9, 'chair-brown');
  put(-16, U0 + 1, -10, 'bookshelf');
  put(14, U0 + 1, -10, 'table-normal'); put(14, U0 + 1, -9, 'chair-brown');
  put(16, U0 + 1, -10, 'bookshelf');
  for (let x = 8; x <= 18; x += 2) put(x, U0 + 1, -11, 'bookshelf');

  // balcony over the front door, off the upper landing
  box(-4, U0, MZ2 + 1, 3, U0, MZ2 + 3, FLOOR2);
  box(-4, U0 + 1, MZ2 + 3, 3, U0 + 1, MZ2 + 3, SLAB_UP);
  for (const x of [-4, 3]) box(x, U0 + 1, MZ2 + 1, x, U0 + 1, MZ2 + 3, SLAB_UP);
  box(-1, U0 + 1, MZ2, 0, U0 + 3, MZ2, AIR);
  for (let x = -4; x <= 3; x++) claim(x, MZ2 + 3, U0 + 3);

  // ---- BASEMENT: the underground laboratory ----
  for (let x = -17; x <= 17; x += 4) {
    put(x, BFLOOR + 1, -10, 'displaycase-generic');
    put(x, BFLOOR + 1, -2, 'barrel');
  }
  for (let x = -6; x <= 6; x += 2) put(x, BFLOOR + 1, -6, 'table-normal');
  put(-8, BFLOOR + 1, -6, 'forge'); put(-10, BFLOOR + 1, -6, 'anvil-iron');
  for (let x = 8; x <= 16; x += 2) put(x, BFLOOR + 1, -4, 'chest-north');
  for (let x = -16; x <= 16; x += 6) { put(x, BCEIL - 1, -4, 'lantern-small-up'); put(x, BCEIL - 1, -8, 'lantern-small-up'); }
  for (let x = 12; x <= 18; x += 3) put(x, BFLOOR + 1, -10, 'bookshelf');   // cosy corner

  // ---- WEST WING: the game room ----
  const w = WING.west;
  for (let t = -6; t <= 6; t += 4) {
    const gx = Math.round(w.cx + w.dx * t), gz = Math.round(w.cz + w.dz * t);
    put(gx, G0 + 1, gz, 'omoktabletop');
    put(gx + 1, G0 + 1, gz, 'chair-brown'); put(gx - 1, G0 + 1, gz, 'chair-brown');
    put(gx, G1, gz, 'chandelier-candle4');
    put(gx, U0 + 1, gz, 'table-normal');
    put(gx, U1, gz, 'chandelier-candle4');
  }

  // ---- EAST WING: the library ----
  const e = WING.east;
  for (let t = -8; t <= 8; t += 2) {
    for (const side of [-1, 1]) {
      const bx = Math.round(e.cx + e.dx * t - e.dz * side * (e.wide - 1));
      const bz = Math.round(e.cz + e.dz * t + e.dx * side * (e.wide - 1));
      if (get(bx, G0 + 1, bz) === AIR) put(bx, G0 + 1, bz, 'bookshelf');
      if (get(bx, G0 + 2, bz) === AIR) put(bx, G0 + 2, bz, 'bookshelf');
      if (get(bx, U0 + 1, bz) === AIR) put(bx, U0 + 1, bz, 'bookshelf');
    }
    const cx2 = Math.round(e.cx + e.dx * t), cz2 = Math.round(e.cz + e.dz * t);
    if (t % 4 === 0) { put(cx2, G0 + 1, cz2, 'table-normal'); put(cx2, G1, cz2, 'chandelier-candle4'); }
  }
  // tower reading decks
  for (const fy of [13, 20]) {
    put(Math.round(TOWER.cx) - 2, fy + 1, Math.round(TOWER.cz), 'bookshelf');
    put(Math.round(TOWER.cx) + 2, fy + 1, Math.round(TOWER.cz), 'table-normal');
    put(Math.round(TOWER.cx) + 2, fy + 1, Math.round(TOWER.cz) + 1, 'chair-brown');
  }

  // ---- OUTSIDE: the garden, north-west of the house as drawn ----
  for (let x = -34; x <= -24; x++)
    for (let z = -12; z <= -4; z++) {
      set(x, G0 - 1, z, 'farmland-moist-high'); claim(x, z, 1);
      set(x, G0, z, AIR);
    }
  for (let x = -34; x <= -24; x += 5)
    for (let z = -12; z <= -4; z += 4) set(x, G0 - 1, z, 'soil-compost-normal');
}

// ════════════════════════════════════════════════════════════════════════
// 5. ROOF OVER THE MAIN BLOCK  (proper slanted shingles, ridge east-west)
// ════════════════════════════════════════════════════════════════════════
function mainRoof() {
  const depth = MZ2 - RIDGE_Z;             // 6 courses each side
  for (let i = 0; i <= depth; i++) {
    const y = CEIL + 1 + i;
    const zN = RIDGE_Z - (depth - i);      // north slope creeps in as it rises
    const zS = RIDGE_Z + (depth - i);
    for (let x = MX1 - 1; x <= MX2 + 1; x++) {
      if (i === depth) { set(x, y, RIDGE_Z, ROOF_RIDGE); claim(x, RIDGE_Z, y + 1); continue; }
      set(x, y, zN, ROOF_N); claim(x, zN, y + 1);
      set(x, y, zS, ROOF_S); claim(x, zS, y + 1);
      // close the gable ends and fill the attic void behind the slope
      for (let z = zN + 1; z <= zS - 1; z++) {
        if (x === MX1 - 1 || x === MX2 + 1) { set(x, y, z, WALL); claim(x, z, y + 1); }
        else if (get(x, y, z) === undefined) { set(x, y, z, AIR); claim(x, z, y + 1); }
      }
    }
  }
  // chimney above the kitchen
  box(16, CEIL, -9, 17, CEIL + 9, -8, COBBLE);
  box(16, CEIL + 10, -9, 17, CEIL + 10, -8, SLAB_UP);
  for (let x = 16; x <= 17; x++) for (let z = -9; z <= -8; z++) claim(x, z, CEIL + 12);
}

// ════════════════════════════════════════════════════════════════════════
// build it
// ════════════════════════════════════════════════════════════════════════
mainBlock();
wing(WING.west, CEIL + 6);
wing(WING.east, CEIL + 6);
tower();
mainRoof();
furnish();

// claim every column the model touches, so the clear pass covers it
for (const k of M.keys()) {
  const [x, y, z] = k.split(',').map(Number);
  if (y >= 0) claim(x, z, y + 1);
}
// clear the structure's own volume (never the surrounding lawn)
for (const [k, top] of FOOT) {
  const [x, z] = k.split(',').map(Number);
  for (let y = 1; y <= top; y++) if (!M.has(key(x, y, z))) set(x, y, z, AIR);
}

// ── greedy mesher: model -> as few fill/setblock lines as possible ───────
const t = (n) => '~' + (n === 0 ? '' : n);
function emit(codeFilter) {
  const lines = [];
  const done = new Set();
  const cells = [...M.entries()].filter(([, c]) => codeFilter(c))
    .map(([k, c]) => { const [x, y, z] = k.split(',').map(Number); return { x, y, z, c, k }; })
    .sort((a, b) => a.y - b.y || a.z - b.z || a.x - b.x);
  for (const cell of cells) {
    if (done.has(cell.k)) continue;
    const { x, y, z, c } = cell;
    let x2 = x; while (M.get(key(x2 + 1, y, z)) === c && !done.has(key(x2 + 1, y, z))) x2++;
    let z2 = z;
    outerZ: while (true) {
      for (let xi = x; xi <= x2; xi++) {
        const kk = key(xi, y, z2 + 1);
        if (M.get(kk) !== c || done.has(kk)) break outerZ;
      }
      z2++;
    }
    let y2 = y;
    outerY: while (true) {
      for (let xi = x; xi <= x2; xi++) for (let zi = z; zi <= z2; zi++) {
        const kk = key(xi, y2 + 1, zi);
        if (M.get(kk) !== c || done.has(kk)) break outerY;
      }
      y2++;
    }
    for (let xi = x; xi <= x2; xi++) for (let yi = y; yi <= y2; yi++) for (let zi = z; zi <= z2; zi++) done.add(key(xi, yi, zi));
    lines.push(x === x2 && y === y2 && z === z2
      ? `setblock ${t(x)} ${t(y)} ${t(z)} ${c}`
      : `fill ${t(x)} ${t(y)} ${t(z)} ${t(x2)} ${t(y2)} ${t(z2)} ${c}`);
  }
  return lines;
}

const header = [
  '# Michael\'s ideal house, from the Soaretherix drawings and the Excalidraw schematic.',
  '# Stand where the FRONT DOOR should be, on the ground, facing NORTH, then /build idealhouse',
  '# Central block: relic room + hall + kitchen, bedrooms above, laboratory below.',
  '# Game Room wing to the south-west, Library Tower wing to the south-east.',
];
const airLines = emit((c) => c === AIR);
const solidLines = emit((c) => c !== AIR);
const all = [...header, '', '# --- clear the volume ---', ...airLines, '', '# --- structure ---', ...solidLines];

writeFileSync(join(root, 'examples', 'idealhouse.txt'), all.join('\n'));
const solids = [...M.values()].filter((c) => c !== AIR).length;
console.log(`idealhouse.txt: ${all.length} lines (${airLines.length} clear + ${solidLines.length} build), ${solids} solid blocks`);
