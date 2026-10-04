const PAGE = 200;

const $ = (id) => document.getElementById(id);
const els = {
  sigun: $('sigun'),
  type: $('type'),
  typeOptions: $('typeOptions'),
  keyword: $('keyword'),
  status: $('status'),
  list: $('list'),
  more: $('more'),
  notice: $('notice'),
  updated: $('updated'),
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
let typeOptions = [];
let selectedType = '';
let activeOption = -1;
let typeQuery = '';
const markers = new Map();
const storeIndex = new Map();

const naverUrl = (s) => `https://map.naver.com/p/search/${encodeURIComponent(`${s.sigun} ${s.name}`)}`;

const escapeHtml = (str) => str.replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

function popupHtml(s) {
  return `<a class="popup-name" href="${naverUrl(s)}" target="_blank" rel="noopener">${escapeHtml(s.name)}</a>
    <div class="popup-meta">${escapeHtml(s.type)}<br>${escapeHtml(s.addr)}</div>`;
}

async function init() {
  const meta = await fetch('data/meta.json').then((r) => r.json());
  els.sigun.innerHTML = '<option value="">시·군 선택</option>'
    + meta.siguns.map((s) => `<option value="${s.name}">${s.name} (${s.count.toLocaleString()})</option>`).join('');
  els.updated.textContent = `데이터 기준: ${new Date(meta.updatedAt).toLocaleString('ko-KR')}`;
  if (meta.sample) {
    els.notice.hidden = false;
    els.notice.textContent = 'API 인증키 없이 수집되어 시군별 샘플 5건만 표시됩니다.';
  }
}

async function loadSigun(sigun) {
  cluster.clearLayers();
  markers.clear();
  storeIndex.clear();
  highlight.remove();
  stores = [];
  setTypeOptions([]);
  if (!sigun) {
    applyFilter();
    return;
  }

  els.status.textContent = `${sigun} 가맹점을 불러오는 중…`;
  els.list.innerHTML = '';
  els.more.hidden = true;

  const res = await fetch(`data/${encodeURIComponent(sigun)}.json`);
  if (!res.ok) {
    els.status.textContent = `불러오기 실패: HTTP ${res.status}`;
    return;
  }
  const data = await res.json();
  if (els.sigun.value !== sigun) return;

  // [상호, 유형 index, 주소, 위도, 경도] 배열을 객체로 변환
  stores = data.stores.map(([name, type, addr, lat, lng], i) => ({
    id: String(i), name, type: data.types[type], addr, sigun, lat, lng,
  }));
  const counts = {};
  stores.forEach((s) => { counts[s.type] = (counts[s.type] || 0) + 1; });
  setTypeOptions(Object.entries(counts).sort((a, b) => b[1] - a[1]));

  stores.forEach((s) => {
    const m = L.marker([s.lat, s.lng]).bindPopup(() => popupHtml(s));
    markers.set(s.id, m);
    storeIndex.set(s.id, s);
  });

  applyFilter();
  if (stores.length) map.fitBounds(L.latLngBounds(stores.map((s) => [s.lat, s.lng])), { padding: [20, 20] });
}

function applyFilter() {
  const type = selectedType;
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
  filtered = source.filter((s) => bounds.contains([s.lat, s.lng]));

  els.list.innerHTML = '';
  shown = 0;
  els.status.textContent = stores.length
    ? `지도 영역 내 ${filtered.length.toLocaleString()}개 / 전체 ${source.length.toLocaleString()}개`
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

function setTypeOptions(entries) {
  typeOptions = [{ value: '', count: stores.length }, ...entries.map(([value, count]) => ({ value, count }))];
  selectedType = '';
  els.type.value = '';
  els.type.disabled = entries.length === 0;
}

function renderTypeOptions() {
  const kw = typeQuery.trim().toLowerCase();
  const matched = typeOptions.filter((o) => !kw || o.value.toLowerCase().includes(kw));
  els.typeOptions.innerHTML = matched.length
    ? matched.map((o, i) => `<li data-index="${i}" data-value="${escapeHtml(o.value)}"
        class="${o.value === selectedType ? 'selected' : ''}${i === activeOption ? ' active' : ''}">
        <span>${escapeHtml(o.value || '전체')}</span><span class="count">${o.count.toLocaleString()}</span></li>`).join('')
    : '<li class="empty">일치하는 유형이 없습니다.</li>';
  els.typeOptions.hidden = false;
  els.typeOptions.querySelector('li.active, li.selected')?.scrollIntoView({ block: 'nearest' });
}

function openTypeOptions() {
  typeQuery = '';
  activeOption = -1;
  els.type.select();
  renderTypeOptions();
}

function selectType(value) {
  selectedType = value;
  els.type.value = value;
  els.typeOptions.hidden = true;
  els.type.blur();
  applyFilter();
}

// 열 때는 선택값과 무관하게 전체 목록, 입력하면 그때부터 필터링
els.type.addEventListener('focus', openTypeOptions);
els.type.addEventListener('click', () => { if (els.typeOptions.hidden) openTypeOptions(); });
els.type.addEventListener('input', () => {
  typeQuery = els.type.value;
  activeOption = 0;
  renderTypeOptions();
});
els.type.addEventListener('blur', () => {
  els.typeOptions.hidden = true;
  els.type.value = selectedType;
});
els.type.addEventListener('keydown', (e) => {
  if (e.isComposing) return; // 한글 조합 중 Enter 중복 처리 방지
  const items = els.typeOptions.querySelectorAll('li[data-index]');
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!items.length) return;
    activeOption = (activeOption + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    renderTypeOptions();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const item = items[Math.max(activeOption, 0)];
    if (item) selectType(item.dataset.value);
  } else if (e.key === 'Escape') {
    els.type.blur();
  }
});
// blur 전에 선택되도록 mousedown 사용
els.typeOptions.addEventListener('mousedown', (e) => {
  e.preventDefault();
  const li = e.target.closest('li[data-index]');
  if (li) selectType(li.dataset.value);
});
// 감싸는 <label> 클릭으로 input 에 다시 포커스되는 것 방지
els.typeOptions.addEventListener('click', (e) => e.preventDefault());

const storeById = (id) => storeIndex.get(id);

els.list.addEventListener('mouseover', (e) => {
  const li = e.target.closest('li');
  if (!li || li.dataset.id === highlight.storeId) return;
  const s = storeById(li.dataset.id);
  if (!s) return;
  highlight.storeId = s.id;
  highlight.setLatLng([s.lat, s.lng]).addTo(map);
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
let kwTimer;
els.keyword.addEventListener('input', () => {
  clearTimeout(kwTimer);
  kwTimer = setTimeout(applyFilter, 250);
});
els.more.addEventListener('click', renderMore);
map.on('moveend', () => updateList());

init();
