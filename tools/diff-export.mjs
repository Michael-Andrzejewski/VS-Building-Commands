// Diff a WorldEdit export against the build script it came from.
//
//   node tools/diff-export.mjs idealhousev3 idealhouse2
//
// Finds the alignment offset automatically (the export's origin is the
// selection's min corner, the script's is the player), then reports what
// Michael added, removed and replaced, grouped so the changes are readable.

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const WE_DIR = join(process.env.APPDATA || '', 'VintagestoryData', 'WorldEdit');
const exportName = process.argv[2] || 'idealhousev3';
const scriptName = process.argv[3] || 'idealhouse2';

const SKIP = /^(leaves|leavesbranchy|log-grown|tallgrass|sapling|flower|mushroom|fern|bigberrybush|smallberrybush|seaweed|crop-|grass|soil|farmland|looseflints|loosestones|looseboulders|loosestick|snowlayer|water-|lake-|meta-)/;

// ── his world ──
const s = JSON.parse(readFileSync(join(WE_DIR, exportName + '.json'), 'utf8'));
const codes = {};
for (const [id, c] of Object.entries(s.BlockCodes || {})) codes[+id] = String(c).replace(/^game:/, '');
const his = new Map();
for (let i = 0; i < s.Indices.length; i++) {
  const p = s.Indices[i];
  const c = codes[s.BlockIds[i]];
  if (!c || c === 'air' || SKIP.test(c)) continue;
  his.set(`${p & 1023},${(p >> 20) & 1023},${(p >> 10) & 1023}`, c);   // x,y,z
}

// ── my script ──
const mine = new Map();
const n = (t) => (t[0] === '~' ? (t.slice(1) === '' ? 0 : parseInt(t.slice(1), 10)) : parseInt(t, 10));
for (const raw of readFileSync(join(root, 'examples', scriptName + '.txt'), 'utf8').split(/\r?\n/)) {
  const l = raw.trim();
  if (!l || l[0] === '#') continue;
  const p = l.split(/\s+/);
  const put = (x, y, z, c) => { if (c === 'air') mine.delete(`${x},${y},${z}`); else mine.set(`${x},${y},${z}`, c); };
  if (p[0] === 'fill') {
    const [x1, y1, z1, x2, y2, z2] = [n(p[1]), n(p[2]), n(p[3]), n(p[4]), n(p[5]), n(p[6])];
    for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++)
      for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++)
        for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++) put(x, y, z, p[7]);
  } else if (p[0] === 'setblock') put(n(p[1]), n(p[2]), n(p[3]), p[4]);
  else if (p[0] === 'translocator') put(n(p[1]), n(p[2]), n(p[3]), 'statictranslocator-normal-' + (p[4] || 'north'));
}

// ── find the offset that lines the two up ──
const hisArr = [...his.entries()].map(([k, c]) => { const [x, y, z] = k.split(',').map(Number); return { x, y, z, c }; });
const mineKeys = mine;
let best = null;
const sample = hisArr.filter((_, i) => i % 7 === 0);
// seed the search from the most distinctive block type both share
const rare = (m) => {
  const t = {}; for (const c of m.values()) t[c] = (t[c] || 0) + 1;
  return Object.entries(t).filter(([, v]) => v > 3 && v < 60).sort((a, b) => a[1] - b[1]).map(([k]) => k);
};
const cand = rare(his).find((c) => [...mine.values()].includes(c));
const hisAnchors = hisArr.filter((e) => e.c === cand).slice(0, 12);
const myAnchors = [...mine.entries()].filter(([, c]) => c === cand)
  .map(([k]) => { const [x, y, z] = k.split(',').map(Number); return { x, y, z }; }).slice(0, 12);
const tried = new Set();
for (const h of hisAnchors) for (const m of myAnchors) {
  const off = [m.x - h.x, m.y - h.y, m.z - h.z];
  const ok = off.join(',');
  if (tried.has(ok)) continue;
  tried.add(ok);
  let hit = 0;
  for (const e of sample) if (mineKeys.get(`${e.x + off[0]},${e.y + off[1]},${e.z + off[2]}`) === e.c) hit++;
  if (!best || hit > best.hit) best = { off, hit };
}
if (!best) { console.error('could not align'); process.exit(1); }
const [ox, oy, oz] = best.off;
console.log(`aligned on "${cand}": export + (${ox}, ${oy}, ${oz}) = script coords  [${best.hit}/${sample.length} of a sample matched]`);

// ── diff ──
const added = [], removed = [], changed = [];
for (const e of hisArr) {
  const k = `${e.x + ox},${e.y + oy},${e.z + oz}`;
  const m = mine.get(k);
  if (!m) added.push({ ...e, k, to: e.c });
  else if (m !== e.c) changed.push({ ...e, k, from: m, to: e.c });
}
for (const [k, c] of mine) {
  const [x, y, z] = k.split(',').map(Number);
  if (!his.has(`${x - ox},${y - oy},${z - oz}`)) removed.push({ k, c, x, y, z });
}

const group = (list, pick) => {
  const t = {};
  for (const e of list) { const g = pick(e); (t[g] = t[g] || []).push(e); }
  return Object.entries(t).sort((a, b) => b[1].length - a[1].length);
};
const span = (list) => {
  const xs = list.map((e) => e.x + (e.k ? 0 : 0)), ys = list.map((e) => e.y), zs = list.map((e) => e.z);
  return `x ${Math.min(...xs)}..${Math.max(...xs)} y ${Math.min(...ys)}..${Math.max(...ys)} z ${Math.min(...zs)}..${Math.max(...zs)}`;
};

console.log(`\n=== ADDED by him (${added.length} blocks) ===`);
for (const [c, list] of group(added, (e) => e.to).slice(0, 18))
  console.log(`  ${String(list.length).padStart(5)}  ${c.padEnd(34)} ${span(list.map((e) => ({ x: e.x + ox, y: e.y + oy, z: e.z + oz })))}`);

console.log(`\n=== REPLACED (${changed.length} blocks): what he put where ===`);
for (const [pair, list] of group(changed, (e) => `${e.from}  ->  ${e.to}`).slice(0, 18))
  console.log(`  ${String(list.length).padStart(5)}  ${pair.padEnd(58)} ${span(list.map((e) => ({ x: e.x + ox, y: e.y + oy, z: e.z + oz })))}`);

console.log(`\n=== REMOVED by him (${removed.length} blocks) ===`);
for (const [c, list] of group(removed, (e) => e.c).slice(0, 18))
  console.log(`  ${String(list.length).padStart(5)}  ${c.padEnd(34)} ${span(list)}`);
