// 로컬 미리보기용 정적 파일 서버 (배포는 GitHub Pages)
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const PORT = Number(process.env.PORT) || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);
  const target = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(pathname === '/' ? '/index.html' : pathname)));
  if (!target.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const data = await fs.readFile(target);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(target)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404).end('not found');
  }
});

server.listen(PORT, () => console.log(`http://localhost:${PORT}`));
