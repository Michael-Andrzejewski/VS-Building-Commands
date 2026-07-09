// Tiny static server for the build-script voxel viewer.
// Serves the repo root so the page can fetch /examples/<name>.txt.
//   node viewer/serve.js   ->   http://localhost:5182
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 5182;
const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.txt': 'text/plain',
  '.json': 'application/json', '.css': 'text/css',
};

http.createServer((req, res) => {
  // Capture endpoint: the page POSTs a PNG data URL, we save it so it can be
  // opened directly. Used to screenshot the WebGL canvas.
  if (req.method === 'POST' && req.url.startsWith('/capture')) {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const m = body.match(/^data:image\/png;base64,(.+)$/);
      if (!m) { res.writeHead(400); return res.end('bad'); }
      const name = (new URL(req.url, 'http://x').searchParams.get('name') || 'shot').replace(/[^a-z0-9_-]/gi, '');
      const dir = path.join(__dirname, 'shots');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, name + '.png'), Buffer.from(m[1], 'base64'));
      res.writeHead(200); res.end('ok');
    });
    return;
  }

  let url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/' || url === '') url = '/viewer/index.html';
  const fp = path.normalize(path.join(ROOT, url));
  if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found: ' + url); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(data);
  });
}).listen(PORT, () => console.log('build viewer on http://localhost:' + PORT));
