// Replay a build script and assert the things a render cannot show.
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const name = process.argv[2] || 'idealhouse3';
const map = new Map();
const n = (t) => (t[0] === '~' ? (t.slice(1) === '' ? 0 : parseInt(t.slice(1), 10)) : parseInt(t, 10));
for (const raw of readFileSync(join(root, 'examples', name + '.txt'), 'utf8').split(/\r?\n/)) {
  const l = raw.trim(); if (!l || l[0] === '#') continue;
  const p = l.split(/\s+/);
  const put = (x, y, z, c) => { if (c === 'air') map.delete(`${x},${y},${z}`); else map.set(`${x},${y},${z}`, c); };
  if (p[0] === 'fill') { const [a,b,c2,d,e,f] = [n(p[1]),n(p[2]),n(p[3]),n(p[4]),n(p[5]),n(p[6])];
    for (let x=Math.min(a,d);x<=Math.max(a,d);x++) for (let y=Math.min(b,e);y<=Math.max(b,e);y++) for (let z=Math.min(c2,f);z<=Math.max(c2,f);z++) put(x,y,z,p[7]); }
  else if (p[0] === 'setblock') put(n(p[1]),n(p[2]),n(p[3]),p[4]);
  else if (p[0] === 'translocator') put(n(p[1]),n(p[2]),n(p[3]),'statictranslocator-normal-north');
}
const at = (x,y,z) => map.get(`${x},${y},${z}`);
const solid = (x,y,z) => { const c = at(x,y,z); return !!c && !/^(woodenfence|chandelier|lantern|rug|glasspane|ladder|plankstairs)/.test(c); };
const walk = (x,y,z) => !solid(x,y,z) && !solid(x,y+1,z) && solid(x,y-1,z);
const isL = (x,y,z) => /^ladder/.test(at(x,y,z) || '');
const seen = new Set(['0,1,-1']); const q = [[0,1,-1]];
while (q.length) { const [x,y,z] = q.shift();
  const mv = [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[1,1,0],[-1,1,0],[0,1,1],[0,1,-1],[1,-1,0],[-1,-1,0],[0,-1,1],[0,-1,-1]];
  if (isL(x,y,z) || isL(x,y+1,z)) mv.push([0,1,0],[0,-1,0]);
  for (const [dx,dy,dz] of mv) { const p = [x+dx,y+dy,z+dz], k = p.join(',');
    if (seen.has(k) || Math.abs(p[0])>60 || p[1]<-12 || p[1]>45 || Math.abs(p[2])>30) continue;
    const ok = (dy!==0&&dx===0&&dz===0) ? (!solid(...p) && !solid(p[0],p[1]+1,p[2])) : walk(...p);
    if (ok) { seen.add(k); q.push(p); } } }
const near = (nm,x,y,z) => { let h=false; for(let a=-2;a<=2&&!h;a++) for(let b=-2;b<=2&&!h;b++) if(seen.has([x+a,y,z+b].join(','))) h=true;
  return (h?'  ok  ':'  FAIL')+' '+nm; };
console.log(`${name}: ${map.size} blocks, ${seen.size} walkable cells reachable from the front door`);
console.log([near('kitchen',17,1,-7),near('relic room',-18,1,-7),near('game room wing',-32,1,5),
 near('library wing',32,1,5),near('tower ground',40,1,13),near('bedroom',-6,8,-6),near('basement lab',0,-8,-7),
 near('front balcony',0,8,2),near('tower deck 16',40,17,13),near('astronomy deck',40,31,13),
 near('tower balcony ring',47,31,13)].join('\n'));
// ladder continuity
const lad = [...map.entries()].filter(([,c])=>/^ladder/.test(c)).map(([k])=>k.split(',').map(Number)).sort((a,b)=>a[1]-b[1]);
let gaps = 0;
for (let i=1;i<lad.length;i++) if (lad[i][1] !== lad[i-1][1]+1) gaps++;
let noBack = 0;
for (const [x,y,z] of lad) if (!solid(x,y,z-1)) noBack++;
console.log(`ladder: ${lad.length} rungs y${lad[0]?.[1]}..${lad[lad.length-1]?.[1]}, gaps ${gaps}, rungs with no wall behind ${noBack}`);
// roof cover
let holes = 0;
for (let x=-24;x<=24;x++) for (let z=-15;z<=0;z++) { let ok=false; for(let y=15;y<=45;y++) if(solid(x,y,z)){ok=true;break;} if(!ok) holes++; }
let wingHoles = 0;
for (const w of [{cx:-32,cz:5,dx:-Math.SQRT1_2,dz:Math.SQRT1_2},{cx:32,cz:5,dx:Math.SQRT1_2,dz:Math.SQRT1_2}])
  for (let x=-50;x<=52;x++) for (let z=-20;z<=24;z++) {
    const px=x+0.5-w.cx, pz=z+0.5-w.cz, u=px*w.dx+pz*w.dz, v=-px*w.dz+pz*w.dx;
    if (Math.abs(u)<=12 && Math.abs(v)<=6) { let ok=false; for(let y=14;y<=45;y++) if(solid(x,y,z)){ok=true;break;} if(!ok) wingHoles++; } }
let unsup = 0;
for (const [k,c] of map) if (/^(chandelier|lantern)/.test(c)) { const [x,y,z]=k.split(',').map(Number); if(!solid(x,y+1,z)) unsup++; }
const ridges = [...map.values()].filter(c=>/ridge/.test(c)).length;
const books = [...map.values()].filter(c=>/bookshelf/.test(c)).length;
console.log(`roof holes: main ${holes}, wings ${wingHoles} | unsupported lights: ${unsup} | ridge blocks: ${ridges} | bookshelves: ${books}`);
