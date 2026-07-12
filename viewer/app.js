/* Voxel preview of the Building Commands /build scripts.
   Parses the same fill/setblock/lootchest lines the mod runs (tilde origin
   at 0,0,0) and renders them as colored cubes so we can critique designs
   without launching Vintage Story. */

const STRUCTURES = ['ruin', 'portal', 'shipwreck-huge', 'shipwreck-small', 'shipwreck-medium', 'city', 'dungeon', 'beacondungeon', 'beacondungeon-cut'];

// ── coordinate + color helpers ───────────────────────────────────────────
function tint(tok) { // '~' -> 0, '~5' -> 5, '~-3' -> -3, '10' -> 10
  if (tok[0] === '~') { const r = tok.slice(1); return r === '' ? 0 : parseInt(r, 10) || 0; }
  return parseInt(tok, 10) || 0;
}

function colorFor(code) {
  if (code === '__chest__') return 0x8a5a26;      // collapsed loot chest (bright so it stands out)
  if (code === '__spawner__') return 0x00e5ff;    // creature spawner (cyan)
  if (code === '__ingots__') return 0xf2d24b;     // ingot pile (gold-ish)
  const c = code.replace(/^game:/, '');
  if (c.startsWith('stonebricks')) return 0x8f8f8f;
  if (c.startsWith('cobblestone')) return 0x707070;
  if (c.startsWith('brickruin')) {
    if (c.includes('red')) return 0x9c4a3a;
    if (c.includes('brown')) return 0x7a5540;
    if (c.includes('tan')) return 0xa08a5a;
    if (c.includes('orange')) return 0xa86a3a;
    return 0x8a7a6a;
  }
  if (c.startsWith('planks') || c.startsWith('log')) return c.includes('veryaged') || c.includes('rotten') ? 0x5f4a2a : 0x86663a;
  if (c.startsWith('creativelight')) return 0x55ff77;
  if (c.startsWith('lootvessel')) return 0xc39868;
  if (code === 'spreadingdevastation:machinecore') return 0xff7a22; // glowing machine heart
  if (c.startsWith('devgrowth')) return 0xcf3a48;
  if (c === 'drock') return 0x4a3038;
  if (c.startsWith('devplate')) return 0x6b4038;
  if (c.startsWith('devastatedsoil')) return 0x5c3430;
  if (c.startsWith('metalblock')) return c.includes('riveted') ? 0x77503c : 0x8a614a;
  if (c.startsWith('agedstonebricks')) return 0x9a9078;
  if (c.startsWith('crackedstonebricks')) return 0x847a66;
  if (c.startsWith('cobbleskull')) return 0xd8d0c0;
  if (c.startsWith('metal-') || c.startsWith('loosegears')) return 0x59596a;
  if (c === 'looseflints') return 0x5a6a55;
  if (c === 'loosestick') return 0x7a6644;
  if (c.startsWith('gravel')) return 0x8a8478;
  return 0xcc33cc; // unknown block -> magenta so it is obvious
}

// ── parse a script into a Map "x,y,z" -> block code (air removes) ─────────
function parseScript(text) {
  const map = new Map();
  const set = (x, y, z, code) => {
    const k = x + ',' + y + ',' + z;
    if (code === 'air' || code === 'game:air') map.delete(k); else map.set(k, code);
  };
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line[0] === '#' || line.startsWith('//')) continue;
    if (line[0] === '/') line = line.slice(1);
    const t = line.split(/\s+/);
    const cmd = t[0].toLowerCase();
    if (cmd === 'fill') {
      const x1 = tint(t[1]), y1 = tint(t[2]), z1 = tint(t[3]);
      const x2 = tint(t[4]), y2 = tint(t[5]), z2 = tint(t[6]);
      const block = t[7], mode = (t[8] || 'replace').toLowerCase(), filter = t[9];
      const [aX, bX] = [Math.min(x1, x2), Math.max(x1, x2)];
      const [aY, bY] = [Math.min(y1, y2), Math.max(y1, y2)];
      const [aZ, bZ] = [Math.min(z1, z2), Math.max(z1, z2)];
      for (let x = aX; x <= bX; x++) for (let y = aY; y <= bY; y++) for (let z = aZ; z <= bZ; z++) {
        const shell = x === aX || x === bX || y === aY || y === bY || z === aZ || z === bZ;
        if (mode === 'hollow') set(x, y, z, shell ? block : 'air');
        else if (mode === 'outline') { if (shell) set(x, y, z, block); }
        else if (mode === 'keep') { if (!map.has(x + ',' + y + ',' + z)) set(x, y, z, block); }
        else if (mode === 'replace' && filter) { if (map.get(x + ',' + y + ',' + z) === filter) set(x, y, z, block); }
        else set(x, y, z, block);
      }
    } else if (cmd === 'setblock' || cmd === 'cbsetblock') {
      set(tint(t[1]), tint(t[2]), tint(t[3]), t[4]);
    } else if (cmd === 'lootchest') {
      set(tint(t[1]), tint(t[2]), tint(t[3]), '__chest__');
    } else if (cmd === 'spawner') {
      set(tint(t[1]), tint(t[2]), tint(t[3]), '__spawner__');
    } else if (cmd === 'ingots') {
      set(tint(t[1]), tint(t[2]), tint(t[3]), '__ingots__');
    } else if (cmd === 'scatter') {
      // in-game this settles onto the surface below; the viewer has no
      // terrain, so render the column at the scripted spot
      const x = tint(t[1]), y = tint(t[2]), z = tint(t[3]);
      const n = t[5] ? Math.max(1, parseInt(t[5], 10) || 1) : 1;
      for (let i = 0; i < n; i++) set(x, y + i, z, t[4]);
    }
  }
  return map;
}

// ── three.js scene ───────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a1a26);
scene.fog = new THREE.FogExp2(0x0a1a26, 0.0012);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 4000);

scene.add(new THREE.HemisphereLight(0xdff0ff, 0x35485a, 0.75));
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const d1 = new THREE.DirectionalLight(0xffffff, 0.85); d1.position.set(0.5, 1, 0.35); scene.add(d1);
const d2 = new THREE.DirectionalLight(0xbcd6ee, 0.6); d2.position.set(-0.5, 0.4, -0.6); scene.add(d2);
const d3 = new THREE.DirectionalLight(0x9fb8d0, 0.45); d3.position.set(0.2, -0.6, 0.5); scene.add(d3);

let mesh = null;
const dummy = new THREE.Object3D();
const boxGeo = new THREE.BoxGeometry(1, 1, 1);

function buildMesh(map) {
  if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); mesh = null; }
  const cells = [];
  let minX = 1e9, minY = 1e9, minZ = 1e9, maxX = -1e9, maxY = -1e9, maxZ = -1e9;
  for (const [k, code] of map) {
    const [x, y, z] = k.split(',').map(Number);
    cells.push([x, y, z, code]);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  const n = cells.length;
  if (n === 0) return { n: 0, size: 10 };
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;

  const mat = new THREE.MeshLambertMaterial();
  mesh = new THREE.InstancedMesh(boxGeo, mat, n);
  const col = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const [x, y, z, code] = cells[i];
    dummy.position.set(x - cx, y - cy, z - cz);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    mesh.setColorAt(i, col.setHex(colorFor(code)));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  scene.add(mesh);
  const size = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 6);
  return { n, size };
}

// ── simple orbit controls ────────────────────────────────────────────────
let az = 0.9, pol = 1.05, rad = 60;
function render() { renderer.render(scene, camera); }
function updateCam() {
  const sp = Math.sin(pol);
  camera.position.set(rad * sp * Math.cos(az), rad * Math.cos(pol), rad * sp * Math.sin(az));
  camera.lookAt(0, 0, 0);
  render();
}
let drag = false, px = 0, py = 0;
renderer.domElement.addEventListener('pointerdown', (e) => { drag = true; px = e.clientX; py = e.clientY; });
addEventListener('pointerup', () => { drag = false; });
addEventListener('pointermove', (e) => {
  if (!drag) return;
  az += (e.clientX - px) * 0.006;
  pol = Math.max(0.08, Math.min(3.06, pol - (e.clientY - py) * 0.006));
  px = e.clientX; py = e.clientY; updateCam();
});
renderer.domElement.addEventListener('wheel', (e) => {
  e.preventDefault();
  rad = Math.max(6, Math.min(1200, rad * (1 + Math.sign(e.deltaY) * 0.08)));
  updateCam();
}, { passive: false });

addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  render();
});

// ── load + wire UI ───────────────────────────────────────────────────────
const sel = document.getElementById('sel');
const info = document.getElementById('info');
for (const s of STRUCTURES) { const o = document.createElement('option'); o.value = s; o.textContent = s; sel.appendChild(o); }

async function load(name) {
  info.textContent = 'loading ' + name + '...';
  try {
    const res = await fetch('/examples/' + name + '.txt');
    if (!res.ok) throw new Error(res.status);
    const map = parseScript(await res.text());
    const { n, size } = buildMesh(map);
    rad = size * 1.9;
    updateCam();
    info.innerHTML = name + '<br>' + n.toLocaleString() + ' blocks &middot; ' + size + ' wide';
  } catch (e) {
    info.textContent = 'failed to load ' + name + ': ' + e.message;
  }
}
sel.addEventListener('change', () => load(sel.value));

updateCam();
load(STRUCTURES[0]);
