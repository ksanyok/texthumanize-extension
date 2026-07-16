/** Tiny static dev server for previewing popup/options as web pages. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(join(fileURLToPath(import.meta.url), '..', '..'));
const port = Number(process.env.PORT || 8642);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);

    // Dev-only endpoint: the icon generator page POSTs rendered PNGs here.
    if (req.method === 'POST' && path === '/save-icons') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const icons = JSON.parse(body);
      const { writeFile, mkdir } = await import('node:fs/promises');
      await mkdir(join(root, 'icons'), { recursive: true });
      const saved = [];
      for (const [size, dataUrl] of Object.entries(icons)) {
        const b64 = dataUrl.split(',')[1];
        const name = size === '440' ? 'store-icon440.png' : `icon${size}.png`;
        const dest = size === '440' ? join(root, 'store', name) : join(root, 'icons', name);
        await writeFile(dest, Buffer.from(b64, 'base64'));
        saved.push(name);
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ saved }));
      return;
    }

    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(root, path));
    if (!file.startsWith(root)) throw new Error('forbidden');
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`dev server on http://127.0.0.1:${port}/`);
});
