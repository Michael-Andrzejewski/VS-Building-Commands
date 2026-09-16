// Replay pond_aquarium and assert the things a render will not show you:
// that the water is actually held in, that all three walkway rings can be
// walked to from the door and walked all the way round, and that nothing is
// left floating.
//
//   node tools/verify-pond.mjs

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const name = process.argv[2] || 'pond_aquarium';

const map = new Map();
const cut = new Set();        // cells the script explicitly cleared to air
const n = (t) => (t[0] === '~' ? (t.slice(1) === '' ? 0 : parseInt(t.slice(1), 10)) : parseInt(t, 10));
for (const raw of readFileSync(join(root, 'examples', name + '.txt'), 'utf8').split(/\r?\n/)) {
  const l = raw.trim(); if (!l || l[0] === '#') continue;
  const p = l.split(/\s+/);
  if (p[0] === 'facing') continue;
  // Air the script places is not the same thing as ground it never touched,
  // and the enclosure check below turns on that difference.
  const put = (x, y, z, c) => {
    const k = `${x},${y},${z}`;
    if (c === 'air') { map.delete(k); cut.add(k); } else { map.set(k, c); cut.delete(k); }
  };
  if (p[0] === 'fill') {
    const [a, b, c1, d, e, f] = [n(p[1]), n(p[2]), n(p[3]), n(p[4]), n(p[5]), n(p[6])];
    for (let x = Math.min(a, d); x <= Math.max(a, d); x++)
      for (let y = Math.min(b, e); y <= Math.max(b, e); y++)
        for (let z = Math.min(c1, f); z <= Math.max(c1, f); z++) put(x, y, z, p[7]);
  } else if (p[0] === 'setblock') put(n(p[1]), n(p[2]), n(p[3]), p[4]);
}

const at = (x, y, z) => map.get(`${x},${y},${z}`);
const isWater = (x, y, z) => (at(x, y, z) || '').startsWith('water-');
const fails = [];
const check = (nm, ok, detail) => { console.log((ok ? '  ok   ' : '  FAIL ') + nm + (detail ? '   ' + detail : '')); if (!ok) fails.push(nm); };

const CX = 0, CZ = -36, R = 30, WALK_OUT = 36, TOP = 0, BOT = -25;
const LEVELS = [-8, -15, -22];
const dist = (x, z) => Math.hypot(x + 0.5 - CX, z + 0.5 - CZ);

console.log(`${name}: ${map.size} placed blocks`);

// ── 1. the pond holds water ────────────────────────────────────────────────
let leaks = 0, firstLeak = null;
for (const [k, c] of map) {
  if (!c.startsWith('water-')) continue;
  const [x, y, z] = k.split(',').map(Number);
  if (y >= TOP) continue;                       // the open surface is meant to be open
  for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    if (at(x + dx, y + dy, z + dz) === undefined) { leaks++; if (!firstLeak) firstLeak = `${x + dx},${y + dy},${z + dz}`; }
  }
}
check('every water block has something on all six sides', leaks === 0,
  leaks ? `${leaks} open faces, first at ${firstLeak}` : 'nothing open below the surface');

// water depth and width, against what he asked for
const depths = [];
for (let y = BOT; y <= TOP; y++) if (isWater(0, y, CZ)) depths.push(y);
check('pond is 20 to 30 deep', depths.length >= 20 && depths.length <= 30, `${depths.length} blocks of water`);
let width = 0;
for (let x = -60; x <= 60; x++) if (isWater(x, -12, CZ)) width++;
check('pond is 50 to 70 wide', width >= 50 && width <= 70, `${width} blocks of water across, ${2 * R} outside the glass`);

// ── 2. walk from the door ──────────────────────────────────────────────────
const solid = (x, y, z) => {
  const c = at(x, y, z);
  return !!c && !/^(woodenfence|lantern|chair|water-|slab)/.test(c) && !c.includes('slab');
};
const walk = (x, y, z) => !solid(x, y, z) && !solid(x, y + 1, z) && !isWater(x, y, z);
const start = [0, 1, 1];                         // just inside the headhouse door
const seen = new Set([start.join(',')]);
const q = [start];
while (q.length) {
  const [x, y, z] = q.shift();
  for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
    [1, 1, 0], [-1, 1, 0], [0, 1, 1], [0, 1, -1], [1, -1, 0], [-1, -1, 0], [0, -1, 1], [0, -1, -1]]) {
    const p = [x + dx, y + dy, z + dz], k = p.join(',');
    if (seen.has(k) || Math.abs(p[0]) > 80 || p[1] < BOT - 2 || p[1] > TOP + 8 || p[2] < CZ - 45 || p[2] > 40) continue;
    if (!walk(...p)) continue;
    // must be standing on something
    if (!solid(p[0], p[1] - 1, p[2])) continue;
    seen.add(k); q.push(p);
  }
}
console.log(`  ${seen.size} walkable cells reachable from the headhouse door`);

// every ring, at all four compass points, at walking height
for (let i = 0; i < LEVELS.length; i++) {
  const f = LEVELS[i];
  const pts = [[0, CZ - 33], [0, CZ + 33], [33, CZ], [-33, CZ]];
  const names = ['north', 'south', 'east', 'west'];
  const missing = pts.filter((p, j) => {
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++)
      if (seen.has([p[0] + a, f + 1, p[1] + b].join(','))) return false;
    return true;
  }).map((p, j) => names[j]);
  check(`walkway ${i + 1} (${f}) is reachable all the way round`, missing.length === 0,
    missing.length ? `cannot reach: ${missing.join(', ')}` : 'north, south, east and west all reached');
}

// and the ring really is a closed loop at each level: walk it by angle
for (let i = 0; i < LEVELS.length; i++) {
  const f = LEVELS[i];
  let gaps = 0;
  for (let a = 0; a < 360; a += 3) {
    const t = (a * Math.PI) / 180;
    let ok = false;
    for (let rr = R + 1; rr <= WALK_OUT && !ok; rr++) {
      const x = Math.round(CX + Math.cos(t) * rr - 0.5), z = Math.round(CZ + Math.sin(t) * rr - 0.5);
      if (seen.has([x, f + 1, z].join(','))) ok = true;
    }
    if (!ok) gaps++;
  }
  check(`walkway ${i + 1} (${f}) is a continuous ring`, gaps === 0, `${gaps} of 120 bearings blocked`);
}

// ── 3. you cannot walk into the pond from a gallery ────────────────────────
let wet = 0;
for (const k of seen) {
  const [x, y, z] = k.split(',').map(Number);
  if (y < TOP && dist(x, z) < R - 1) wet++;
}
check('no walkable cell is inside the water', wet === 0, `${wet} cells`);

// ── 4. the glass wall really wraps the pond ────────────────────────────────
let glassGaps = 0, glassCells = 0, firstGap = null;
for (const f of LEVELS)
  for (let y = f + 1; y <= f + 4; y++)
    for (let x = CX - 40; x <= CX + 40; x++)
      for (let z = CZ - 40; z <= CZ + 40; z++) {
        const d = dist(x, z);
        if (d <= R - 1 || d > R) continue;
        glassCells++;
        if ((at(x, y, z) || '').startsWith('glass')) continue;
        glassGaps++;
        if (!firstGap) firstGap = `${x},${y},${z} is ${at(x, y, z) || 'air'}`;
      }
check('every wall cell beside a walkway is glass', glassGaps === 0,
  glassGaps ? `${glassGaps} of ${glassCells} not glass, first ${firstGap}` : `all ${glassCells} of them`);

// ── 5. nothing left floating ───────────────────────────────────────────────
let floating = 0;
for (const [k, c] of map) {
  if (!/^(lantern|chair|woodenfence)/.test(c)) continue;
  const [x, y, z] = k.split(',').map(Number);
  const up = at(x, y + 1, z), down = at(x, y - 1, z);
  if (c.startsWith('lantern') && !up) floating++;
  if (!c.startsWith('lantern') && !down) floating++;
}
check('no lantern or railing attached to nothing', floating === 0, `${floating} floating`);

// ── 6. every underground opening is wrapped in rock ─────────────────────
// The stair and corridors are cut through ground the build does not otherwise
// touch, so without a sleeve of rock a cave could open straight into them.
let exposed = 0, firstExposed = null;
for (const k of seen) {
  const [x, y, z] = k.split(',').map(Number);
  if (y > -1) continue;
  for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    const nk = `${x + dx},${y + dy},${z + dz}`;
    if (at(x + dx, y + dy, z + dz) === undefined && !cut.has(nk)) {
      exposed++; if (!firstExposed) firstExposed = nk;
    }
  }
}
check('every underground walkable cell is wrapped in something', exposed === 0,
  exposed ? `${exposed} open faces, first at ${firstExposed}` : 'stair, corridors and galleries all sleeved');

console.log(fails.length ? `\n${fails.length} FAILED` : '\nall pond checks pass');
process.exit(fails.length ? 1 : 0);
