import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const CACHE_DIR = path.join(ROOT, '.cache');
const PORT = Number(process.env.PORT) || 3000;
const API_KEY = process.env.GG_API_KEY || '';
const API_URL = 'https://openapi.gg.go.kr/RegionMnyFacltStus';
const PAGE_SIZE = 1000;
const CONCURRENCY = 6;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// 기본 UA로 요청하면 경기데이터드림 보안정책에 차단됨
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

const SIGUNS = [
  '가평군', '고양시', '과천시', '광명시', '광주시', '구리시', '군포시', '김포시',
  '남양주시', '동두천시', '부천시', '성남시', '수원시', '시흥시', '안산시', '안성시',
  '안양시', '양주시', '양평군', '여주시', '연천군', '오산시', '용인시', '의왕시',
  '의정부시', '이천시', '파주시', '평택시', '포천시', '하남시', '화성시',
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const memoryCache = new Map();
const pending = new Map();

async function fetchPage(sigun, pIndex) {
  const params = new URLSearchParams({ Type: 'json', pIndex, pSize: PAGE_SIZE, SIGUN_NM: sigun });
  if (API_KEY) params.set('KEY', API_KEY);
  const res = await fetch(`${API_URL}?${params}`, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`API HTTP ${res.status}`);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error('API 응답이 JSON이 아닙니다 (요청 차단 가능성)');
  }
  if (body.RESULT) {
    if (body.RESULT.CODE === 'INFO-200') return { total: 0, rows: [] };
    throw new Error(`${body.RESULT.CODE} ${body.RESULT.MESSAGE}`);
  }
  const [{ head }, { row }] = body.RegionMnyFacltStus;
  return { total: head[0].list_total_count, rows: row };
}

// "5202(편의점/편의점)" → "편의점", "(일반음식점일반음식점)" → "일반음식점"
function normalizeType(name) {
  if (!name) return '기타';
  let s = name.trim();
  const m = s.match(/^\d*\((.+)\)$/);
  if (m) s = m[1];
  if (s.includes('/')) return s.split('/').pop().trim() || '기타';
  const half = s.length / 2;
  if (Number.isInteger(half) && s.slice(0, half) === s.slice(half)) return s.slice(0, half);
  return s || '기타';
}

function toStore(r) {
  const lat = Number(r.REFINE_WGS84_LAT);
  const lng = Number(r.REFINE_WGS84_LOGT);
  return {
    id: r.FRCS_NO,
    name: (r.CMPNM_NM || '').trim(),
    type: normalizeType(r.INDUTYPE_NM),
    addr: r.REFINE_ROADNM_ADDR || r.REFINE_LOTNO_ADDR || '',
    sigun: r.SIGUN_NM,
    lat,
    lng,
  };
}

async function loadSigun(sigun) {
  const first = await fetchPage(sigun, 1);
  let rows = first.rows;
  // 인증키가 없으면 샘플(5건)만 제공되므로 추가 페이지 요청 생략
  if (API_KEY) {
    const pages = Math.ceil(first.total / PAGE_SIZE);
    const queue = Array.from({ length: Math.max(pages - 1, 0) }, (_, i) => i + 2);
    const results = [];
    await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length) {
        const p = queue.shift();
        results.push((await fetchPage(sigun, p)).rows);
      }
    }));
    rows = rows.concat(...results);
  }
  const active = rows.filter((r) => r.LEAD_TAX_MAN_STATE_CD !== '02' && r.LEAD_TAX_MAN_STATE_CD !== '03');
  const stores = active.map(toStore).filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng) && s.lat > 0 && s.lng > 0);
  return {
    sigun,
    sample: !API_KEY,
    total: first.total,
    activeCount: active.length,
    noCoordCount: active.length - stores.length,
    stores,
  };
}

async function getSigun(sigun) {
  const cached = memoryCache.get(sigun);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;

  const file = path.join(CACHE_DIR, `${sigun}.json`);
  if (API_KEY) {
    try {
      const stat = await fs.stat(file);
      if (Date.now() - stat.mtimeMs < CACHE_TTL_MS) {
        const data = JSON.parse(await fs.readFile(file, 'utf8'));
        memoryCache.set(sigun, { at: stat.mtimeMs, data });
        return data;
      }
    } catch { /* 캐시 없음 */ }
  }

  if (!pending.has(sigun)) {
    pending.set(sigun, loadSigun(sigun).then(async (data) => {
      memoryCache.set(sigun, { at: Date.now(), data });
      if (API_KEY) {
        await fs.mkdir(CACHE_DIR, { recursive: true });
        await fs.writeFile(file, JSON.stringify(data));
      }
      return data;
    }).finally(() => pending.delete(sigun)));
  }
  return pending.get(sigun);
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function serveStatic(res, pathname) {
  const target = path.normalize(path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname));
  if (!target.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: 'forbidden' });
  try {
    const data = await fs.readFile(target);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(target)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: 'not found' });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/api/siguns') {
      return sendJson(res, 200, { siguns: SIGUNS, hasKey: Boolean(API_KEY) });
    }
    if (url.pathname === '/api/stores') {
      const sigun = url.searchParams.get('sigun');
      if (!SIGUNS.includes(sigun)) return sendJson(res, 400, { error: '알 수 없는 시군입니다.' });
      return sendJson(res, 200, await getSigun(sigun));
    }
    return serveStatic(res, decodeURIComponent(url.pathname));
  } catch (err) {
    console.error(err);
    return sendJson(res, 502, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
  if (!API_KEY) console.warn('GG_API_KEY 가 없어 시군별 샘플 5건만 조회됩니다. .env 를 설정하세요.');
});
