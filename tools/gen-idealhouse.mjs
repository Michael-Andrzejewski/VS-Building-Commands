// Michael's ideal house, v2. Built from his drawings, then corrected against
// his in-game edits (WorldEdit export idealhouse-v2.json, 2026-09-15).
//
// Sources: the Soaretherix hand-drawn map (central block labelled Sleeping
// Rooms / Underground Lab and Basement / Kitchen, with a Game Room wing and a
// Library Tower wing at 45 degrees embracing the lawn) and the Excalidraw
// "Ideal House Schematics" (the Vintage Story room program).
//
// v2 fixes, all from his review:
//   - window panes were sideways            -> ns/ew swapped
//   - slanted slate roof wrong on both sides -> north/south swapped
//   - slate slabs floating on the roof       -> slab caps dropped, roof is solid
//   - library tower needs a walkable balcony -> ring at the top of the shaft,
//     exactly where he fenced it, with a proper floor, railing and doorway
//   - house a bit larger                     -> 49x16 core, wings 24x12
//   - bookshelves became question marks      -> `bookshelf` needs a block entity
//     it never gets from a script; `clutteredbookshelf` is the decorative one
//   - chandeliers fell to the floor          -> they were emitted BEFORE the
//     ceiling existed, so the game dropped them. Furniture is now placed in a
//     final pass, after every supporting block.
//   - lanterns should be 3 up and on a wall  -> bracket out of the wall at 4,
//     lantern hanging under it at 3 (unambiguous orientation)
//   - translocators should be repaired       -> `translocator` directive, added
//     to Building Commands 0.8.0, sets the block entity's repair state
//   - walls separated the wings from the house -> junctions carved open
//
//   node tools/gen-idealhouse.mjs      ->  examples/idealhouse2.txt
//   /build idealhouse2                 (stand on the front doorstep, face north)

import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let seed = 20260915;
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
// v2: swapped. A wall running east-west takes the "ns" pane.
const PANE_IN_EW_WALL = 'glasspane-leaded-oak-ns';
const PANE_IN_NS_WALL = 'glasspane-leaded-oak-ew';
// v2: swapped. The slope that faces north takes the "south" variant.
const ROOF_N = 'slantedroofing-slate-south-free';
const ROOF_S = 'slantedroofing-slate-north-free';
const ROOF_RIDGE = 'slantedroofingridge-slate-we-free';
const ROOFBLOCK = 'stonebricks-slate';
const BOOKS = 'clutteredbookshelf';
const BOOKS_LORE = 'clutteredbookshelfwithlore';
const AIR = 'air';

// ── model: structure, furniture (placed last), and directives ────────────
const M = new Map();      // structure, includes explicit air
const F = new Map();      // furniture and anything that needs support first
const DIRECT = [];        // raw directive lines (translocator ...)
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
function claim(x, z, top) {
  const k = `${x | 0},${z | 0}`;
  FOOT.set(k, Math.max(FOOT.get(k) ?? 0, top));
}

// ── geometry (v2: larger) ────────────────────────────────────────────────
const MX1 = -24, MX2 = 24;        // 49 wide
const MZ1 = -15, MZ2 = 0;         // 16 deep, front wall at z = 0
const G0 = 0, G1 = 6;             // ground floor: slab y0, walls y1..6
const U0 = 7, U1 = 13;            // upper floor: deck y7, walls y8..13
const CEIL = 14;
const RIDGE_Z = -7;
const BFLOOR = -9, BCEIL = -1;    // basement

const WING = {
  west: { cx: -32, cz: 5, dx: -Math.SQRT1_2, dz: Math.SQRT1_2, half: 12, wide: 6 },
  east: { cx: 32, cz: 5, dx: Math.SQRT1_2, dz: Math.SQRT1_2, half: 12, wide: 6 },
};
// tower sits on the east wing's outer end, where he drew the Library Tower
const TOWER = { cx: 40, cz: 13, r: 5.6, top: 32, deck: 30, domeFrom: 33 };

function wingLocal(w, x, z) {
  const px = x + 0.5 - w.cx, pz = z + 0.5 - w.cz;
  return { u: px * w.dx + pz * w.dz, v: -px * w.dz + pz * w.dx };
}
const inWing = (w, x, z) => { const { u, v } = wingLocal(w, x, z); return Math.abs(u) <= w.half && Math.abs(v) <= w.wide; };
const wingWall = (w, x, z) => { const { u, v } = wingLocal(w, x, z); return Math.abs(u) > w.half - 1 || Math.abs(v) > w.wide - 1; };
const dist = (x, z, cx, cz) => Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
const inTower = (x, z) => dist(x, z, TOWER.cx, TOWER.cz) <= TOWER.r;
const towerWall = (x, z) => { const d = dist(x, z, TOWER.cx, TOWER.cz); return d > TOWER.r - 1 && d <= TOWER.r; };
const inMainInterior = (x, z) => x > MX1 && x < MX2 && z > MZ1 && z < MZ2;

// ════════════════════════════════════════════════════ 1. MAIN BLOCK
function mainBlock() {
  box(MX1, G0, MZ1, MX2, G0, MZ2, FLOOR);
  for (let x = MX1 - 1; x <= MX2 + 1; x++)
    for (let z = MZ1 - 1; z <= MZ2 + 1; z++)
      if (x < MX1 || x > MX2 || z < MZ1 || z > MZ2) { set(x, G0, z, STONE); claim(x, z, 1); }

  // basement
  box(MX1 + 1, BFLOOR + 1, MZ1 + 1, MX2 - 1, BCEIL - 1, MZ2 - 1, AIR);
  box(MX1, BFLOOR, MZ1, MX2, BFLOOR, MZ2, STONE);
  for (let y = BFLOOR + 1; y <= BCEIL - 1; y++) {
    for (let x = MX1; x <= MX2; x++) { set(x, y, MZ1, STONE); set(x, y, MZ2, STONE); }
    for (let z = MZ1; z <= MZ2; z++) { set(MX1, y, z, STONE); set(MX2, y, z, STONE); }
  }
  box(MX1, BCEIL, MZ1, MX2, BCEIL, MZ2, STONE);
  for (let x = -16; x <= 16; x += 8)
    for (let z = -11; z <= -4; z += 7) box(x, BFLOOR + 1, z, x, BCEIL - 1, z, COBBLE);

  // walls
  for (const [ya, yb] of [[G0 + 1, G1], [U0 + 1, U1]])
    for (let y = ya; y <= yb; y++) {
      for (let x = MX1; x <= MX2; x++) { set(x, y, MZ1, WALL); set(x, y, MZ2, WALL); }
      for (let z = MZ1; z <= MZ2; z++) { set(MX1, y, z, WALL); set(MX2, y, z, WALL); }
    }
  for (const x of [MX1, MX2, -16, -8, 8, 16])
    for (const z of [MZ1, MZ2]) { box(x, G0 + 1, z, x, G1, z, BEAM); box(x, U0 + 1, z, x, U1, z, BEAM); }
  for (let x = MX1; x <= MX2; x++) { set(x, U0, MZ1, BEAM_WE); set(x, U0, MZ2, BEAM_WE); }
  for (let z = MZ1; z <= MZ2; z++) { set(MX1, U0, z, BEAM_NS); set(MX2, U0, z, BEAM_NS); }

  box(MX1 + 1, U0, MZ1 + 1, MX2 - 1, U0, MZ2 - 1, FLOOR2);
  box(MX1, CEIL, MZ1, MX2, CEIL, MZ2, WALL);
  box(MX1 + 1, G0 + 1, MZ1 + 1, MX2 - 1, G1, MZ2 - 1, AIR);
  box(MX1 + 1, U0 + 1, MZ1 + 1, MX2 - 1, U1, MZ2 - 1, AIR);

  // windows (v2 orientation)
  for (let x = MX1 + 4; x <= MX2 - 4; x += 5)
    for (const z of [MZ1, MZ2]) {
      box(x, G0 + 2, z, x + 1, G0 + 4, z, PANE_IN_EW_WALL);
      box(x, U0 + 2, z, x + 1, U0 + 4, z, PANE_IN_EW_WALL);
    }
  for (let z = MZ1 + 4; z <= MZ2 - 4; z += 5)
    for (const x of [MX1, MX2]) {
      box(x, G0 + 2, z, x, G0 + 4, z + 1, PANE_IN_NS_WALL);
      box(x, U0 + 2, z, x, U0 + 4, z + 1, PANE_IN_NS_WALL);
    }

  // front door + porch
  box(-1, G0 + 1, MZ2, 0, G0 + 3, MZ2, AIR);
  box(-2, G0, MZ2 + 1, 1, G0, MZ2 + 2, STONE);
  claim(-2, MZ2 + 1, 1); claim(1, MZ2 + 2, 1);
  for (const x of [-3, 2]) { box(x, G0 + 1, MZ2 + 2, x, G0 + 5, MZ2 + 2, BEAM); claim(x, MZ2 + 2, G0 + 7); }
  for (let x = -3; x <= 2; x++) for (let z = MZ2 + 1; z <= MZ2 + 2; z++) { set(x, G0 + 6, z, SLAB_DN); claim(x, z, G0 + 8); }

  // ── staircases, against the back wall, running east-west ──
  // A tread at height y is a block you stand on top of, so a run from the
  // ground floor (treads y1..y7) lands level with the upper deck at y7.
  const ZA = -13, ZB = -12;                       // two blocks wide
  const stair = (x0, dx, y0, dy, steps, tread) => {
    for (let i = 0; i < steps; i++) {
      const x = x0 + dx * i, y = y0 + dy * i;
      box(x, y, ZA, x, y, ZB, tread);
      box(x, y + 1, ZA, x, y + 3, ZB, AIR);       // headroom over every tread
    }
  };
  // clear both stairwells first, then lay the treads into them
  box(-5, G0 + 1, ZA, 3, U1, ZB, AIR);            // up-stair well, through the deck
  box(5, BFLOOR + 1, ZA, 14, G1, ZB, AIR);        // down-stair well, through the floor
  stair(-4, 1, G0 + 1, 1, 7, WALL);               // ground -> upper, treads y1..y7
  stair(5, 1, G0 - 1, -1, 9, STONE);              // ground -> basement, treads y-1..y-9
}

// ════════════════════════════════════════════════════ 2. WINGS
function wing(w) {
  const pad = 2;
  const x0 = Math.floor(w.cx - w.half - w.wide - pad), x1 = Math.ceil(w.cx + w.half + w.wide + pad);
  const z0 = Math.floor(w.cz - w.half - w.wide - pad), z1 = Math.ceil(w.cz + w.half + w.wide + pad);
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      if (!inWing(w, x, z)) continue;
      const { v } = wingLocal(w, x, z);
      const isWall = wingWall(w, x, z);
      // v2: solid stepped roof, no slab cap, so nothing floats
      const h = Math.max(0, Math.round((w.wide - Math.abs(v)) * 0.8));
      claim(x, z, CEIL + h + 2);
      box(x, -5, z, x, G0 - 1, z, STONE);
      set(x, G0, z, FLOOR);
      if (isWall) { box(x, G0 + 1, z, x, G1, z, WALL); box(x, U0 + 1, z, x, U1, z, WALL); }
      else { box(x, G0 + 1, z, x, G1, z, AIR); box(x, U0 + 1, z, x, U1, z, AIR); }
      set(x, U0, z, FLOOR2);
      set(x, CEIL, z, WALL);
      for (let y = CEIL + 1; y <= CEIL + h; y++) set(x, y, z, ROOFBLOCK);
    }
  }
  // windows on the long sides
  for (let x = x0; x <= x1; x++)
    for (let z = z0; z <= z1; z++) {
      if (!inWing(w, x, z) || !wingWall(w, x, z)) continue;
      const { u, v } = wingLocal(w, x, z);
      if (Math.abs(v) < w.wide - 1 || Math.abs(u) > w.half - 2) continue;
      if (((Math.round(u) % 3) + 3) % 3 !== 0) continue;
      for (let y = G0 + 2; y <= G0 + 4; y++) if (get(x, y, z) === WALL) set(x, y, z, GLASS);
      for (let y = U0 + 2; y <= U0 + 4; y++) if (get(x, y, z) === WALL) set(x, y, z, GLASS);
    }
}

// v2: the wings used to be walled off from the house. Anywhere a wing overlaps
// the main block's interior, clear both storeys so the rooms actually join.
function openJunctions() {
  for (const w of [WING.west, WING.east]) {
    const x0 = Math.floor(w.cx - w.half - w.wide - 2), x1 = Math.ceil(w.cx + w.half + w.wide + 2);
    const z0 = Math.floor(w.cz - w.half - w.wide - 2), z1 = Math.ceil(w.cz + w.half + w.wide + 2);
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        if (!inWing(w, x, z)) continue;
        if (!inMainInterior(x, z) && z !== MZ2) continue;   // the shared south wall too
        if (!inMainInterior(x, z) && !inWing(w, x, z)) continue;
        box(x, G0 + 1, z, x, G1, z, AIR);
        box(x, U0 + 1, z, x, U1, z, AIR);
        set(x, G0, z, FLOOR);
        set(x, U0, z, FLOOR2);
      }
  }
}

// ════════════════════════════════════════════════════ 3. LIBRARY TOWER
const RAIL = [];   // cells that want a fence railing, resolved at the end
function tower() {
  const { cx, cz, r, top, deck, domeFrom } = TOWER;
  const x0 = Math.floor(cx - r - 5), x1 = Math.ceil(cx + r + 5);
  const z0 = Math.floor(cz - r - 5), z1 = Math.ceil(cz + r + 5);
  const DECKS = [U0, 16, 23, deck];

  for (let x = x0; x <= x1; x++)
    for (let z = z0; z <= z1; z++) {
      if (!inTower(x, z)) continue;
      claim(x, z, domeFrom + 10);
      box(x, -5, z, x, G0 - 1, z, STONE);
      set(x, G0, z, FLOOR);
      const wall = towerWall(x, z);
      for (let y = G0 + 1; y <= top; y++) {
        if (!wall) { set(x, y, z, AIR); continue; }
        set(x, y, z, y <= U0 ? STONE : (y % 8 === 0 ? BEAM : GLASS));
      }
      if (!wall) for (const fy of DECKS) set(x, fy, z, FLOOR2);
    }

  // the wing meets the tower here: open the stone ring so the library and the
  // tower are one space on both storeys (v1 sealed the tower off completely)
  for (let x = x0; x <= x1; x++)
    for (let z = z0; z <= z1; z++) {
      if (!towerWall(x, z) || !inWing(WING.east, x, z)) continue;
      box(x, G0 + 1, z, x, G0 + 4, z, AIR);
      box(x, U0 + 1, z, x, U0 + 4, z, AIR);
    }

  // ladder up the north face, with a gap through each deck
  const lx = Math.round(cx), lz = Math.round(cz - r + 1);
  for (let y = G0 + 1; y <= top - 1; y++) set(lx, y, lz, 'ladder-wood-oak-north');
  for (const fy of DECKS) { set(lx, fy, lz, AIR); set(lx, fy, lz + 1, AIR); }

  // ── the circular balcony he asked for, at the top of the shaft ──
  // walkable ring, corbelled underneath so it is not floating, railed outside
  const WALK = deck, OUT = r + 3;
  for (let x = x0; x <= x1; x++)
    for (let z = z0; z <= z1; z++) {
      const d = dist(x, z, cx, cz);
      if (d > r - 0.5 && d <= OUT) {
        set(x, WALK, z, FLOOR2);                 // the floor you walk on
        set(x, WALK - 1, z, SLAB_DN);            // corbel course under it
        box(x, WALK + 1, z, x, WALK + 2, z, AIR);
        claim(x, z, WALK + 4);
        if (d > OUT - 1) RAIL.push([x, WALK + 1, z]);
      }
    }
  // doorway from the astronomy deck out onto the balcony, facing south
  for (let x = Math.round(cx) - 1; x <= Math.round(cx); x++)
    for (let z = Math.round(cz); z <= Math.round(cz + r); z++)
      if (dist(x, z, cx, cz) > r - 1.2) box(x, WALK + 1, z, x, WALK + 2, z, AIR);

  // onion dome
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

// ════════════════════════════════════════════════════ 4. MAIN ROOF
function mainRoof() {
  const depth = MZ2 - RIDGE_Z;
  for (let i = 0; i <= depth; i++) {
    const y = CEIL + 1 + i;
    const zN = RIDGE_Z - (depth - i), zS = RIDGE_Z + (depth - i);
    for (let x = MX1 - 1; x <= MX2 + 1; x++) {
      if (i === depth) { set(x, y, RIDGE_Z, ROOF_RIDGE); claim(x, RIDGE_Z, y + 1); continue; }
      set(x, y, zN, ROOF_N); claim(x, zN, y + 1);
      set(x, y, zS, ROOF_S); claim(x, zS, y + 1);
      for (let z = zN + 1; z <= zS - 1; z++) {
        if (x === MX1 - 1 || x === MX2 + 1) { set(x, y, z, WALL); claim(x, z, y + 1); }
        else if (get(x, y, z) === undefined) { set(x, y, z, AIR); claim(x, z, y + 1); }
      }
    }
  }
  box(20, CEIL, -11, 21, CEIL + 11, -10, COBBLE);
  box(20, CEIL + 12, -11, 21, CEIL + 12, -10, SLAB_UP);
  for (let x = 20; x <= 21; x++) for (let z = -11; z <= -10; z++) claim(x, z, CEIL + 14);
}

// ════════════════════════════════════════════════════ 5. FURNISHING
// Everything here is emitted AFTER the structure, so nothing is placed into
// thin air and dropped (which is what happened to v1's chandeliers).
function furnish() {
  // a wall lantern: bracket at head height + 1, lantern hanging beneath it
  const wallLantern = (x, y, z) => { set(x, y + 1, z, SLAB_DN); put(x, y, z, 'lantern-small-down'); };
  const ceilingLight = (x, ceilY, z) => { if (get(x, ceilY, z) && get(x, ceilY, z) !== AIR) put(x, ceilY - 1, z, 'chandelier-candle4'); };

  // ---- kitchen, east end of the ground floor ----
  put(17, G0 + 1, -12, 'firepit-cold'); put(19, G0 + 1, -12, 'firepit-cold');
  put(15, G0 + 1, -12, 'quern-granite');
  for (let x = 12; x <= 22; x += 2) put(x, G0 + 1, -14, 'shelf-normal-north');
  for (let x = 11; x <= 23; x += 2) put(x, G0 + 1, -2, 'barrel');
  for (let x = 10; x <= 15; x++) put(x, G0 + 1, -7, 'table-normal');
  for (const x of [10, 12, 14]) put(x, G0 + 1, -6, 'chair-brown');
  for (const x of [11, 13, 15]) put(x, G0 + 1, -8, 'chair-brown');
  for (const x of [20, 21, 22]) put(x, G0 + 1, -4, 'chest-north');
  put(23, G0 + 1, -14, 'crate'); put(22, G0 + 1, -14, 'crate');

  // ---- relic room, lore and museum, west end ----
  for (let x = -22; x <= -11; x += 3) { put(x, G0 + 1, -14, 'displaycase-generic'); put(x + 1, G0 + 1, -14, 'displaycase-generic'); }
  for (let x = -23; x <= -12; x++) if (chance(0.55)) put(x, G0 + 1, -2, chance(0.25) ? BOOKS_LORE : BOOKS);
  put(-18, G0 + 1, -7, 'table-normal'); put(-18, G0 + 1, -6, 'chair-brown');
  put(-13, G0 + 1, -7, 'omoktabletop');

  // repaired translocators, behind the stairs (Building Commands 0.8.0)
  DIRECT.push(`translocator ~-6 ~${G0 + 1} ~-12 north`);
  DIRECT.push(`translocator ~-9 ~${G0 + 1} ~-12 north`);

  // ---- upper floor: bedroom, desks, balcony ----
  put(-7, U0 + 1, -5, 'bed-wood-head-north'); put(-7, U0 + 1, -4, 'bed-wood-feet-north');
  put(-5, U0 + 1, -5, 'bed-wood-head-north'); put(-5, U0 + 1, -4, 'bed-wood-feet-north');
  put(-9, U0 + 1, -5, 'mannequin-reed-complete');
  for (const x of [-12, -13]) put(x, U0 + 1, -2, 'chest-north');
  for (let x = -10; x <= -4; x++) put(x, U0 + 1, -8, 'rug-blue-diamond-center');
  put(-17, U0 + 1, -13, 'table-normal'); put(-17, U0 + 1, -12, 'chair-brown');
  put(-19, U0 + 1, -13, BOOKS);
  put(17, U0 + 1, -13, 'table-normal'); put(17, U0 + 1, -12, 'chair-brown');
  put(19, U0 + 1, -13, BOOKS);
  for (let x = 10; x <= 22; x += 2) put(x, U0 + 1, -14, chance(0.25) ? BOOKS_LORE : BOOKS);

  box(-5, U0, MZ2 + 1, 4, U0, MZ2 + 4, FLOOR2);
  for (let x = -5; x <= 4; x++) { claim(x, MZ2 + 4, U0 + 3); for (let z = MZ2 + 1; z <= MZ2 + 4; z++) claim(x, z, U0 + 3); }
  box(-1, U0 + 1, MZ2, 0, U0 + 3, MZ2, AIR);
  for (let x = -5; x <= 4; x++) RAIL.push([x, U0 + 1, MZ2 + 4]);
  for (let z = MZ2 + 1; z <= MZ2 + 4; z++) { RAIL.push([-5, U0 + 1, z]); RAIL.push([4, U0 + 1, z]); }

  // ---- basement laboratory ----
  for (let x = -20; x <= 20; x += 5) { put(x, BFLOOR + 1, -13, 'displaycase-generic'); put(x, BFLOOR + 1, -2, 'barrel'); }
  for (let x = -7; x <= 7; x += 2) put(x, BFLOOR + 1, -7, 'table-normal');
  put(-9, BFLOOR + 1, -7, 'forge'); put(-11, BFLOOR + 1, -7, 'anvil-iron');
  for (let x = 9; x <= 19; x += 2) put(x, BFLOOR + 1, -4, 'chest-north');
  for (let x = 14; x <= 20; x += 3) put(x, BFLOOR + 1, -13, BOOKS);
  // wall lanterns, 3 blocks up, on the basement's long walls
  for (let x = -18; x <= 18; x += 6) { wallLantern(x, BFLOOR + 3, MZ1 + 1); wallLantern(x, BFLOOR + 3, MZ2 - 1); }

  // ---- lighting, both storeys ----
  for (let x = -20; x <= 20; x += 8) {
    ceilingLight(x, U0, -4); ceilingLight(x, U0, -11);
    ceilingLight(x, CEIL, -7);
  }
  for (let x = -20; x <= 20; x += 10) { wallLantern(x, G0 + 3, MZ1 + 1); wallLantern(x, G0 + 3, MZ2 - 1); }

  // ---- west wing: the game room ----
  const w = WING.west;
  for (let t = -8; t <= 8; t += 5) {
    const gx = Math.round(w.cx + w.dx * t), gz = Math.round(w.cz + w.dz * t);
    put(gx, G0 + 1, gz, 'omoktabletop');
    put(gx + 1, G0 + 1, gz, 'chair-brown'); put(gx - 1, G0 + 1, gz, 'chair-brown');
    ceilingLight(gx, U0, gz); ceilingLight(gx, CEIL, gz);
    put(gx, U0 + 1, gz, 'table-normal');
  }

  // ---- east wing: the library ----
  const e = WING.east;
  for (let t = -10; t <= 10; t += 2) {
    for (const side of [-1, 1]) {
      const bx = Math.round(e.cx + e.dx * t - e.dz * side * (e.wide - 1));
      const bz = Math.round(e.cz + e.dz * t + e.dx * side * (e.wide - 1));
      for (const y of [G0 + 1, G0 + 2, U0 + 1]) if (get(bx, y, bz) === AIR) put(bx, y, bz, chance(0.2) ? BOOKS_LORE : BOOKS);
    }
    const cx2 = Math.round(e.cx + e.dx * t), cz2 = Math.round(e.cz + e.dz * t);
    if (t % 4 === 0) { put(cx2, G0 + 1, cz2, 'table-normal'); ceilingLight(cx2, U0, cz2); ceilingLight(cx2, CEIL, cz2); }
  }
  // tower reading decks
  for (const fy of [16, 23, TOWER.deck]) {
    put(Math.round(TOWER.cx) - 3, fy + 1, Math.round(TOWER.cz), BOOKS);
    put(Math.round(TOWER.cx) + 3, fy + 1, Math.round(TOWER.cz), 'table-normal');
    put(Math.round(TOWER.cx) + 3, fy + 1, Math.round(TOWER.cz) + 1, 'chair-brown');
  }

  // ---- the garden, north-west, as drawn ----
  for (let x = -42; x <= -30; x++)
    for (let z = -15; z <= -5; z++) { set(x, G0 - 1, z, 'soil-compost-normal'); set(x, G0, z, AIR); claim(x, z, 1); }
}

// ════════════════════════════════════════════════════ build
mainBlock();
wing(WING.west);
wing(WING.east);
openJunctions();
tower();
mainRoof();
furnish();

// railings: pick the fence variant that matches its neighbours
const railSet = new Set(RAIL.map(([x, y, z]) => key(x, y, z)));
for (const [x, y, z] of RAIL) {
  const conn = [];
  if (railSet.has(key(x, y, z - 1))) conn.push('n');
  if (railSet.has(key(x + 1, y, z))) conn.push('e');
  if (railSet.has(key(x, y, z + 1))) conn.push('s');
  if (railSet.has(key(x - 1, y, z))) conn.push('w');
  put(x, y, z, `woodenfence-oak-${conn.length ? conn.join('') : 'empty'}-free`);
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
  "# Michael's ideal house, v2. Stand on the front doorstep, face NORTH, then /build idealhouse2",
  '# Central block: relic room and museum west, hall and stairs centre, kitchen east.',
  '# Bedrooms and desks above, laboratory below, Game Room wing south-west,',
  '# Library wing and glass tower south-east with a walkable balcony at the top.',
  '# Needs Building Commands 0.8.0 for the repaired translocators.',
  '', '# --- clear the volume ---', ...airLines,
  '', '# --- structure ---', ...solidLines,
  '', '# --- furniture, placed last so nothing is dropped for want of support ---', ...furnLines,
  ...(DIRECT.length ? ['', '# --- repaired translocators ---', ...DIRECT] : []),
];

writeFileSync(join(root, 'examples', 'idealhouse2.txt'), all.join('\n'));
const solids = [...M.values()].filter((c) => c !== AIR).length;
console.log(`idealhouse2.txt: ${all.length} lines (${airLines.length} clear + ${solidLines.length} build + ${furnLines.length} furniture), ${solids + F.size} blocks`);
