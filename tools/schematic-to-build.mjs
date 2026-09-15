// Turn a Vintage Story WorldEdit export back into a /build script.
//
// Round trip: Claude writes a /build script -> Michael builds and edits it in
// game -> `/we export <name>` writes
// %APPDATA%\VintagestoryData\WorldEdit\<name>.json -> this converts that back
// into examples/<name>.txt, which the voxel viewer renders and /build replaces.
//
//   node tools/schematic-to-build.mjs idealhouse-v2
//   node tools/schematic-to-build.mjs C:\path\to\some.json myname
//
// Schematic format (verified against the game's own worldgen schematics):
//   SizeX/SizeY/SizeZ, BlockCodes {id: "game:code"}, Indices [packed],
//   BlockIds [parallel], DecorIndices/DecorIds, BlockEntities, Entities.
//   packed index = x + z*1024 + y*1048576, origin at the selection's min corner.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const WE_DIR = join(process.env.APPDATA || '', 'VintagestoryData', 'WorldEdit');

const arg = process.argv[2];
if (!arg) {
  console.error('usage: node tools/schematic-to-build.mjs <name|path-to-json> [outname]');
  process.exit(1);
}
const src = arg.endsWith('.json') ? arg : join(WE_DIR, arg + '.json');
if (!existsSync(src)) {
  console.error(`no schematic at ${src}`);
  console.error(`(in game: /we start, /we end, then /we export ${basename(arg)})`);
  process.exit(1);
}
const outName = process.argv[3] || basename(src).replace(/\.json$/, '');

const s = JSON.parse(readFileSync(src, 'utf8'));
const SX = s.SizeX, SY = s.SizeY, SZ = s.SizeZ;
const codes = {};
for (const [id, code] of Object.entries(s.BlockCodes || {})) codes[+id] = String(code).replace(/^game:/, '');

// decode cells
const cells = new Map();                       // "x,y,z" -> code
const idx = s.Indices || [], ids = s.BlockIds || [];
for (let i = 0; i < idx.length; i++) {
  const p = idx[i];
  const x = p & 1023, z = (p >> 10) & 1023, y = (p >> 20) & 1023;
  const c = codes[ids[i]];
  if (!c || c === 'air' || c.startsWith('meta-')) continue;   // meta-filler etc are worldgen markers
  cells.set(`${x},${y},${z}`, c);
}

// greedy mesh into fills, same shape as the generator's emitter
const key = (x, y, z) => `${x},${y},${z}`;
const done = new Set();
const lines = [];
const sorted = [...cells.entries()].map(([k, c]) => {
  const [x, y, z] = k.split(',').map(Number); return { x, y, z, c, k };
}).sort((a, b) => a.y - b.y || a.z - b.z || a.x - b.x);

const t = (n) => '~' + (n === 0 ? '' : n);
for (const cell of sorted) {
  if (done.has(cell.k)) continue;
  const { x, y, z, c } = cell;
  let x2 = x; while (cells.get(key(x2 + 1, y, z)) === c && !done.has(key(x2 + 1, y, z))) x2++;
  let z2 = z;
  outerZ: while (true) {
    for (let xi = x; xi <= x2; xi++) { const kk = key(xi, y, z2 + 1); if (cells.get(kk) !== c || done.has(kk)) break outerZ; }
    z2++;
  }
  let y2 = y;
  outerY: while (true) {
    for (let xi = x; xi <= x2; xi++) for (let zi = z; zi <= z2; zi++) { const kk = key(xi, y2 + 1, zi); if (cells.get(kk) !== c || done.has(kk)) break outerY; }
    y2++;
  }
  for (let xi = x; xi <= x2; xi++) for (let yi = y; yi <= y2; yi++) for (let zi = z; zi <= z2; zi++) done.add(key(xi, yi, zi));
  lines.push(x === x2 && y === y2 && z === z2
    ? `setblock ${t(x)} ${t(y)} ${t(z)} ${c}`
    : `fill ${t(x)} ${t(y)} ${t(z)} ${t(x2)} ${t(y2)} ${t(z2)} ${c}`);
}

const header = [
  `# ${outName}: converted from the WorldEdit export ${basename(src)}`,
  `# ${SX} x ${SY} x ${SZ}, ${cells.size} blocks, ${Object.keys(codes).length} distinct block types`,
  '# Coordinates are relative to the selection\'s minimum corner.',
  s.BlockEntities ? `# ${Object.keys(s.BlockEntities).length} block entities (chest contents etc) are in the schematic but NOT in this script` : '',
  '',
].filter(Boolean);

writeFileSync(join(root, 'examples', outName + '.txt'), header.concat(lines).join('\n'));

// a quick tally so the diff against the generated house is readable
const tally = {};
for (const c of cells.values()) tally[c] = (tally[c] || 0) + 1;
const top = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 15);
console.log(`${outName}.txt: ${lines.length} lines, ${cells.size} blocks, ${SX}x${SY}x${SZ}`);
console.log('most common blocks:');
for (const [c, n] of top) console.log(`   ${String(n).padStart(6)}  ${c}`);
