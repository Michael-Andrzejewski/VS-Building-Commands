// Check the rotation the mod applies to a build script.
//
//   node tools/verify-rotation.mjs idealhouse4
//
// The mod turns a `fill` by turning its two CORNERS and then filling the
// axis-aligned box between them. That only gives the right answer if turning
// the box is the same as turning every cell in it, so that is the property
// this asserts, for every fill line at every angle. It also checks the facing
// table and the compass-word rewrite the mod falls back on for blocks that do
// not implement rotation themselves.

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const name = process.argv[2] || 'idealhouse4';

// the mod's RotXZ, about an origin of (0,0)
const rot = (x, z, a) =>
  a === 90 ? [-z, x] : a === 180 ? [-x, -z] : a === 270 ? [z, -x] : [x, z];

const n = (t) => (t[0] === '~' ? (t.slice(1) === '' ? 0 : parseInt(t.slice(1), 10)) : parseInt(t, 10));
const lines = readFileSync(join(root, 'examples', name + '.txt'), 'utf8').split(/\r?\n/);

let fills = 0, cells = 0, bad = 0;
for (const a of [90, 180, 270]) {
  for (const raw of lines) {
    const l = raw.trim();
    if (!l || l[0] === '#') continue;
    const p = l.split(/\s+/);
    if (p[0] !== 'fill') continue;
    const [x1, y1, z1, x2, y2, z2] = [n(p[1]), n(p[2]), n(p[3]), n(p[4]), n(p[5]), n(p[6])];

    // what the mod does: turn the corners, then fill between them
    const [rx1, rz1] = rot(x1, z1, a), [rx2, rz2] = rot(x2, z2, a);
    const box = new Set();
    for (let x = Math.min(rx1, rx2); x <= Math.max(rx1, rx2); x++)
      for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++)
        for (let z = Math.min(rz1, rz2); z <= Math.max(rz1, rz2); z++) box.add(`${x},${y},${z}`);

    // what it must equal: turn every cell of the original box
    const want = new Set();
    for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++)
      for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++)
        for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++) {
          const [rx, rz] = rot(x, z, a);
          want.add(`${rx},${y},${rz}`);
        }

    fills++; cells += want.size;
    if (box.size !== want.size || [...want].some((k) => !box.has(k))) {
      if (bad === 0) console.log(`  FAIL at ${a} degrees: ${l}`);
      bad++;
    }
  }
}
console.log(`  ${bad === 0 ? 'ok  ' : 'FAIL'} turning a fill's corners covers the same cells as turning every cell` +
  `   (${fills} fills, ${cells} cells, ${bad} mismatched)`);

// ── the facing table ────────────────────────────────────────────────────────
const IDX = { east: 0, north: 1, west: 2, south: 3 };
const ORDER = ['east', 'north', 'west', 'south'];
const mod4 = (v) => ((v % 4) + 4) % 4;
const angleFor = (declared, want) => mod4(IDX[declared] - IDX[want]) * 90;

let tbad = 0;
const t = (declared, want, expect) => {
  const got = angleFor(declared, want);
  const ok = got === expect;
  if (!ok) tbad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} a build facing ${declared} asked to face ${want.padEnd(5)} turns ${String(got).padStart(3)} degrees (want ${expect})`);
};
t('south', 'south', 0);
t('south', 'west', 90);
t('south', 'north', 180);
t('south', 'east', 270);
t('north', 'north', 0);
t('north', 'east', 90);

// ── the compass-word rewrite, which is what turns a chest ───────────────────
const spin = (code, a) => code.split('-')
  .map((w) => (w.length >= 4 && w in IDX ? ORDER[mod4(IDX[w] - a / 90)] : w)).join('-');
let sbad = 0;
const sp = (code, a, expect) => {
  const got = spin(code, a);
  const ok = got === expect;
  if (!ok) sbad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${code.padEnd(30)} turned ${String(a).padStart(3)} -> ${got.padEnd(30)} (want ${expect})`);
};
sp('chest-north', 90, 'chest-east');
sp('chest-north', 180, 'chest-south');
sp('chest-north', 270, 'chest-west');
sp('chest-east', 90, 'chest-south');
// a build facing south turned to face north is 180, so its north chests face south
sp('chest-north', angleFor('south', 'north'), 'chest-south');
// codes with no compass word must come back untouched
sp('planks-oak-we', 90, 'planks-oak-we');       // handled by the game, never reaches this
sp('stonebricks-granite', 90, 'stonebricks-granite');
sp('lantern-small-down', 90, 'lantern-small-down');

const fails = bad + tbad + sbad;
console.log(fails ? `\n${fails} FAILED` : '\nrotation checks pass');
process.exit(fails ? 1 : 0);
