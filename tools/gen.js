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
// collapsed loot chest. Always drop a support block directly beneath it so the
// chest can never float, and only use the 2/3 variants (the ones that actually
// look burst-open; 1 and 4 look near-intact). The variant arg is ignored.
const CH = (x, y, z, _variant, side) => {
  S(x, y - 1, z, 'game:cobblestone-granite');
  L(`lootchest ${T(x)} ${T(y)} ${T(z)} ${pick([2, 3])} ${side}`);
};
// creature spawner spot (Underwater Horrors). The mod's runner rolls the
// serpent / kraken chance at build time. Grounded with a support block.
const SPAWN = (x, y, z) => {
  S(x, y - 1, z, 'game:cobblestone-granite');
  L(`spawner ${T(x)} ${T(y)} ${T(z)}`);
};
// ingot pile: mostly silver / copper / molybdochalkos, an occasional very large
// gold hoard, and some small steel piles. Grounded with a support block.
const INGOTS = (x, y, z) => {
  const r = rnd();
  let metal, count;
  if (r < 0.09) { metal = 'gold'; count = ri(48, 64); }          // rare, very large
  else if (r < 0.24) { metal = 'steel'; count = ri(3, 10); }     // uncommon, small
  else { metal = pick(['silver', 'copper', 'molybdochalkos']); count = ri(12, 40); }
  S(x, y - 1, z, 'game:cobblestone-granite');
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
  light: 'game:creativelight-43',    // neon green
  lightAlt: 'game:creativelight-49', // varied hue
};

// scatter n debris blocks over a floor rectangle at height y
function scatterDebris(x1, z1, x2, z2, y, n, blocks) {
  blocks = blocks || P.debris;
  for (let i = 0; i < n; i++) S(ri(x1, x2), y, ri(z1, z2), pick(blocks));
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
  rewards(x1 + 1, z1 + 1, x2 - 1, z2 - 1, 0, 5, 4);
  // cracked vessels
  S(3, 0, -3, pick(P.vessel)); S(-2, 0, 3, pick(P.vessel)); S(2, 0, 4, pick(P.vessel));
  // two creature spawner spots (runner rolls the serpent / kraken chance)
  SPAWN(2, 0, 3); SPAWN(-3, 0, -2);
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
  for (let i = 0; i < 9; i++) {
    const a = rnd() * Math.PI * 2, rr = ri(4, R - 1);
    CH(round(Math.cos(a) * rr), fy + 1, round(Math.sin(a) * rr), 0, pick(SIDES));
  }
  for (let i = 0; i < 4; i++) {
    const a = rnd() * Math.PI * 2, rr = ri(4, R - 1);
    INGOTS(round(Math.cos(a) * rr), fy + 1, round(Math.sin(a) * rr));
  }
  // debris and cracked vessels scattered inside the ring
  for (let i = 0; i < 30; i++) { const a = rnd() * Math.PI * 2, rr = ri(1, R - 1); S(round(Math.cos(a) * rr), fy + 1, round(Math.sin(a) * rr), pick(P.debris)); }
  for (let i = 0; i < 4; i++) { const a = rnd() * Math.PI * 2, rr = ri(2, R - 2); S(round(Math.cos(a) * rr), fy + 1, round(Math.sin(a) * rr), pick(P.vessel)); }
  // two creature spawner spots on the platform
  SPAWN(3, 0, 3); SPAWN(-4, 0, 2);
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

  // collapsed chests resting on the sea floor inside the wreck (grounded, not
  // floating up in the tilted hull)
  const cw = Math.max(2, W - 2);
  for (let i = 0; i < chests; i++) {
    const zc = ri(-half + 4, half - 4);
    CH(ri(-cw, cw), 0, zc, 0, pick(SIDES));
  }
  // ingot cargo hoards spilled across the sea floor inside the wreck
  const ni = Math.max(2, round(chests * 0.8));
  for (let i = 0; i < ni; i++) INGOTS(ri(-cw, cw), 0, ri(-half + 4, half - 4));

  // creature spawner spot(s) on the sea floor inside the wreck; the huge wreck
  // gets two, spread fore and aft
  const ns = spawners || 1;
  for (let i = 0; i < ns; i++) {
    const zc = ns > 1 ? round(-half * 0.4 + i * (half * 0.8)) : ri(-half + 6, half - 6);
    SPAWN(ri(-2, 2), 0, zc);
  }

  // debris trailing out of the wreck on the sea floor
  for (let i = 0; i < Math.floor(length * 1.0); i++) S(ri(-W - 5, W + 5), 0, ri(-half - 4, half + 4), pick(P.debris));
  for (let i = 0; i < Math.max(2, Math.floor(chests / 3)); i++) S(ri(-3, 3), 0, ri(-half, half), pick(P.vessel));

  write(name);
}

// ═══════════════════════════════════════════════════════════════════════
//  5. city  — 40x40 crumbling flooded ruins
// ═══════════════════════════════════════════════════════════════════════
function city() {
  rnd = mulberry32(55);
  begin('Sunken ruined city, ~40x40. Stand at the CENTER, then /build city');
  const fy = -1, R = 20;

  // broken street floor across the whole footprint
  floorRuined(-R, -R, R, R, fy);

  // buildings on a jittered grid
  const step = 11;
  for (let gx = -R + 6; gx <= R - 6; gx += step) {
    for (let gz = -R + 6; gz <= R - 6; gz += step) {
      const cx = gx + ri(-2, 2), cz = gz + ri(-2, 2);
      const w = ri(3, 5), d = ri(3, 5);
      const tower = chance(0.35);
      const h = tower ? ri(14, 26) : ri(5, 9);
      ruinedBuilding(cx, cz, w, d, h, fy, { chests: ri(1, 3), ingots: ri(0, 2), holes: 1.0 });
      // rubble ring around each building
      scatterDebris(cx - w - 2, cz - d - 2, cx + w + 2, cz + d + 2, fy + 1, ri(4, 9), P.debris);
    }
  }

  // extra debris, loose chests and ingot hoards scattered in the streets
  for (let i = 0; i < 90; i++) S(ri(-R, R), fy + 1, ri(-R, R), pick(P.debris));
  rewards(-R + 2, -R + 2, R - 2, R - 2, fy + 1, 12, 8);
  for (let i = 0; i < 8; i++) S(ri(-R + 2, R - 2), fy + 1, ri(-R + 2, R - 2), pick(P.vessel));
  // a few standing broken archways / walls between buildings
  for (let i = 0; i < 8; i++) {
    const x = ri(-R + 3, R - 3), z = ri(-R + 3, R - 3), len = ri(3, 7), vert = chance(0.5), hh = ri(3, 8), wb = pick(P.brick);
    for (let j = 0; j < len; j++) { const th = hh - ri(0, 3); for (let y = fy + 1; y <= fy + th; y++) if (chance(0.7)) S(vert ? x : x + j, y, vert ? z + j : z, wb); }
  }
  // two creature spawner spots in the streets
  SPAWN(2, 0, 2); SPAWN(-6, 0, -5);
  write('city');
}

// ── run all ──────────────────────────────────────────────────────────────
ruin();
portal();
ship({ name: 'shipwreck-huge', length: 110, tiltDeg: 26, chests: 22, dev: true, seed: 33, W: 11, H: 13, DEPTH: 6, spawners: 3 });
ship({ name: 'shipwreck-small', length: 34, tiltDeg: 24, chests: 5, dev: false, seed: 44, W: 6, H: 8, DEPTH: 4, spawners: 1 });
ship({ name: 'shipwreck-medium', length: 50, tiltDeg: 0, chests: 10, dev: false, seed: 66, W: 8, H: 10, DEPTH: 5, spawners: 2 });
city();
console.log('done');
