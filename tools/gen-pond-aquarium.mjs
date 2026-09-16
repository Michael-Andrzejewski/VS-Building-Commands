// pond_aquarium: a pond that looks ordinary from the bank, and is a three
// storey aquarium from underneath.
//
//   node tools/gen-pond-aquarium.mjs      ->  examples/pond_aquarium.txt
//
// Stand on the bank where the pier begins, facing NORTH, then
// /build pond_aquarium. The entrance to the galleries is the stone headhouse
// directly behind you.
//
// The pond is 60 across and 25 deep. Its whole wall below the waterline is
// glass, and three walkway rings are cut into the rock outside that glass at
// 8, 15 and 22 blocks down, reached by one straight stair with a corridor
// branching off at each level. The branches are offset sideways from the stair
// so a lower corridor never has to run back through the flight above it.

import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── palette ───────────────────────────────────────────────────────────────
const WATER = 'water-still-7';
const GLASS = 'glass-plain';
const ROCK = 'cobblestone-granite';       // the mass the galleries are cut into
const STONE = 'stonebricks-granite';      // anything built rather than cut
const DECK = 'stonebricks-slate';         // gallery floors
const SOIL = 'soil-medium-normal';        // grassed bank
const GRAVEL = 'gravel-granite';
const SAND = 'sand-granite';
const PLANK = 'planks-oak-we';
const POST = 'log-placed-oak-ud';
const SLAB = 'stonebrickslab-granite-down-free';
const AIR = 'air';

// ── model ─────────────────────────────────────────────────────────────────
const M = new Map();          // structure, includes explicit air
const W = new Map();          // water, placed after the glass is standing
const F = new Map();          // lanterns and furniture, placed last
const key = (x, y, z) => `${x},${y},${z}`;
const set = (x, y, z, c) => M.set(key(x | 0, y | 0, z | 0), c);
const get = (x, y, z) => M.get(key(x | 0, y | 0, z | 0));
const put = (x, y, z, c) => F.set(key(x | 0, y | 0, z | 0), c);
function box(x1, y1, z1, x2, y2, z2, c) {
  for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++)
    for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++)
      for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++) set(x, y, z, c);
}

let seed = 90210;
function rnd() { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }

// ── geometry ──────────────────────────────────────────────────────────────
// The player stands on the bank at the landward end of the pier. The pond sits
// to the north, so its centre is well behind the origin in z.
const CX = 0, CZ = -36;
const R = 30;                 // water out to 29, glass in the ring 29..30
const WALK_OUT = 36;          // walkway runs from the glass out to here
const WALL_OUT = 37;          // and the rock wall behind it

const TOP = 0;                // bank and waterline
const BOT = -25;              // pond floor

// Gallery floors. Each is 4 blocks of headroom with its own ceiling, and there
// is solid rock left between one ceiling and the next floor.
const LEVELS = [-8, -15, -22];
const OPEN = 4;

const dist = (x, z) => Math.hypot(x + 0.5 - CX, z + 0.5 - CZ);

const SPAN = WALL_OUT + 2;
const bbox = { x1: CX - SPAN, x2: CX + SPAN, z1: CZ - SPAN, z2: CZ + SPAN };

// ════════════════════════════════════════════════════ 1. THE MASS
// One solid block of rock, then everything else is cut out of it. Building it
// this way rather than trusting the terrain means a cave running into the site
// cannot open a hole into a gallery or drain the pond.
function mass() {
  for (let x = bbox.x1; x <= bbox.x2; x++)
    for (let z = bbox.z1; z <= bbox.z2; z++) {
      if (dist(x, z) > WALL_OUT) continue;
      box(x, BOT - 1, z, x, TOP, z, ROCK);
    }
}

// ════════════════════════════════════════════════════ 2. POND AND GLASS
function pond() {
  for (let x = bbox.x1; x <= bbox.x2; x++)
    for (let z = bbox.z1; z <= bbox.z2; z++) {
      const d = dist(x, z);
      if (d > R) continue;

      if (d <= R - 1) {
        // the water itself, on a gravel bed with a few sandy patches
        set(x, BOT, z, rnd() < 0.22 ? SAND : GRAVEL);
        for (let y = BOT + 1; y <= TOP; y++) W.set(key(x, y, z), WATER);
        continue;
      }

      // The wall. Glass from just under the waterline to the bed, with the top
      // two courses left as bank so the pond reads as ordinary from above.
      set(x, BOT, z, STONE);
      box(x, BOT + 1, z, x, TOP - 2, z, GLASS);
      box(x, TOP - 1, z, x, TOP, z, SOIL);
    }
}

// ════════════════════════════════════════════════════ 3. GALLERIES
function galleries() {
  for (let x = bbox.x1; x <= bbox.x2; x++)
    for (let z = bbox.z1; z <= bbox.z2; z++) {
      const d = dist(x, z);
      if (d <= R || d > WALL_OUT) continue;
      set(x, TOP, z, SOIL);                       // bank around the pond
      if (d > WALK_OUT) continue;                 // that band stays solid wall
      for (const f of LEVELS) {
        set(x, f, z, DECK);
        box(x, f + 1, z, x, f + OPEN, z, AIR);
        set(x, f + OPEN + 1, z, STONE);
      }
    }
}

// ════════════════════════════════════════════════════ 4. STAIR AND BRANCHES
// One straight flight dropping a block per step, running south away from the
// pond. Each gallery is reached by a corridor that leaves the flight sideways,
// so no corridor ever has to pass back through the steps above it.
const ST_X1 = -2, ST_X2 = 2;
const ST_Z0 = 3;                               // z of the top step, at ground level
const zOfDepth = (y) => ST_Z0 - y;             // step at z has y = ST_Z0 - z

const BRANCH = [
  { y: LEVELS[0], x1: 4, x2: 7 },
  { y: LEVELS[1], x1: -7, x2: -4 },
  { y: LEVELS[2], x1: 4, x2: 7 },
];

function stairs() {
  for (let k = 0; k <= -LEVELS[2]; k++) {
    const z = ST_Z0 + k, y = -k;
    box(ST_X1, y, z, ST_X2, y, z, STONE);
    box(ST_X1, y + 1, z, ST_X2, y + OPEN, z, AIR);
  }

  for (const b of BRANCH) {
    const z = zOfDepth(b.y);
    const east = b.x1 > 0;
    // a landing wide enough to turn on, bridging the flight to the corridor
    const lx1 = east ? ST_X2 + 1 : b.x1;
    const lx2 = east ? b.x2 : ST_X1 - 1;
    box(lx1, b.y, z - 1, lx2, b.y, z + 1, STONE);
    box(lx1, b.y + 1, z - 1, lx2, b.y + OPEN, z + 1, AIR);
    // and the corridor north into the gallery, through the outer wall
    box(b.x1, b.y, z, b.x2, b.y, -3, STONE);
    box(b.x1, b.y + 1, z, b.x2, b.y + OPEN, -3, AIR);
  }
}

// A small stone headhouse over the top of the stair, so there is something to
// walk into. Its door faces north, back toward the pier.
function headhouse() {
  box(-4, TOP, 1, 4, TOP, 8, SOIL);
  box(-3, TOP, 1, 3, TOP, ST_Z0, STONE);        // floor of the porch
  box(-4, TOP + 1, 1, 4, TOP + 5, 7, STONE);
  box(-3, TOP + 1, 2, 3, TOP + 4, 6, AIR);      // interior
  box(-1, TOP + 1, 1, 1, TOP + 3, 1, AIR);      // doorway
  for (const x of [-4, 4]) box(x, TOP + 1, 1, x, TOP + 5, 1, STONE);
}

// ════════════════════════════════════════════════════ 5. PIER
function pier() {
  const PX1 = -2, PX2 = 2, PZ1 = -20, PZ2 = -2;
  box(PX1, TOP + 1, PZ1, PX2, TOP + 1, PZ2, PLANK);
  for (let z = PZ1; z <= PZ2; z++)
    for (let x = PX1; x <= PX2; x++) box(x, TOP + 2, z, x, TOP + 5, z, AIR);

  // piles, carried all the way down to the bed so the pier reads from inside
  // the galleries as well as from the bank
  for (const z of [-8, -12, -16, -20])
    for (const x of [PX1, PX2]) {
      for (let y = BOT + 1; y <= TOP; y++) { set(x, y, z, POST); W.delete(key(x, y, z)); }
      set(x, BOT, z, STONE);
    }

  // railings down both sides and across the end, over the water only
  for (let z = PZ1; z <= -7; z++) {
    rail(PX1, TOP + 2, z);
    rail(PX2, TOP + 2, z);
  }
  for (let x = PX1; x <= PX2; x++) rail(x, TOP + 2, PZ1);
  for (const z of [-8, -12, -16, -20]) for (const x of [PX1, PX2]) lantern(x, TOP + 2, z);
}

const RAIL = [];
function rail(x, y, z) { RAIL.push([x, y, z]); }

// ════════════════════════════════════════════════════ 6. FITTING OUT
// A lantern hangs under a slab bracket, which avoids the ambiguous directional
// variants and never leaves a light attached to nothing.
function lantern(x, y, z) { set(x, y + 1, z, SLAB); put(x, y, z, 'lantern-small-down'); }

function fitOut() {
  for (const f of LEVELS) {
    for (let a = 0; a < 360; a += 15) {
      const t = (a * Math.PI) / 180;
      const lx = Math.round(CX + Math.cos(t) * (WALK_OUT - 0.5) - 0.5);
      const lz = Math.round(CZ + Math.sin(t) * (WALK_OUT - 0.5) - 0.5);
      if (get(lx, f + 1, lz) !== AIR) continue;
      lantern(lx, f + 3, lz);
    }
    // a few benches set back from the glass, looking into the water
    for (let a = 20; a < 360; a += 45) {
      const t = (a * Math.PI) / 180;
      const bx = Math.round(CX + Math.cos(t) * (R + 4) - 0.5);
      const bz = Math.round(CZ + Math.sin(t) * (R + 4) - 0.5);
      if (get(bx, f + 1, bz) !== AIR) continue;
      put(bx, f + 1, bz, 'chair-brown');
    }
  }
  // light the stair and the corridors
  for (let k = 2; k <= -LEVELS[2]; k += 5) lantern(ST_X1, ST_Z0 - k === 0 ? 3 : -k + 3, ST_Z0 + k);
  for (const b of BRANCH)
    for (let z = -2; z <= zOfDepth(b.y); z += 6) lantern(b.x1, b.y + 3, z);
}

// ════════════════════════════════════════════════════ 7. OPEN SKY, THEN SEAL
// Clear the air over the pond so the build is not left buried, and then wrap
// every underground opening in rock so nothing can break into it.
function skyAndSeal() {
  for (let x = bbox.x1; x <= bbox.x2; x++)
    for (let z = bbox.z1; z <= bbox.z2; z++) {
      if (dist(x, z) > WALL_OUT) continue;
      for (let y = TOP + 1; y <= TOP + 6; y++) if (get(x, y, z) === undefined) set(x, y, z, AIR);
    }

  const open = [];
  for (const [k, c] of M) if (c === AIR) open.push(k);
  for (const k of [...W.keys()]) open.push(k);
  for (const k of open) {
    const [x, y, z] = k.split(',').map(Number);
    if (y > -1) continue;                       // leave the surface alone
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]])
      if (get(x + dx, y + dy, z + dz) === undefined && !W.has(key(x + dx, y + dy, z + dz)))
        set(x + dx, y + dy, z + dz, ROCK);
  }
  // anything the sealing left exposed at ground level should read as bank
  for (const [k, c] of [...M]) {
    if (c !== ROCK) continue;
    const [x, y, z] = k.split(',').map(Number);
    if (y !== TOP) continue;
    const above = get(x, y + 1, z);
    if (above === undefined || above === AIR) M.set(k, SOIL);
  }
}

// ════════════════════════════════════════════════════ build
mass();
pond();
galleries();
// The headhouse lays its floor first and the stair then cuts the well down
// through it. The other way round, that floor seals the stair shut.
headhouse();
stairs();
pier();
skyAndSeal();
fitOut();

// railings, variant chosen from the neighbours that are also railings
const railSet = new Set(RAIL.map(([x, y, z]) => key(x, y, z)));
const DIRS = [['n', 0, -1], ['e', 1, 0], ['s', 0, 1], ['w', -1, 0]];
for (const [x, y, z] of RAIL) {
  const conn = DIRS.filter(([, dx, dz]) => railSet.has(key(x + dx, y, z + dz))).map(([d]) => d);
  put(x, y, z, `woodenfence-oak-${conn.length ? conn.join('') : 'empty'}-free`);
}

// ── emit ──────────────────────────────────────────────────────────────────
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
const waterLines = emit(W, () => true);
const furnLines = emit(F, () => true);

const all = [
  '# pond_aquarium: an ordinary looking pond with three storeys of aquarium under it.',
  '# Stand on the bank where the pier is to begin, facing NORTH, then /build pond_aquarium.',
  '# The pond is 60 across and 25 deep; its whole wall below the waterline is glass, with',
  '# walkway rings 8, 15 and 22 blocks down behind it. The stone headhouse behind you is',
  '# the way in. Water goes in after the glass so it has something to sit in.',
  '',
  '# Which way the build faces as written, so /build pond_aquarium north can turn it.',
  'facing south',
  '', '# --- cut the openings ---', ...airLines,
  '', '# --- rock, glass and structure ---', ...solidLines,
  '', '# --- fill the pond ---', ...waterLines,
  '', '# --- lanterns, railings and benches, last so nothing drops ---', ...furnLines,
];

writeFileSync(join(root, 'examples', 'pond_aquarium.txt'), all.join('\n'));
const solids = [...M.values()].filter((c) => c !== AIR).length;
console.log(`pond_aquarium.txt: ${all.length} lines (${airLines.length} clear + ${solidLines.length} build + ${waterLines.length} water + ${furnLines.length} fittings)`);
console.log(`  ${solids} solid, ${W.size} water, ${F.size} fittings, ${[...M.values()].filter((c) => c === AIR).length} cleared`);
