// Generator for the Building Commands ruin/shipwreck/city scripts.
// Run:  node tools/gen.js
// Emits .txt build scripts into ../examples (one per structure).
// Every coordinate is tilde-relative, so /build <name> centers on the player.
//
// Design goals: everything heavily ruined. No complete walls, holes
// everywhere, crumbled tops, scattered debris piles, and ONLY collapsed
// loot chests (the lootchest directive).

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'examples');

// ── output buffer ────────────────────────────────────────────────────────
let lines = [];
const L = (s) => lines.push(s);
const T = (n) => (n === 0 ? '~' : '~' + n);
function F(x1, y1, z1, x2, y2, z2, block, mode) {
  L(`fill ${T(x1)} ${T(y1)} ${T(z1)} ${T(x2)} ${T(y2)} ${T(z2)} ${block}${mode ? ' ' + mode : ''}`);
}
// single block: setblock is lighter than a 1x1 fill (no per-block bulk
// accessor + relight). Works in scripts even where /setblock is /cbsetblock.
const S = (x, y, z, block) => L(`setblock ${T(x)} ${T(y)} ${T(z)} ${block}`);
const AIR = (x, y, z) => S(x, y, z, 'air');
// settling debris: the runner drops it onto the first solid surface below
// the scripted spot (and places nothing when there is none), so debris and
// rubble mounds can never float when a structure lands on a sloped floor.
// count > 1 stacks a small column upward from the support.
const SC = (x, y, z, block, count) =>
  L(`scatter ${T(x)} ${T(y)} ${T(z)} ${block}${count && count > 1 ? ' ' + count : ''}`);

// ruined floor: one base fill, a few accent patches, then punched holes,
// instead of thousands of per-cell lines.
function floorRuined(x1, z1, x2, z2, y) {
  F(x1, y, z1, x2, y, z2, 'game:cobblestone-granite');
  const area = (x2 - x1 + 1) * (z2 - z1 + 1);
  for (let i = 0; i < Math.floor(area / 40); i++) {
    const px = ri(x1, x2), pz = ri(z1, z2);
    F(px, y, pz, Math.min(x2, px + ri(1, 3)), y, Math.min(z2, pz + ri(1, 3)), pick(['game:cobblestone-limestone', 'game:cobblestone-andesite']));
  }
  for (let i = 0; i < Math.floor(area * 0.16); i++) {
    const px = ri(x1, x2), pz = ri(z1, z2);
    F(px, y, pz, Math.min(x2, px + ri(0, 1)), y, Math.min(z2, pz + ri(0, 1)), 'air');
  }
}
// collapsed loot chest. The runners settle chests onto the nearest support
// below at placement time (no more scripted support block, which itself
// could float on slopes). Only the 2/3 variants look properly burst-open;
// 1 and 4 look near-intact. The variant arg is ignored.
const CH = (x, y, z, _variant, side) => {
  L(`lootchest ${T(x)} ${T(y)} ${T(z)} ${pick([2, 3])} ${side}`);
};
// creature spawner spot (Underwater Horrors). The mod's runner rolls the
// serpent / kraken chance at build time. Raised on a pillar (pillarFrom up
// to just below the spawner) so the creature spawns in open water above
// the structure instead of embedded in its floor; without pillarFrom it
// just gets a single support block beneath.
const SPAWN = (x, y, z, pillarFrom, block) => {
  const b = block || 'game:cobblestone-granite';
  if (pillarFrom !== undefined && pillarFrom < y) F(x, pillarFrom, z, x, y - 1, z, b);
  else S(x, y - 1, z, b);
  L(`spawner ${T(x)} ${T(y)} ${T(z)}`);
};
// ingot pile: mostly silver / copper / molybdochalkos, an occasional very large
// gold hoard, and some small steel piles. Settled onto real support by the
// runners at placement time, same as chests.
const INGOTS = (x, y, z) => {
  const r = rnd();
  let metal, count;
  if (r < 0.09) { metal = 'gold'; count = ri(48, 64); }          // rare, very large
  else if (r < 0.24) { metal = 'steel'; count = ri(3, 10); }     // uncommon, small
  else { metal = pick(['silver', 'copper', 'molybdochalkos']); count = ri(12, 40); }
  L(`ingots ${T(x)} ${T(y)} ${T(z)} ${metal} ${count}`);
};
// scatter loot chests + ingot piles across a floor rectangle at height y
function rewards(x1, z1, x2, z2, y, nChests, nIngots) {
  for (let i = 0; i < nChests; i++) CH(ri(x1, x2), y, ri(z1, z2), 0, pick(SIDES));
  for (let i = 0; i < nIngots; i++) INGOTS(ri(x1, x2), y, ri(z1, z2));
}

// ── seeded rng (stable output; bump SEED to reroll) ──────────────────────
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rnd = mulberry32(1);
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const chance = (p) => rnd() < p;
const SIDES = ['north', 'east', 'south', 'west'];
const round = Math.round;

// ── block palettes ───────────────────────────────────────────────────────
const P = {
  wall: ['game:stonebricks-granite', 'game:stonebricks-limestone', 'game:stonebricks-andesite'],
  cobble: ['game:cobblestone-granite', 'game:cobblestone-limestone', 'game:cobblestone-andesite'],
  brick: ['game:brickruin-irregular-gray', 'game:brickruin-irregular-brown', 'game:brickruin-irregular-tan', 'game:brickruin-irregular-red'],
  wood: ['game:planks-aged-ud', 'game:planks-veryaged-ud'],
  woodAny: ['game:planks-aged-ud', 'game:planks-veryaged-ud', 'game:planks-aged-ns', 'game:planks-aged-we'],
  beam: ['game:log-placed-aged-ud', 'game:log-placed-aged-ns', 'game:log-placed-aged-we'],
  debris: ['game:metal-scraps', 'game:metal-parts', 'game:loosegears', 'game:looseflints', 'game:loosestick', 'game:cobblestone-granite'],
  metalDebris: ['game:metal-scraps', 'game:metal-parts', 'game:loosegears'],
  dev: ['game:devgrowth-shard', 'game:devgrowth-thorns', 'game:devgrowth-shrike'],
  vessel: ['game:lootvessel-tool', 'game:lootvessel-ore', 'game:lootvessel-forage', 'game:lootvessel-farming', 'game:lootvessel-food'],
  light: 'underwaterhorrors:ghostlight-green',   // eerie green wisp
  lightAlt: 'underwaterhorrors:ghostlight-blue', // pale blue wisp
};

// scatter n debris blocks over a floor rectangle at height y (each one
// settles onto the actual surface below via the scatter directive)
function scatterDebris(x1, z1, x2, z2, y, n, blocks) {
  blocks = blocks || P.debris;
  for (let i = 0; i < n; i++) SC(ri(x1, x2), y, ri(z1, z2), pick(blocks));
}

// punch h air holes into an axis-aligned wall region
function punchHoles(x1, y1, z1, x2, y2, z2, h) {
  for (let i = 0; i < h; i++) {
    const x = ri(x1, x2), y = ri(y1, y2), z = ri(z1, z2), s = ri(0, 2);
    F(x, y, z, Math.min(x2, x + (x1 === x2 ? 0 : s)), Math.min(y2, y + s), Math.min(z2, z + (z1 === z2 ? 0 : s)), 'air');
  }
}

// ── a ruined rectangular building: crumbled-top walls with holes, broken
//    floor, some interior debris/chests/light ─────────────────────────────
function ruinedBuilding(cx, cz, w, d, h, floorY, opts) {
  opts = opts || {};
  const wallBlocks = opts.walls || P.wall.concat(P.brick);
  const x1 = cx - w, x2 = cx + w, z1 = cz - d, z2 = cz + d;

  // floor (broken)
  floorRuined(x1, z1, x2, z2, floorY);

  // four crumbling walls: solid bulk fill + crumbled top rows + holes
  const top = floorY + h;
  for (const [ax, wx1, wz1, wx2, wz2] of [
    ['x', x1, z1, x1, z2], ['x', x2, z1, x2, z2],
    ['z', x1, z1, x2, z1], ['z', x1, z2, x2, z2],
  ]) {
    const wb = pick(wallBlocks);
    F(wx1, floorY + 1, wz1, wx2, top - 2, wz2, wb);          // bulk
    // crumbled top two rows
    if (ax === 'x') {
      for (let z = wz1; z <= wz2; z++) {
        if (chance(0.55)) S(wx1, top - 1, z, wb);
        if (chance(0.28)) S(wx1, top, z, wb);
      }
    } else {
      for (let x = wx1; x <= wx2; x++) {
        if (chance(0.55)) S(x, top - 1, wz1, wb);
        if (chance(0.28)) S(x, top, wz1, wb);
      }
    }
    punchHoles(wx1, floorY + 1, wz1, wx2, top - 2, wz2, Math.max(2, Math.floor(h * (opts.holes || 0.9))));
  }

  // doorway gap on a random wall
  const dz = pick([z1, z2]);
  F(cx - 1, floorY + 1, dz, cx + 1, floorY + 2, dz, 'air');

  // interior floors -> distinct levels; a chest and sometimes a light on each
  for (let ly = floorY + 4; ly <= top - 2; ly += 4) {
    F(x1 + 1, ly, z1 + 1, x2 - 1, ly, z2 - 1, pick(P.cobble));
    if (chance(0.65)) CH(cx + ri(-w + 1, w - 1), ly + 1, cz + ri(-d + 1, d - 1), 0, pick(SIDES));
    if (chance(0.3)) INGOTS(cx + ri(-w + 1, w - 1), ly + 1, cz + ri(-d + 1, d - 1));
    if (chance(0.4)) S(cx + ri(-w + 1, w - 1), ly + 1, cz + ri(-d + 1, d - 1), chance(0.5) ? P.light : P.lightAlt);
    scatterDebris(x1 + 1, z1 + 1, x2 - 1, z2 - 1, ly + 1, ri(1, 2), P.debris);
  }

  // interior: a light, some debris, a chest or two, maybe an ingot hoard
  if (opts.light !== false) S(cx, top - 1, cz, chance(0.5) ? P.light : P.lightAlt);
  scatterDebris(x1 + 1, z1 + 1, x2 - 1, z2 - 1, floorY + 1, ri(2, 5), P.debris);
  const nch = opts.chests != null ? opts.chests : ri(0, 2);
  for (let i = 0; i < nch; i++) CH(cx + ri(-w + 1, w - 1), floorY + 1, cz + ri(-d + 1, d - 1), 0, pick(SIDES));
  const nin = opts.ingots != null ? opts.ingots : 0;
  for (let i = 0; i < nin; i++) INGOTS(cx + ri(-w + 1, w - 1), floorY + 1, cz + ri(-d + 1, d - 1));
}

// ── header + write ───────────────────────────────────────────────────────
function begin(header) { lines = []; header.split('\n').forEach((h) => L('# ' + h)); }
function write(name) {
  fs.writeFileSync(path.join(OUT, name + '.txt'), lines.join('\n') + '\n');
  console.log(`${name}.txt  (${lines.length} lines)`);
}

// ═══════════════════════════════════════════════════════════════════════
//  1. ruin  — the small hall, now much more ruined
// ═══════════════════════════════════════════════════════════════════════
function ruin() {
  rnd = mulberry32(11);
  begin('Sunken underwater ruin (heavily ruined). Stand at the center, then /build ruin');
  const fy = -1, w = 6, d = 8, h = 6;
  const x1 = -w, x2 = w, z1 = -d, z2 = d;

  // broken cobble floor
  floorRuined(x1, z1, x2, z2, fy);

  // walls, crumbled + holed
  const top = fy + h;
  for (const [ax, wx1, wz1, wx2, wz2] of [['x', x1, z1, x1, z2], ['x', x2, z1, x2, z2], ['z', x1, z1, x2, z1], ['z', x1, z2, x2, z2]]) {
    const wb = pick(P.wall);
    F(wx1, fy + 1, wz1, wx2, top - 3, wz2, wb);
    if (ax === 'x') for (let z = wz1; z <= wz2; z++) { if (chance(0.5)) S(wx1, top - 2, z, wb); if (chance(0.35)) S(wx1, top - 1, z, wb); if (chance(0.15)) S(wx1, top, z, wb); }
    else for (let x = wx1; x <= wx2; x++) { if (chance(0.5)) S(x, top - 2, wz1, wb); if (chance(0.35)) S(x, top - 1, wz1, wb); if (chance(0.15)) S(x, top, wz1, wb); }
    punchHoles(wx1, fy + 1, wz1, wx2, top - 2, wz2, 10);
  }
  // big collapsed openings
  F(-w, top - 2, -3, -w, top, 3, 'air');
  F(2, fy + 3, z2, w, top, z2, 'air');
  // doorway
  F(-1, 0, z1, 1, 2, z1, 'air');

  // pillars every few blocks along each wall to tie the crumbled segments
  // together so the walls read as connected
  for (const [ax, wx1, wz1, wx2, wz2] of [['x', x1, z1, x1, z2], ['x', x2, z1, x2, z2], ['z', x1, z1, x2, z1], ['z', x1, z2, x2, z2]]) {
    if (ax === 'x') for (let z = wz1; z <= wz2; z += 4) for (let y = fy + 1; y <= top; y++) S(wx1, y, z, pick(P.wall));
    else for (let x = wx1; x <= wx2; x += 4) for (let y = fy + 1; y <= top; y++) S(x, y, wz1, pick(P.wall));
  }
  // pillars holding up the green lights
  for (const [lx, lz] of [[-4, -6], [4, -6], [-4, 6], [4, 6], [0, 0]]) {
    for (let y = fy + 1; y < top - 1; y++) S(lx, y, lz, pick(P.wall));
    S(lx, top - 1, lz, P.light);
  }
  // debris piles
  scatterDebris(x1 + 1, z1 + 1, x2 - 1, z2 - 1, fy + 1, 22, P.debris);
  // collapsed chests + ingot hoards scattered on the floor
  CH(-4, 0, -5, 2, 'north'); CH(4, 0, 5, 3, 'south'); CH(-3, 0, 6, 1, 'north'); CH(4, 0, -4, 4, 'west'); CH(0, 0, -3, 2, 'east');
  rewards(x1 + 1, z1 + 1, x2 - 1, z2 - 1, 0, 9, 5);
  // cracked vessels
  SC(3, 0, -3, pick(P.vessel)); SC(-2, 0, 3, pick(P.vessel)); SC(2, 0, 4, pick(P.vessel));
  // two creature spawner spots on pillars above the walls (runner rolls the
  // serpent / kraken chance)
  SPAWN(2, top + 2, 3, 0); SPAWN(-3, top + 2, -2, 0);
  write('ruin');
}

// ═══════════════════════════════════════════════════════════════════════
//  2. portal  — circular sunken portal with pillars, lights, chests
// ═══════════════════════════════════════════════════════════════════════
function portal() {
  rnd = mulberry32(22);
  begin('Sunken circular portal. Stand at the center, then /build portal');
  const fy = -1, R = 9;

  // ring platform (2 rings of cobble, broken)
  for (let a = 0; a < 360; a += 4) {
    const rad = a * Math.PI / 180;
    for (const rr of [R, R - 1, R - 2]) {
      const x = round(Math.cos(rad) * rr), z = round(Math.sin(rad) * rr);
      if (chance(0.75)) S(x, fy, z, pick(P.cobble));
    }
  }
  // inner floor disc, broken
  for (let x = -R + 2; x <= R - 2; x++) for (let z = -R + 2; z <= R - 2; z++) if (x * x + z * z <= (R - 2) * (R - 2) && chance(0.6)) S(x, fy, z, pick(P.cobble));

  // dark portal ring standing up (a broken circular wall of dark brick)
  for (let a = 0; a < 360; a += 6) {
    const rad = a * Math.PI / 180;
    const x = round(Math.cos(rad) * (R - 2)), z = round(Math.sin(rad) * (R - 2));
    const hh = ri(0, 4); // crumbled height
    for (let y = fy + 1; y <= fy + hh; y++) if (chance(0.7)) S(x, y, z, pick(['game:stonebricks-basalt', 'game:brickruin-irregular-gray']));
  }

  // 6 pillars around the ring, some broken, with a light on top
  for (let i = 0; i < 6; i++) {
    const a = i * 60 * Math.PI / 180;
    const x = round(Math.cos(a) * R), z = round(Math.sin(a) * R);
    const ph = ri(2, 6);
    for (let y = fy + 1; y <= fy + ph; y++) S(x, y, z, pick(P.wall));
    if (chance(0.8)) S(x, fy + ph + 1, z, chance(0.5) ? P.light : P.lightAlt);
    // rubble at the base
    scatterDebris(x - 1, z - 1, x + 1, z + 1, fy + 1, ri(1, 3), P.debris);
  }

  // central ruined portal FRAME (a broken doorway you can see through, with
  // green energy glowing inside), like a Minecraft ruined portal.
  const fh = 6, fw = 3, frameB = 'game:stonebricks-basalt';
  for (const cxx of [-fw, fw]) for (let y = fy + 1; y <= fy + fh; y++) if (chance(0.82)) S(cxx, y, 0, frameB);      // columns
  for (let x = -fw; x <= fw; x++) { if (chance(0.75)) S(x, fy + fh, 0, frameB); if (chance(0.85)) S(x, fy + 1, 0, frameB); } // lintel + threshold
  for (let x = -fw + 1; x <= fw - 1; x++) for (let y = fy + 2; y <= fy + fh - 1; y++) if (chance(0.82)) S(x, y, 0, P.light); // energy
  // a broken second frame crossing it for a more elaborate portal
  for (const czz of [-fw, fw]) for (let y = fy + 1; y <= fy + fh - 1; y++) if (chance(0.6)) S(0, y, czz, frameB);
  for (let z = -fw + 1; z <= fw - 1; z++) for (let y = fy + 2; y <= fy + fh - 2; y++) if (chance(0.6)) S(0, y, z, P.lightAlt);

  // scattered collapsed chests + ingot hoards around the ring
  for (let i = 0; i < 13; i++) {
    const a = rnd() * Math.PI * 2, rr = ri(4, R - 1);
    CH(round(Math.cos(a) * rr), fy + 1, round(Math.sin(a) * rr), 0, pick(SIDES));
  }
  for (let i = 0; i < 4; i++) {
    const a = rnd() * Math.PI * 2, rr = ri(4, R - 1);
    INGOTS(round(Math.cos(a) * rr), fy + 1, round(Math.sin(a) * rr));
  }
  // debris and cracked vessels scattered inside the ring
  for (let i = 0; i < 30; i++) { const a = rnd() * Math.PI * 2, rr = ri(1, R - 1); SC(round(Math.cos(a) * rr), fy + 1, round(Math.sin(a) * rr), pick(P.debris)); }
  for (let i = 0; i < 4; i++) { const a = rnd() * Math.PI * 2, rr = ri(2, R - 2); SC(round(Math.cos(a) * rr), fy + 1, round(Math.sin(a) * rr), pick(P.vessel)); }
  // two creature spawner spots on pillars above the portal frame
  SPAWN(3, fy + fh + 2, 3, 0); SPAWN(-4, fy + fh + 2, 2, 0);
  write('portal');
}

// ═══════════════════════════════════════════════════════════════════════
//  shipwreck hull generator (shared)
// ═══════════════════════════════════════════════════════════════════════
// A boat-shaped hull: curved SOLID bottom, solid sides up to a broken deck
// rim, pointed bow/stern. tiltDeg rotates the whole cross-section so the
// wreck lies over on its side. Heavily holed for ruin.
function ship({ name, length, tiltDeg, chests, dev, seed, W, H, DEPTH, spawners }) {
  rnd = mulberry32(seed);
  W = W || 8; H = H || 10; DEPTH = DEPTH || 5;
  begin(`Sunken shipwreck (${name}). Stand at the CENTER, then /build ${name}`);
  const tilt = tiltDeg * Math.PI / 180, cs = Math.cos(tilt), sn = Math.sin(tilt);
  const half = Math.floor(length / 2);
  const rot = (x, y) => [x * cs - y * sn, x * sn + y * cs];

  let minY = 1e9;
  for (let sx = -W - 2; sx <= W + 2; sx++) for (let sy = -DEPTH - 1; sy <= H + 1; sy++) { const ry = rot(sx, sy)[1]; if (ry < minY) minY = ry; }
  const yOff = -1 - round(minY);
  const put = (sx, sy, z, block) => { const [rx, ry] = rot(sx, sy); S(round(rx), round(ry) + yOff, z, block); };
  const hole = () => chance(0.13);
  const keel = (sx, w, dep) => -round(dep * Math.sqrt(Math.max(0, 1 - (sx / (w + 0.01)) * (sx / (w + 0.01)))));

  const devSpots = [];
  for (let zc = -half; zc <= half; zc++) {
    const u = (zc + half) / length;
    let taper = Math.min(1, Math.min(u, 1 - u) / 0.15);
    taper = Math.pow(taper, 0.5);                    // full amidships, pointed ends
    const w = Math.max(1, round(W * taper));
    const dep = Math.max(1, round(DEPTH * taper));

    // curved hull bottom (keel spine always present), thin
    for (let sx = -w; sx <= w; sx++) {
      const ky = keel(sx, w, dep);
      if (sx === 0 || !hole()) put(sx, ky, zc, sx === 0 ? pick(P.beam) : pick(P.wood));
    }
    // hull sides (one column each), wrecked: partway up most of the time,
    // full deck height only at rib segments
    for (const sx of [-w, w]) {
      const ky = keel(sx, w, dep);
      const topY = (zc % 6 === 0) ? H : Math.min(H, ky + 1 + ri(2, Math.max(3, H - 2)));
      for (let y = ky + 1; y <= topY; y++) if (!hole()) put(sx, y, zc, chance(0.12) ? pick(P.beam) : pick(P.wood));
    }
    // broken deck rim (gunwale)
    for (let sx = -w; sx <= w; sx++) if (chance(0.4)) put(sx, H, zc, pick(P.woodAny));
    // ribs every 6 segments
    if (zc % 6 === 0) for (let sx = -w; sx <= w; sx++) put(sx, keel(sx, w, dep), zc, pick(P.beam));
    if (dev && chance(0.05)) devSpots.push([w, zc]);
  }

  // interior bulkheads -> recognizable rooms, mostly intact with a doorway
  const dims = (zc) => { const u = (zc + half) / length; const t = Math.pow(Math.min(1, Math.min(u, 1 - u) / 0.15), 0.5); return [Math.max(1, round(W * t)), Math.max(1, round(DEPTH * t))]; };
  const bstep = Math.max(9, round(length / 7));
  for (let bz = -half + bstep; bz <= half - bstep; bz += bstep) {
    const [w, dep] = dims(bz);
    for (let sx = -w + 1; sx <= w - 1; sx++) {
      const ky = keel(sx, w, dep);
      for (let y = ky + 1; y <= H - 1; y++) {
        if (Math.abs(sx) <= 1 && y <= ky + 3) continue; // doorway through the bulkhead
        if (chance(0.85)) put(sx, y, bz, pick(P.wood));
      }
    }
  }

  // devastation clusters bursting out of the hull
  for (const [w, zc] of devSpots) {
    const dir = chance(0.5) ? 1 : -1;
    for (let k = 0; k <= ri(2, 6); k++) put((w + k) * dir, ri(0, H), zc, pick(P.dev));
  }
  if (dev) for (const zc of [-half + 4, half - 4, 0]) for (let k = 0; k < ri(4, 8); k++) put(ri(-W, W), ri(0, H), zc + ri(-3, 3), pick(P.dev));

  // interior lights along the length
  for (let zc = -half + 5; zc <= half - 5; zc += ri(9, 15)) put(ri(-3, 3), ri(1, Math.max(2, H - 3)), zc, chance(0.5) ? P.light : P.lightAlt);

  // collapsed chests + ingot cargo resting on the inner hull bottom (the
  // hold), run through the same tilt transform as the hull itself so they
  // sit inside the wreck instead of dropping to the sea floor beneath it.
  // CH/INGOTS still add a support block directly below, which doubles as a
  // hull-plank patch when the spot lands over a punched hole.
  const holdSpot = (zc) => {
    const [w, dep] = dims(zc);
    const sx = ri(-Math.max(0, w - 2), Math.max(0, w - 2));
    const sy = keel(sx, w, dep) + 1;
    const [rx, ry] = rot(sx, sy);
    return [round(rx), round(ry) + yOff, zc];
  };
  for (let i = 0; i < chests; i++) {
    const [x, y, z] = holdSpot(ri(-half + 4, half - 4));
    CH(x, y, z, 0, pick(SIDES));
  }
  const ni = Math.max(2, round(chests * 0.8));
  for (let i = 0; i < ni; i++) {
    const [x, y, z] = holdSpot(ri(-half + 4, half - 4));
    INGOTS(x, y, z);
  }

  // creature spawner(s) atop broken masts rising from the deck, spread along
  // the length, so the creature spawns in open water above the hull. The old
  // fore/aft spacing overshot the stern for 3+ spawners (i * 0.8 * half with
  // no divisor), which left the huge wreck's third spawner outside the ship.
  const ns = spawners || 1;
  const [mrx, mry] = rot(0, H);
  const mastX = round(mrx), deckY = round(mry) + yOff;
  for (let i = 0; i < ns; i++) {
    const zc = ns > 1 ? round(-half * 0.4 + i * (half * 0.8 / (ns - 1))) : ri(-half + 6, half - 6);
    SPAWN(mastX, deckY + 4, zc, 0, pick(P.beam));
  }

  // debris trailing out of the wreck on the sea floor (settles onto the
  // real floor, so the trail follows slopes instead of hovering at y=0)
  for (let i = 0; i < Math.floor(length * 1.0); i++) SC(ri(-W - 5, W + 5), 2, ri(-half - 4, half + 4), pick(P.debris));
  for (let i = 0; i < Math.max(2, Math.floor(chests / 3)); i++) S(ri(-3, 3), 0, ri(-half, half), pick(P.vessel));

  write(name);
}

// ═══════════════════════════════════════════════════════════════════════
//  5. city  — 40x40 crumbling flooded ruins
// ═══════════════════════════════════════════════════════════════════════
function city() {
  rnd = mulberry32(55);
  begin('Sunken ruined city, organic ~46-wide footprint. Stand at the CENTER, then /build city');
  const fy = -1, R = 20;

  // organic footprint: the union of overlapping discs instead of a hard
  // 40x40 square, so the edge meanders and reads as natural decay
  const patches = [[0, 0, 15]];
  for (let i = 0; i < 10; i++) patches.push([ri(-9, 9), ri(-9, 9), ri(9, 13)]);
  const inside = (x, z) => {
    for (const [pcx, pcz, pr] of patches) {
      const dx = x - pcx, dz = z - pcz;
      if (dx * dx + dz * dz <= pr * pr) return true;
    }
    return false;
  };

  // street floor + a 3-deep rubble plinth below it, emitted as row runs.
  // The plinth anchors the city into sloped sea floors: on flat ground it
  // stays buried, on a slope the downhill edge shows a bank of rubble
  // instead of a floating slab.
  const B = R + 6;
  const plinthBlocks = ['game:cobblestone-granite', 'game:gravel-granite', 'game:cobblestone-andesite', 'game:gravel-andesite'];
  for (let z = -B; z <= B; z++) {
    let runStart = null;
    for (let x = -B; x <= B + 1; x++) {
      const inBlob = x <= B && inside(x, z);
      if (inBlob && runStart === null) runStart = x;
      if (!inBlob && runStart !== null) {
        F(runStart, fy, z, x - 1, fy, z, pick(P.cobble));
        F(runStart, fy - 3, z, x - 1, fy - 1, z, pick(plinthBlocks));
        runStart = null;
      }
    }
  }
  // floor accents + punched holes (only where the blob exists)
  for (let i = 0; i < 34; i++) {
    const px = ri(-R, R), pz = ri(-R, R);
    if (inside(px, pz)) F(px, fy, pz, Math.min(R, px + ri(1, 3)), fy, Math.min(R, pz + ri(1, 3)), pick(['game:cobblestone-limestone', 'game:cobblestone-andesite']));
  }
  for (let i = 0; i < 200; i++) {
    const px = ri(-R, R), pz = ri(-R, R);
    if (inside(px, pz)) AIR(px, fy, pz);
  }

  // buildings on a jittered grid, only where the footprint exists
  const step = 11;
  for (let gx = -R + 6; gx <= R - 6; gx += step) {
    for (let gz = -R + 6; gz <= R - 6; gz += step) {
      const cx = gx + ri(-2, 2), cz = gz + ri(-2, 2);
      if (!inside(cx, cz)) continue;
      const w = ri(3, 5), d = ri(3, 5);
      const tower = chance(0.35);
      const h = tower ? ri(14, 26) : ri(5, 9);
      ruinedBuilding(cx, cz, w, d, h, fy, { chests: ri(2, 4), ingots: ri(0, 2), holes: 1.0 });
      // rubble ring around each building
      scatterDebris(cx - w - 2, cz - d - 2, cx + w + 2, cz + d + 2, fy + 1, ri(4, 9), P.debris);
    }
  }

  // collapsed rubble mounds along the rim so the edge tapers off instead
  // of stopping dead, plus a few big fallen wall slabs in the streets.
  // Both are emitted as settling scatter columns: the rim mounds sit partly
  // outside the plinth, so on a slope each column drapes down to the real
  // floor instead of hovering (the floating debris piles players reported).
  for (let i = 0; i < 14; i++) {
    const a = rnd() * Math.PI * 2, rr = R - ri(0, 4);
    const mx = round(Math.cos(a) * rr), mz = round(Math.sin(a) * rr);
    const mh = ri(2, 4), mw = ri(1, 2);
    for (let dx = -mw; dx <= mw; dx++) for (let dz = -mw; dz <= mw; dz++) {
      const hh = Math.max(0, mh - Math.abs(dx) - Math.abs(dz) - ri(0, 1));
      if (hh > 0) SC(mx + dx, fy + 1, mz + dz, pick(P.cobble.concat(P.brick)), hh);
    }
  }
  for (let i = 0; i < 5; i++) {
    const x = ri(-R + 4, R - 4), z = ri(-R + 4, R - 4);
    if (!inside(x, z)) continue;
    const len = ri(4, 7), vert = chance(0.5), wb = pick(P.brick);
    for (let j = 0; j < len; j++) for (let k = 0; k < 2; k++)
      if (chance(0.85)) SC(vert ? x + k : x + j, fy + 1, vert ? z + j : z + k, wb);
  }

  // extra debris, loose chests and ingot hoards scattered in the streets
  for (let i = 0; i < 90; i++) {
    const x = ri(-R, R), z = ri(-R, R);
    if (inside(x, z)) SC(x, fy + 1, z, pick(P.debris));
  }
  let placed = 0, tries = 0;
  while (placed < 20 && tries++ < 500) {
    const x = ri(-R + 2, R - 2), z = ri(-R + 2, R - 2);
    if (!inside(x, z)) continue;
    CH(x, fy + 1, z, 0, pick(SIDES)); placed++;
  }
  placed = 0; tries = 0;
  while (placed < 8 && tries++ < 500) {
    const x = ri(-R + 2, R - 2), z = ri(-R + 2, R - 2);
    if (!inside(x, z)) continue;
    INGOTS(x, fy + 1, z); placed++;
  }
  for (let i = 0; i < 8; i++) {
    const x = ri(-R + 2, R - 2), z = ri(-R + 2, R - 2);
    if (inside(x, z)) SC(x, fy + 1, z, pick(P.vessel));
  }
  // a few standing broken archways / walls between buildings
  for (let i = 0; i < 8; i++) {
    const x = ri(-R + 3, R - 3), z = ri(-R + 3, R - 3), len = ri(3, 7), vert = chance(0.5), hh = ri(3, 8), wb = pick(P.brick);
    if (!inside(x, z)) continue;
    for (let j = 0; j < len; j++) { const th = hh - ri(0, 3); for (let y = fy + 1; y <= fy + th; y++) if (chance(0.7)) S(vert ? x : x + j, y, vert ? z + j : z, wb); }
  }
  // two creature spawner spots on tall rubble pillars above the rooftops
  SPAWN(2, 10, 2, 0); SPAWN(-6, 10, -5, 0);
  write('city');
}

// ── run all ──────────────────────────────────────────────────────────────
ruin();
portal();
ship({ name: 'shipwreck-huge', length: 110, tiltDeg: 26, chests: 30, dev: true, seed: 33, W: 11, H: 13, DEPTH: 6, spawners: 3 });
ship({ name: 'shipwreck-small', length: 34, tiltDeg: 24, chests: 8, dev: false, seed: 44, W: 6, H: 8, DEPTH: 4, spawners: 1 });
ship({ name: 'shipwreck-medium', length: 50, tiltDeg: 0, chests: 15, dev: false, seed: 66, W: 8, H: 10, DEPTH: 5, spawners: 2 });
city();
console.log('done');
