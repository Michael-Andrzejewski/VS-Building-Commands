// Slice a build script in half so the voxel viewer shows its section.
//
//   node tools/cut-build.mjs pond_aquarium z -36
//   node tools/cut-build.mjs idealhouse4 x 0 keep-low
//
// Writes examples/<name>-cut.txt, keeping the half at or above the cut by
// default, or the half at or below it with "keep-low". Fills are clipped
// rather than dropped, so the cut face is flat.

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [name, axis = 'z', atRaw = '0', mode = 'keep-high'] = process.argv.slice(2);
if (!name) {
  console.error('usage: node tools/cut-build.mjs <script> [x|y|z] [at] [keep-high|keep-low]');
  process.exit(1);
}
const at = parseInt(atRaw, 10);
const keepHigh = mode !== 'keep-low';
const IDX = { x: 0, y: 1, z: 2 }[axis];
if (IDX === undefined) { console.error(`axis must be x, y or z, not "${axis}"`); process.exit(1); }

const n = (t) => (t[0] === '~' ? (t.slice(1) === '' ? 0 : parseInt(t.slice(1), 10)) : parseInt(t, 10));
const T = (v) => '~' + (v === 0 ? '' : v);

const out = [`# ${name}-cut: ${name} with the ${keepHigh ? 'low' : 'high'} half removed at ${axis}=${at}, for looking at the section.`];
let kept = 0, dropped = 0, clipped = 0;
for (const raw of readFileSync(join(root, 'examples', name + '.txt'), 'utf8').split(/\r?\n/)) {
  const l = raw.trim();
  if (!l || l[0] === '#' || l.startsWith('facing')) continue;
  const p = l.split(/\s+/);

  if (p[0] === 'fill') {
    const a = n(p[1 + IDX]), b = n(p[4 + IDX]);
    const lo = Math.min(a, b), hi = Math.max(a, b);
    if (keepHigh ? hi < at : lo > at) { dropped++; continue; }
    const nlo = keepHigh ? Math.max(lo, at) : lo;
    const nhi = keepHigh ? hi : Math.min(hi, at);
    if (nlo !== lo || nhi !== hi) clipped++;
    const q = p.slice();
    q[1 + IDX] = T(nlo);
    q[4 + IDX] = T(nhi);
    out.push(q.join(' '));
    kept++;
  } else {
    const v = n(p[1 + IDX]);
    if (keepHigh ? v < at : v > at) { dropped++; continue; }
    out.push(l);
    kept++;
  }
}

writeFileSync(join(root, 'examples', name + '-cut.txt'), out.join('\n'));
console.log(`${name}-cut.txt: ${kept} lines kept (${clipped} clipped at the cut), ${dropped} dropped`);
