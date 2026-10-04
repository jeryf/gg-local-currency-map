const PAGE = 200;

const $ = (id) => document.getElementById(id);
const els = {
  sigun: $('sigun'),
  type: $('type'),
  keyword: $('keyword'),
  inView: $('inView'),
  status: $('status'),
  list: $('list'),
  more: $('more'),
  notice: $('notice'),
};

const map = L.map('map', { preferCanvas: true }).setView([37.4138, 127.5183], 9);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors',
}).addTo(map);

const cluster = L.markerClusterGroup({ chunkedLoading: true, disableClusteringAtZoom: 18 });
map.addLayer(cluster);

const highlightIcon = L.divIcon({ className: '', html: '<div class="highlight-marker"></div>', iconSize: [22, 22] });
const highlight = L.marker([0, 0], { icon: highlightIcon, interactive: false, zIndexOffset: 10000 });

let stores = [];
let filtered = [];
let shown = 0;
const markers = new Map();
const storeIndex = new Map();

const naverUrl = (s) => `https://search.naver.com/search.naver?query=${encodeURIComponent(`${s.sigun} ${s.name}`)}`;

const escapeHtml = (str) => str.replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

function popupHtml(s) {
  return `<a class="popup-name" href="${naverUrl(s)}" target="_blank" rel="noopener">${escapeHtml(s.name)}</a>
    <div class="popup-meta">${escapeHtml(s.type)}<br>${escapeHtml(s.addr)}</div>`;
}

async function init() {
  const { siguns, hasKey } = await fetch('/api/siguns').then((r) => r.json());
  els.sigun.innerHTML = '<option value="">시·군 선택</option>'
    + siguns.map((s) => `<option>${s}</option>`).join('');
  if (!hasKey) {
    els.notice.hidden = false;
    els.notice.textContent = '서버에 API 인증키가 없어 시군별 샘플 5건만 표시됩니다.';
  }
}

async function loadSigun(sigun) {
  cluster.clearLayers();
  markers.clear();
  storeIndex.clear();
  highlight.remove();
  stores = [];
  els.type.disabled = true;
  if (!sigun) {
    applyFilter();
    return;
  }

  els.status.textContent = `${sigun} 가맹점을 불러오는 중… (처음 조회 시 시간이 걸릴 수 있습니다)`;
  els.list.innerHTML = '';
  els.more.hidden = true;

  const res = await fetch(`/api/stores?sigun=${encodeURIComponent(sigun)}`);
  const data = await res.json();
  if (!res.ok) {
    els.status.textContent = `불러오기 실패: ${data.error}`;
    return;
  }
  if (els.sigun.value !== sigun) return;

  stores = data.stores;
  const counts = {};
  stores.forEach((s) => { counts[s.type] = (counts[s.type] || 0) + 1; });
  els.type.innerHTML = '<option value="">전체</option>'
    + Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) => `<option value="${escapeHtml(t)}">${escapeHtml(t)} (${n.toLocaleString()})</option>`)
      .join('');
  els.type.disabled = false;

  stores.forEach((s) => {
    const m = L.marker([s.lat, s.lng]).bindPopup(() => popupHtml(s));
    markers.set(s.id, m);
    storeIndex.set(s.id, s);
  });

  applyFilter();
  if (filtered.length) map.fitBounds(L.latLngBounds(filtered.map((s) => [s.lat, s.lng])), { padding: [20, 20] });
}

function applyFilter() {
  const type = els.type.value;
  const kw = els.keyword.value.trim().toLowerCase();
  const base = stores.filter((s) => (!type || s.type === type)
    && (!kw || s.name.toLowerCase().includes(kw) || s.addr.toLowerCase().includes(kw)));

  cluster.clearLayers();
  cluster.addLayers(base.map((s) => markers.get(s.id)));

  updateList(base);
}

function updateList(base = null) {
  if (base) updateList.base = base;
  const source = updateList.base || [];
  const bounds = map.getBounds();
  filtered = els.inView.checked ? source.filter((s) => bounds.contains([s.lat, s.lng])) : source;

  els.list.innerHTML = '';
  shown = 0;
  els.status.textContent = stores.length
    ? `${filtered.length.toLocaleString()}개 가맹점${els.inView.checked ? ' (지도 영역 내)' : ''}`
    : (els.sigun.value ? '가맹점이 없습니다.' : '지역을 선택하세요.');
  renderMore();
}

function renderMore() {
  const frag = document.createDocumentFragment();
  filtered.slice(shown, shown + PAGE).forEach((s) => {
    const li = document.createElement('li');
    li.dataset.id = s.id;
    li.innerHTML = `<a class="name" href="${naverUrl(s)}" target="_blank" rel="noopener">${escapeHtml(s.name)}</a>
      <div class="meta"><span class="badge">${escapeHtml(s.type)}</span>${escapeHtml(s.addr)}</div>`;
    frag.appendChild(li);
  });
  els.list.appendChild(frag);
  shown = Math.min(shown + PAGE, filtered.length);
  els.more.hidden = shown >= filtered.length;
  els.more.textContent = `더 보기 (${shown.toLocaleString()} / ${filtered.length.toLocaleString()})`;
}

const storeById = (id) => storeIndex.get(id);

els.list.addEventListener('mouseover', (e) => {
  const li = e.target.closest('li');
  if (!li || li.dataset.id === highlight.storeId) return;
  const s = storeById(li.dataset.id);
  if (!s) return;
  highlight.storeId = s.id;
  highlight.setLatLng([s.lat, s.lng]).addTo(map);
  if (!els.inView.checked && !map.getBounds().contains([s.lat, s.lng])) map.panTo([s.lat, s.lng]);
});

els.list.addEventListener('mouseleave', () => {
  highlight.storeId = null;
  highlight.remove();
});

els.list.addEventListener('click', (e) => {
  if (e.target.closest('a')) return;
  const li = e.target.closest('li');
  const s = li && storeById(li.dataset.id);
  if (!s) return;
  els.list.querySelectorAll('li.active').forEach((x) => x.classList.remove('active'));
  li.classList.add('active');
  cluster.zoomToShowLayer(markers.get(s.id), () => markers.get(s.id).openPopup());
});

els.sigun.addEventListener('change', () => loadSigun(els.sigun.value));
els.type.addEventListener('change', applyFilter);
let kwTimer;
els.keyword.addEventListener('input', () => {
  clearTimeout(kwTimer);
  kwTimer = setTimeout(applyFilter, 250);
});
els.inView.addEventListener('change', () => updateList());
els.more.addEventListener('click', renderMore);
map.on('moveend', () => { if (els.inView.checked) updateList(); });

init();
