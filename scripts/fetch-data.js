// 경기데이터드림 API에서 시군별 가맹점을 받아 public/data/*.json 으로 저장
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'public', 'data');
const API_KEY = process.env.GG_API_KEY || '';
const API_URL = 'https://openapi.gg.go.kr/RegionMnyFacltStus';
const PAGE_SIZE = 1000;
const CONCURRENCY = 6;
const RETRIES = 3;
// 기본 UA로 요청하면 경기데이터드림 보안정책에 차단됨
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

const SIGUNS = [
  '가평군', '고양시', '과천시', '광명시', '광주시', '구리시', '군포시', '김포시',
  '남양주시', '동두천시', '부천시', '성남시', '수원시', '시흥시', '안산시', '안성시',
  '안양시', '양주시', '양평군', '여주시', '연천군', '오산시', '용인시', '의왕시',
  '의정부시', '이천시', '파주시', '평택시', '포천시', '하남시', '화성시',
];

async function fetchPage(sigun, pIndex, attempt = 1) {
  const params = new URLSearchParams({ Type: 'json', pIndex, pSize: PAGE_SIZE, SIGUN_NM: sigun });
  if (API_KEY) params.set('KEY', API_KEY);
  try {
    const res = await fetch(`${API_URL}?${params}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`JSON 아님 (요청 차단 가능성): ${text.slice(0, 80).replace(/\s+/g, ' ')}`);
    }
    if (body.RESULT) {
      if (body.RESULT.CODE === 'INFO-200') return { total: 0, rows: [] };
      throw new Error(`${body.RESULT.CODE} ${body.RESULT.MESSAGE}`);
    }
    const [{ head }, { row }] = body.RegionMnyFacltStus;
    return { total: head[0].list_total_count, rows: row };
  } catch (err) {
    if (attempt >= RETRIES) throw new Error(`${sigun} p${pIndex}: ${err.message}`);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
    return fetchPage(sigun, pIndex, attempt + 1);
  }
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

async function fetchSigun(sigun) {
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

  // 01 계속사업자만 (02 휴업, 03 폐업 제외), 좌표 없는 곳 제외
  const types = [];
  const typeIndex = new Map();
  const stores = [];
  for (const r of rows) {
    if (r.LEAD_TAX_MAN_STATE_CD === '02' || r.LEAD_TAX_MAN_STATE_CD === '03') continue;
    const lat = Number(r.REFINE_WGS84_LAT);
    const lng = Number(r.REFINE_WGS84_LOGT);
    if (!(lat > 0 && lng > 0)) continue;
    const type = normalizeType(r.INDUTYPE_NM);
    if (!typeIndex.has(type)) {
      typeIndex.set(type, types.length);
      types.push(type);
    }
    stores.push([
      (r.CMPNM_NM || '').trim(),
      typeIndex.get(type),
      r.REFINE_ROADNM_ADDR || r.REFINE_LOTNO_ADDR || '',
      Math.round(lat * 1e6) / 1e6,
      Math.round(lng * 1e6) / 1e6,
    ]);
  }
  return { sigun, total: first.total, types, stores };
}

async function main() {
  if (!API_KEY) console.warn('GG_API_KEY 가 없어 시군별 샘플 5건만 수집합니다.');
  await fs.mkdir(OUT_DIR, { recursive: true });

  const meta = { updatedAt: new Date().toISOString(), sample: !API_KEY, siguns: [] };
  for (const sigun of SIGUNS) {
    const started = Date.now();
    const data = await fetchSigun(sigun);
    await fs.writeFile(path.join(OUT_DIR, `${sigun}.json`), JSON.stringify(data));
    meta.siguns.push({ name: sigun, count: data.stores.length });
    console.log(`${sigun}: ${data.stores.length.toLocaleString()} / ${data.total.toLocaleString()}건 (${Date.now() - started}ms)`);
  }
  await fs.writeFile(path.join(OUT_DIR, 'meta.json'), JSON.stringify(meta));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
