// ===== CS Thu Đổi PNJ — Frontend =====
// Trọng tâm: Tab calculator. Các tab khác tra cứu & làm rõ.

const API_BASE = document.querySelector('base')?.href || '';
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  data: null,
  gv: null,        // gold data đang áp dụng cho calculator
  gvCurrent: null, // gold data hiện tại
  gvMode: 'current',
  gvSnapshotMeta: null,
  gvLoc: null,     // selected location name
  gvExpanded: localStorage.getItem('gvExpanded') === '1',
  picked: null,    // DH item picked for calculator
  theme: localStorage.getItem('theme') || 'light',
  thuongHieu: localStorage.getItem('thuongHieu') || 'PNJ',  // 'PNJ' | 'CAO'
};

// Lọc items theo thương hiệu đang chọn. Item không có field coi như PNJ.
function itemsForBrand() {
  return (state.data?.items || []).filter(it => (it.thuong_hieu || 'PNJ') === state.thuongHieu);
}

// 5 loại vàng thường dùng khi kiểm tra tại CH Huế 1305.
const GV_DEFAULT_GOLDS = [
  'Nhẫn Trơn PNJ 999.9',
  'Vàng nữ trang 999.9',
  'Vàng 750 (18K)',
  'Vàng 585 (14K)',
  'Vàng 416 (10K)',
];

// ===== UTILS =====
const fmt = (n) => {
  if (n == null || isNaN(n)) return '—';
  return Math.round(n).toLocaleString('vi-VN');
};
const parseMoney = (s) => {
  if (!s) return 0;
  // VND: chấm/phẩy đều là thousand separator, không có decimal trong tiền VN → strip mọi ký tự không phải digit
  const n = Number(String(s).replace(/[^\d]/g, ''));
  return isNaN(n) ? 0 : n;
};
const stripMd = (s) => (s || '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/<br>/g, '\n');

// Parse markdown table → html. Hỗ trợ format chuẩn markdown pipe table.
function mdTableToHtml(md) {
  if (!md) return '';
  const lines = md.split('\n').filter(l => l.trim().startsWith('|'));
  if (lines.length < 2) return `<pre>${escapeHtml(md)}</pre>`;
  const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  const isSep = (l) => cells(l).every(c => /^[-:\s]+$/.test(c));
  let html = '<table>';
  let first = true;
  for (const ln of lines) {
    if (isSep(ln)) continue;
    const row = cells(ln);
    const tag = first ? 'th' : 'td';
    html += '<tr>' + row.map(c => `<${tag}>${mdInline(c)}</${tag}>`).join('') + '</tr>';
    first = false;
  }
  html += '</table>';
  return html;
}
function mdInline(s) {
  return escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/&lt;br&gt;/g, '<br>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}
function mdBlockToHtml(md) {
  if (!md) return '';
  // detect tables blocks, otherwise wrap <p>
  const parts = md.split(/\n{2,}/);
  return parts.map(p => {
    if (p.trim().startsWith('|')) return mdTableToHtml(p);
    if (/^#+\s/.test(p)) {
      const m = p.match(/^(#+)\s+(.+)/);
      const lvl = Math.min(m[1].length + 1, 4);
      return `<h${lvl}>${mdInline(m[2])}</h${lvl}>`;
    }
    return `<p>${mdInline(p).replace(/\n/g, '<br>')}</p>`;
  }).join('\n');
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

// ===== BOOT =====
async function boot() {
  applyTheme(state.theme);
  setupTabs();
  setupThemeToggle();
  await loadData();
  renderAllStatic();
  setupCalc();
  setupSplitDiamondCalc();
  setupItems();
  setupCases();
  setupGlossary();
  setupGoldSnapshotControls();
  await loadGiaVang(false);
  // Populate fee presets sau khi data & giá vàng đã sẵn
  setupFeePresets();
  setupBrandToggle();
  recalcCalc();
}

// ===== BRAND TOGGLE (PNJ/CAO) =====
function setupBrandToggle() {
  const btns = document.querySelectorAll('.brand-btn');
  const applyState = () => {
    btns.forEach(b => b.classList.toggle('active', b.dataset.brand === state.thuongHieu));
    // Đánh dấu brand lên <html> để CSS đổi màu header theo mode
    document.documentElement.setAttribute('data-brand', state.thuongHieu);
    // CAO chỉ 1 mốc HĐ → ẩn radio mốc, force 'truoc'
    const mocBox = document.querySelector('#card-bk-rates .card-actions');
    if (mocBox) mocBox.style.display = state.thuongHieu === 'CAO' ? 'none' : '';
    if (state.thuongHieu === 'CAO') {
      const truoc = document.querySelector('input[name="moc"][value="truoc"]');
      if (truoc) truoc.checked = true;
    }
    // Re-render list tab items + bk rates
    if (typeof _itemsRenderFn === 'function') _itemsRenderFn();
    if (typeof recalcBKRates === 'function') recalcBKRates();
  };
  btns.forEach(b => b.addEventListener('click', () => {
    state.thuongHieu = b.dataset.brand;
    localStorage.setItem('thuongHieu', state.thuongHieu);
    applyState();
  }));
  applyState();
}

async function loadData() {
  const res = await fetch('api/data');
  state.data = await res.json();
}

// ===== THEME =====
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  state.theme = t;
  localStorage.setItem('theme', t);
}
function setupThemeToggle() {
  $('#theme-toggle').addEventListener('click', () => {
    applyTheme(state.theme === 'light' ? 'dark' : 'light');
  });
}

// ===== TABS =====
function setupTabs() {
  $$('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.tab;
      $$('.tab').forEach(b => b.classList.toggle('active', b === btn));
      $$('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + id));
    });
  });
}

// ===== GIÁ VÀNG =====
// Heuristic: "khu vực vàng miếng" = location có gold_type ⊆ {PNJ, SJC}. Còn lại là nhóm đặc biệt.
function isRegionalLoc(loc) {
  const names = new Set((loc.gold_type || []).map(g => g.name));
  for (const n of names) { if (n !== 'PNJ' && n !== 'SJC') return false; }
  return names.size > 0;
}

async function loadGiaVang(force) {
  const btn = $('#btn-refresh-gv');
  btn.disabled = true; btn.textContent = '…';
  try {
    const url = 'api/gia-vang' + (force ? '?refresh=1' : '');
    const res = await fetch(url);
    const j = await res.json();
    if (j.error) {
      $('#gv-updated').textContent = 'Lỗi: ' + j.error;
      return;
    }
    state.gvCurrent = j.data;
    const ago = j.age_sec != null ? ` (${j.source}, ${j.age_sec}s trước)` : '';
    if (state.gvMode !== 'history') {
      applyGoldDataset(j.data, 'current', { updatedText: (j.data.updated_text || '') + ago });
    }
  } catch (e) {
    $('#gv-updated').textContent = 'Lỗi fetch';
  } finally {
    btn.disabled = false; btn.textContent = '↻';
  }
}

function optionalFillLoaiVang() {
  if (typeof fillLoaiVang === 'function') fillLoaiVang();
}

function applyGoldDataset(data, mode, meta = {}) {
  state.gv = data;
  state.gvMode = mode;
  state.gvSnapshotMeta = meta;

  const regionals = (data.locations || []).filter(isRegionalLoc);
  const sel = $('#gv-location');
  const prev = state.gvLoc || localStorage.getItem('gvLoc') || 'Đà Nẵng';
  sel.innerHTML = regionals.map(l => `<option value="${l.name}"${l.name === prev ? ' selected' : ''}>${l.name}</option>`).join('');
  state.gvLoc = sel.value || (regionals[0]?.name);
  sel.onchange = () => {
    state.gvLoc = sel.value;
    localStorage.setItem('gvLoc', sel.value);
    renderGiaVang();
    optionalFillLoaiVang();
  };

  $('#gv-updated').textContent = meta.updatedText || data.updated_text || '—';
  renderSnapshotStatus();
  renderGiaVang();
  optionalFillLoaiVang();
  if (state.rows) recalcCalc();
}

function fmtDateTimeLabel(s) {
  if (!s) return '—';
  const d = new Date(String(s).replace(' ', 'T'));
  if (isNaN(d.getTime())) return s;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseVnDateTimeInput(value) {
  const raw = String(value || '').trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (iso) return raw;
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2})(?::(\d{1,2}))?)?$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  const hour = Number(m[4] || 0);
  const minute = Number(m[5] || 0);
  const d = new Date(year, month - 1, day, hour, minute);
  if (
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day ||
    d.getHours() !== hour ||
    d.getMinutes() !== minute
  ) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`;
}

function renderSnapshotStatus(message) {
  const el = $('#gv-snapshot-status');
  if (!el) return;
  if (message) {
    el.textContent = message;
    return;
  }
  if (state.gvMode !== 'history') {
    el.textContent = 'Đang dùng giá hiện tại.';
    return;
  }
  const m = state.gvSnapshotMeta || {};
  el.textContent = `Áp dụng ${fmtDateTimeLabel(m.valid_from)} - ${fmtDateTimeLabel(m.valid_to)}.`;
}

function setupGoldSnapshotControls() {
  const snapshotInput = $('#gv-snapshot-at');
  const openPicker = () => {
    if (snapshotInput?.showPicker) {
      try { snapshotInput.showPicker(); } catch (_) {}
    }
  };
  snapshotInput?.addEventListener('focus', openPicker);
  snapshotInput?.addEventListener('click', openPicker);
  $('#btn-load-gv-snapshot')?.addEventListener('click', loadGiaVangSnapshot);
  $('#btn-gv-current')?.addEventListener('click', () => {
    if (!state.gvCurrent) return;
    applyGoldDataset(state.gvCurrent, 'current', { updatedText: state.gvCurrent.updated_text || '' });
  });
}

async function loadGiaVangSnapshot() {
  const inp = $('#gv-snapshot-at');
  const btn = $('#btn-load-gv-snapshot');
  const at = parseVnDateTimeInput(inp?.value);
  if (!at) {
    renderSnapshotStatus('Nhập thời điểm dạng dd/mm/yyyy hh:mm.');
    return;
  }
  btn.disabled = true;
  renderSnapshotStatus('Đang tải giá lịch sử…');
  try {
    const res = await fetch('api/gia-vang-snapshot?at=' + encodeURIComponent(at));
    const j = await res.json();
    if (!res.ok || j.error) {
      renderSnapshotStatus('Lỗi tải lịch sử: ' + (j.error || res.status));
      return;
    }
    applyGoldDataset(j.data, 'history', {
      ...j,
      updatedText: (j.data.updated_text || '') + ' (lịch sử)',
    });
  } catch (e) {
    renderSnapshotStatus('Lỗi fetch lịch sử');
  } finally {
    btn.disabled = false;
  }
}
function findLocation() {
  if (!state.gv) return null;
  return state.gv.locations.find(l => l.name === state.gvLoc) || state.gv.locations[0];
}
// API trả string format VN (chấm = thousand separator), đơn vị = ngàn đồng / lượng.
// Ví dụ "167.500" = 167,500 ngàn đồng/lượng.
// CH Huế tính theo VNĐ/PHÂN (1 lượng = 10 chỉ = 100 phân).
//   ngàn đồng/lượng × 1000 VND/ngàn ÷ 100 phân/lượng = × 10 → VND/phân
// Calculator dùng VNĐ/chỉ (TLV đơn vị chỉ) = × 100.
const apiRawInt = (v) => Number(String(v).replace(/[^\d]/g, ''));
const apiToPerPhan = (v) => apiRawInt(v) * 10;
const apiToPerChi = (v) => apiRawInt(v) * 100;

function renderGiaVang() {
  if (!state.gv) { $('#gv-groups').innerHTML = ''; return; }
  const all = state.gv.locations || [];
  const regional = findLocation();

  // Ẩn dropdown khu vực khi ở chế độ thu gọn (vì default không hiển thị vàng miếng khu vực)
  const locRow = $('#gv-location')?.closest('label');
  if (locRow) locRow.style.display = state.gvExpanded ? '' : 'none';

  let groupsHtml = '';
  if (!state.gvExpanded) {
    // Thu gọn: chỉ 5 tuổi vàng thường dùng, lấy từ group "Giá vàng nữ trang"
    const ntLoc = all.find(l => l.name === 'Giá vàng nữ trang');
    const items = ntLoc
      ? GV_DEFAULT_GOLDS.map(n => ntLoc.gold_type.find(g => g.name === n)).filter(Boolean)
      : [];
    groupsHtml = renderGvGroup('5 tuổi vàng thường dùng', items);
  } else {
    // Mở rộng: hiện toàn bộ như cũ
    const groups = [];
    if (regional) groups.push({ title: `Vàng miếng — ${regional.name}`, items: regional.gold_type });
    for (const loc of all) {
      if (!isRegionalLoc(loc)) groups.push({ title: loc.name, items: loc.gold_type });
    }
    groupsHtml = groups.map(g => renderGvGroup(g.title, g.items)).join('');
  }

  const toggleLabel = state.gvExpanded ? '▲ Thu gọn' : '▼ Xem thêm tất cả tuổi vàng';
  $('#gv-groups').innerHTML = groupsHtml
    + `<button class="gv-toggle" id="btn-gv-toggle">${toggleLabel}</button>`;

  $('#btn-gv-toggle').addEventListener('click', () => {
    state.gvExpanded = !state.gvExpanded;
    localStorage.setItem('gvExpanded', state.gvExpanded ? '1' : '0');
    renderGiaVang();
  });
}

function renderGvGroup(title, items) {
  return `<div class="gv-group">
    <h4>${escapeHtml(title)}</h4>
    <table><thead><tr><th>Loại vàng</th><th>Giá mua</th><th>Giá bán</th></tr></thead>
    <tbody>${items.map(it => `
      <tr><td>${escapeHtml(it.name)}</td>
      <td>${fmt(apiToPerPhan(it.gia_mua))}</td>
      <td>${fmt(apiToPerPhan(it.gia_ban))}</td></tr>
    `).join('')}</tbody></table>
  </div>`;
}
// Flatten bảng giá → list tất cả {locName, gName, side, perPhan} để analyzer tra cứu
function goldPriceIndex() {
  const out = [];
  if (!state.gv) return out;
  for (const loc of state.gv.locations) {
    for (const g of loc.gold_type) {
      out.push({ locName: loc.name, gName: g.name, side: 'mua', perPhan: apiToPerPhan(g.gia_mua) });
      if (apiToPerPhan(g.gia_ban) > 0)
        out.push({ locName: loc.name, gName: g.name, side: 'ban', perPhan: apiToPerPhan(g.gia_ban) });
    }
  }
  return out;
}
$('#btn-refresh-gv')?.addEventListener('click', () => loadGiaVang(true));

// ===== CALCULATOR (expression-based, multi-row BK) =====

// Alias fallback cho các mã đang dùng thường xuyên; alias chính sẽ được sinh từ dataset đang áp dụng.
const PREFERRED_NL_ALIASES = {
  '750':  'Vàng 750 (18K)',
  '585':  'Vàng 585 (14K)',
  '416':  'Vàng 416 (10K)',
  '9999': 'Vàng nữ trang 999.9',
  '99':   'Vàng nữ trang 99',
  '999':  'Vàng nữ trang 999',
  '9000': 'Platin 9000',
  '9250': 'Platin 9250',
};

function aliasDigitsFromGoldName(name) {
  const s = String(name || '').trim();
  const m = s.match(/^(?:Vàng(?:\s+nữ\s+trang)?|Platin)\s+(\d+(?:[.,]\d+)?)/i);
  if (!m) return null;
  return m[1].replace(/[^\d]/g, '');
}

function aliasPriority(locName, goldName) {
  const loc = String(locName || '').toLowerCase();
  const name = String(goldName || '').toLowerCase();
  if (name.startsWith('platin') || loc.includes('platin')) return 110;
  if (name.startsWith('vàng nữ trang')) return 100;
  if (name.startsWith('vàng ')) return 90;
  if (loc.includes('nữ trang')) return 80;
  return 10;
}

function buildGoldAliasIndex() {
  const out = {};
  if (!state.gv) return out;

  for (const loc of state.gv.locations || []) {
    for (const g of loc.gold_type || []) {
      const digits = aliasDigitsFromGoldName(g.name);
      if (!digits) continue;
      const priority = aliasPriority(loc.name, g.name);
      for (const prefix of ['nl', 'vl']) {
        const key = prefix + digits;
        if (!out[key] || priority > out[key].priority) {
          out[key] = { gold: g, locName: loc.name, priority };
        }
      }
    }
  }

  for (const [digits, goldName] of Object.entries(PREFERRED_NL_ALIASES)) {
    const loc = state.gv?.locations?.find(l =>
      (l.gold_type || []).some(g => g.name === goldName)
    );
    const gold = loc?.gold_type?.find(g => g.name === goldName);
    if (!gold) continue;
    for (const prefix of ['nl', 'vl']) {
      out[prefix + digits] = { gold, locName: loc.name, priority: 200 };
    }
  }

  return out;
}

// Resolve alias `nl<số>` / `vl<số>`:
//   - Term có dấu `-` (hao hụt)  → giá BÁN
//   - Term lead hoặc dấu `+`     → giá MUA
// Tách biểu thức theo ± rồi replace trong từng term để biết sign context.
function nlSuggestionItems() {
  const aliasIndex = buildGoldAliasIndex();
  const preferredOrder = ['nl750', 'nl585', 'nl416', 'nl9999', 'nl99', 'nl999', 'nl9000', 'nl9250'];
  const entries = Object.entries(aliasIndex);

  if (!entries.length) {
    return preferredOrder.map(alias => ({
      alias,
      goldName: PREFERRED_NL_ALIASES[alias.replace(/^nl/, '')] || '',
      price: null,
    }));
  }

  return entries
    .filter(([alias]) => alias.startsWith('nl'))
    .sort((a, b) => {
      const ia = preferredOrder.indexOf(a[0]);
      const ib = preferredOrder.indexOf(b[0]);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      const pa = a[1].priority || 0;
      const pb = b[1].priority || 0;
      if (pb !== pa) return pb - pa;
      return a[0].localeCompare(b[0], 'vi');
    })
    .map(([alias, hit]) => ({
      alias,
      goldName: hit.gold?.name || '',
      price: apiToPerPhan(hit.gold?.gia_mua),
    }));
}

function currentNlToken(input) {
  const pos = input.selectionStart ?? input.value.length;
  const before = input.value.slice(0, pos);
  const m = before.match(/\*([a-zA-Z]{0,2}\d*)$/);
  if (!m) return null;
  const tokenStart = pos - m[1].length;
  return { start: tokenStart, end: pos, token: m[1].toLowerCase() };
}

function hideNlSuggest() {
  const box = $('#nl-suggest');
  if (box) box.classList.remove('show');
}

function showNlSuggest(input, row, filter = 'nl') {
  hideRateSuggest();
  let box = $('#nl-suggest');
  if (!box) {
    box = document.createElement('div');
    box.id = 'nl-suggest';
    box.className = 'nl-suggest';
    document.body.appendChild(box);
  }

  const q = String(filter || 'nl').toLowerCase();
  const items = nlSuggestionItems()
    .filter(it => it.alias.startsWith(q))
    .slice(0, 12);
  if (!items.length) {
    hideNlSuggest();
    return;
  }

  box.innerHTML = items.map(it => `
    <button type="button" data-alias="${escapeHtml(it.alias)}">
      <span class="nl-code">${escapeHtml(it.alias)}</span>
      <span class="nl-name">${escapeHtml(it.goldName)}</span>
      <span class="nl-price">${fmt(it.price)}</span>
    </button>
  `).join('');

  const rect = input.getBoundingClientRect();
  box.style.left = `${rect.left}px`;
  box.style.top = `${rect.bottom + 4}px`;
  box.style.minWidth = `${Math.max(rect.width, 220)}px`;
  box.classList.add('show');

  box.querySelectorAll('button[data-alias]').forEach(btn => {
    btn.addEventListener('mousedown', e => {
      e.preventDefault();
      const tok = currentNlToken(input);
      if (!tok) return;
      input.setRangeText(btn.dataset.alias, tok.start, tok.end, 'end');
      row.giaGoc = input.value;
      recalcRow(row.id);
      recalcBKRates();
      hideNlSuggest();
    });
  });
}

function setupGiaGocNlAssist(input, row) {
  input.addEventListener('keydown', e => {
    if (e.key !== '*') return;
    e.preventDefault();
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    input.setRangeText('*nl', start, end, 'end');
    row.giaGoc = input.value;
    recalcRow(row.id);
    recalcBKRates();
    showNlSuggest(input, row, 'nl');
  });

  input.addEventListener('input', () => {
    const tok = currentNlToken(input);
    if (tok && tok.token.startsWith('nl')) showNlSuggest(input, row, tok.token || 'nl');
    else hideNlSuggest();
  });

  input.addEventListener('keyup', () => {
    const tok = currentNlToken(input);
    if (tok && tok.token.startsWith('nl')) showNlSuggest(input, row, tok.token || 'nl');
  });

  input.addEventListener('blur', () => setTimeout(hideNlSuggest, 120));
}

const RATE_PRESETS = [
  { label: 'TS vàng', thu: '0.7', doi: '0.8' },
  { label: 'TS KC', thu: '0.8', doi: '0.9' },
  { label: 'TS vỏ', thu: '0.8', doi: '0.85' },
  { label: 'VS1 <5', thu: '0.93', doi: '0.95' },
  { label: 'VS1 5.x', thu: '0.93', doi: '0.97' },
  { label: 'KCR 6-8.6', thu: '0.95', doi: '0.98' },
];

function rateLabel(v) {
  return String(Math.round(Number(v) * 100));
}

function parseExprNumber(raw) {
  const s = String(raw || '').trim();
  if (!s) return NaN;
  if (/^\d+[,.]\d{1,3}$/.test(s)) return Number(s.replace(',', '.'));
  return Number(s.replace(/[^\d]/g, ''));
}

function exprSegmentAround(text, start, end) {
  let left = start;
  while (left > 0 && !/[+\-()]/.test(text[left - 1])) left--;
  let right = end;
  while (right < text.length && !/[+\-()]/.test(text[right])) right++;
  return text.slice(left, right);
}

function isLikelyNlPriceInProduct(text, tokenStart, tokenEnd) {
  const segment = exprSegmentAround(text, tokenStart, tokenEnd);
  if (!segment.includes('*')) return false;
  const nums = [...segment.matchAll(/\d[\d.,]*/g)].map(m => parseExprNumber(m[0])).filter(Number.isFinite);
  const large = nums.filter(n => n >= 100000);
  const small = nums.filter(n => n > 0 && n < 1000);
  return large.length === 1 && small.length >= 1;
}

function hasInvoiceLikeValue(expr) {
  const text = String(expr || '');
  for (const m of text.matchAll(/\d[\d.,]*/g)) {
    const val = parseExprNumber(m[0]);
    if (!Number.isFinite(val) || val < 100000) continue;
    if (isLikelyNlPriceInProduct(text, m.index, m.index + m[0].length)) continue;
    return true;
  }
  return false;
}

function rowHasManualRate(row) {
  return !!(String(row.tyLeThu || '').trim() || String(row.tyLeDoi || '').trim());
}

function shouldShowRateSuggest(row) {
  return !rowHasManualRate(row) && hasInvoiceLikeValue(row.giaGoc);
}

function hideRateSuggest() {
  const box = $('#rate-suggest');
  if (box) box.classList.remove('show');
}

function showRateSuggest(input, row) {
  hideNlSuggest();
  if (!shouldShowRateSuggest(row)) {
    hideRateSuggest();
    return;
  }

  let box = $('#rate-suggest');
  if (!box) {
    box = document.createElement('div');
    box.id = 'rate-suggest';
    box.className = 'rate-suggest';
    document.body.appendChild(box);
  }

  box.innerHTML = RATE_PRESETS.map(p => `
    <div class="rate-sg-row">
      <span class="rate-sg-label">${escapeHtml(p.label)}</span>
      <button type="button" data-mode="thu" data-value="${p.thu}">${rateLabel(p.thu)}</button>
      <button type="button" data-mode="doi" data-value="${p.doi}">${rateLabel(p.doi)}</button>
    </div>
  `).join('');

  const rect = input.getBoundingClientRect();
  box.style.left = `${rect.left}px`;
  box.style.top = `${rect.bottom + 4}px`;
  box.style.minWidth = `${Math.max(rect.width, 280)}px`;
  box.classList.add('show');

  box.querySelectorAll('button[data-mode]').forEach(btn => {
    btn.addEventListener('mousedown', e => {
      e.preventDefault();
      const rowEl = document.querySelector(`#row-${row.id}`);
      if (!rowEl) return;
      if (btn.dataset.mode === 'thu') {
        row.tyLeThu = btn.dataset.value;
        row.tyLeDoi = '';
      } else {
        row.tyLeDoi = btn.dataset.value;
        row.tyLeThu = '';
      }
      rowEl.querySelector('.inp-tyLeThu').value = row.tyLeThu;
      rowEl.querySelector('.inp-tyLeDoi').value = row.tyLeDoi;
      recalcRow(row.id);
      recalcBKRates();
      hideRateSuggest();
    });
  });
}

function scheduleRateSuggest(input, row) {
  clearTimeout(row._rateSuggestTimer);
  row._rateSuggestTimer = setTimeout(() => showRateSuggest(input, row), 900);
}

function setupGiaGocRateAssist(input, row) {
  input.addEventListener('input', () => scheduleRateSuggest(input, row));
  input.addEventListener('focus', () => scheduleRateSuggest(input, row));
  input.addEventListener('blur', () => setTimeout(hideRateSuggest, 140));
}

function resolveAliases(expr) {
  if (!expr) return { resolved: '', map: {} };
  const map = {};
  const aliasIndex = buildGoldAliasIndex();
  const aliasRe = /\b(?:nl|vl)(\d+)\b/gi;

  const resolved = String(expr).replace(/([+\-]?)([^+\-]+)/g, (_m, sign, body) => {
    const isMinus = sign === '-';
    const newBody = body.replace(aliasRe, (tok) => {
      const hit = aliasIndex[tok.toLowerCase()];
      const g = hit?.gold;
      if (!g) return tok;
      const price = isMinus ? apiToPerPhan(g.gia_ban) : apiToPerPhan(g.gia_mua);
      if (!price) return tok;
      map[tok.toLowerCase()] = {
        goldName: g.name,
        locName: hit.locName,
        price,
        side: isMinus ? 'ban' : 'mua',
      };
      return String(price);
    });
    return sign + newBody;
  });

  return { resolved, map };
}

// safeEval với alias resolve
function safeEval(expr) {
  if (expr == null) return { val: 0, ok: true, clean: '', raw: '' };
  const raw = String(expr).trim();
  if (!raw) return { val: 0, ok: true, clean: '', raw: '' };
  const { resolved, map } = resolveAliases(raw);
  const strict = resolved.replace(/^=+/, '').replace(/,/g, '').replace(/\s+/g, '');
  if (!/^[\d.+\-*/()]+$/.test(strict)) {
    return { val: NaN, ok: false, clean: strict, raw, err: 'Chỉ số + − × / hoặc alias nl/vl theo tuổi vàng', aliasMap: map };
  }
  try {
    const v = new Function('return (' + strict + ')')();
    if (typeof v !== 'number' || !isFinite(v))
      return { val: NaN, ok: false, clean: strict, raw, err: 'Không ra số', aliasMap: map };
    return { val: v, ok: true, clean: strict, raw, aliasMap: map };
  } catch (e) {
    return { val: NaN, ok: false, clean: strict, raw, err: String(e.message || e), aliasMap: map };
  }
}

function safeEvalDecimalExpr(expr) {
  if (expr == null) return { val: 0, ok: true, clean: '', raw: '' };
  return safeEval(String(expr).replace(/,/g, '.'));
}

function evalStrictNumber(expr) {
  const strict = String(expr || '').replace(/,/g, '').replace(/\s+/g, '');
  if (!strict || !/^[\d.+\-*/()]+$/.test(strict)) return NaN;
  try {
    const v = new Function('return (' + strict + ')')();
    return typeof v === 'number' && isFinite(v) ? v : NaN;
  } catch (_) {
    return NaN;
  }
}

function formatRate(v) {
  if (v == null) return '—';
  if (v === 'NONE') return '✗';
  if (v === 'NL') return 'NL';
  if (v === 'SPECIAL') return '⚙️';
  if (typeof v === 'number') return (v * 100).toFixed(0) + '%';
  return String(v);
}
function rateShortText(r) {
  if (!r) return '—';
  const t = formatRate(r.thu_truoc), d = formatRate(r.doi_truoc);
  return `THU ${t} / ĐỔI ${d}`;
}

// Phân tích biểu thức Giá gốc: tách thành các term có dấu ±, extract các "a*b" terms
// với ý nghĩa khác nhau theo dấu:
//   LEAD term (không có +/- trước) kiểu a*b → MUA NL (check b vs giá MUA)
//   Term sau "-" kiểu a*b → HAO HỤT (check b vs giá BÁN)
//   Term sau "+" kiểu a*b → THỪA TL (check b vs giá BÁN)
function detectGiaGocTerms(strict) {
  if (!strict) return [];
  const out = [];
  // Bắt term dạng [±]biểu-thức*biểu-thức, ví dụ 0.089/2*nl750 sau resolve.
  const re = /([+\-]?)([^+\-]*\*[^+\-]*)/g;
  let m, first = true;
  while ((m = re.exec(strict)) !== null) {
    const sign = m[1] || (first ? '' : '+');
    const body = m[2];
    const star = body.indexOf('*');
    const a = evalStrictNumber(body.slice(0, star));
    const b = evalStrictNumber(body.slice(star + 1));
    if (isNaN(a) || isNaN(b)) continue;
    let kind;
    if (sign === '-') kind = 'haoHut';
    else if (sign === '+') kind = 'thuaTL';
    else kind = 'muaNL';
    out.push({ kind, phan: a, unitPrice: b, sign });
    first = false;
  }
  return out;
}

function hasWeightDeltaTerms(terms) {
  return terms.some(t => t.kind === 'haoHut' || t.kind === 'thuaTL');
}

function findGoldByPrice(unitPrice, side) {
  const idx = goldPriceIndex();
  return idx.find(g => g.side === side && g.perPhan === unitPrice) || null;
}

function renderRowDiag(rowId, exprRes, ratesCtx, flags = {}) {
  const el = document.querySelector(`#diag-${rowId} .row-diag`);
  if (!el) return;
  const parts = [];

  if (flags.needTlGoc) {
    parts.push(`<span class="diag-err"><b>Nhập TL gốc</b> để kiểm tra TL sau khi hao hụt/thêm NL.</span>`);
  }

  if (ratesCtx && ratesCtx.tyThu != null && ratesCtx.tyDoi != null) {
    parts.push(`<span class="diag-warn">⚠️ Nhập cả THU & ĐỔI — ưu tiên ĐỔI</span>`);
  }

  if (!exprRes.ok && exprRes.raw) {
    parts.push(`<span class="diag-err">⚠️ ${escapeHtml(exprRes.err || 'Biểu thức lỗi')}</span>`);
  }

  const terms = exprRes.ok ? detectGiaGocTerms(exprRes.clean) : [];

  terms.forEach(t => {
    const kindLabel = t.kind === 'muaNL' ? 'Mua NL' : t.kind === 'haoHut' ? 'Hao hụt' : 'Thừa TL';
    // Hao hụt (SP hụt vàng) → trừ theo giá BÁN (bất lợi cho KH, lợi cho PNJ)
    // Thừa TL / Mua NL (SP có thêm vàng) → cộng theo giá MUA (lợi cho PNJ)
    const side = t.kind === 'haoHut' ? 'ban' : 'mua';
    const sideLabel = side === 'mua' ? 'mua' : 'bán';
    const hit = findGoldByPrice(t.unitPrice, side);
    if (hit) {
      parts.push(`<span class="diag-ok">✓ ${kindLabel} <b>${t.phan}</b>p × ${fmt(t.unitPrice)} = <b>${escapeHtml(hit.gName)}</b> (${sideLabel})</span>`);
    } else {
      parts.push(`<span class="diag-warn">⚠️ ${kindLabel} <b>${t.phan}</b>p × ${fmt(t.unitPrice)} — không khớp giá ${sideLabel}</span>`);
    }
    if (t.kind === 'haoHut' && t.phan <= 0.06) {
      parts.push(`<span class="diag-warn">⚠️ HAO HỤT CHO PHÉP 0.06 phân</span>`);
    }
  });

  // Σ Hao hụt / Thừa TL
  const hh = terms.filter(t => t.kind === 'haoHut');
  const thua = terms.filter(t => t.kind === 'thuaTL');
  if (hh.length) {
    const tlSum = hh.reduce((s, t) => s + t.phan, 0);
    const vndSum = hh.reduce((s, t) => s + t.phan * t.unitPrice, 0);
    parts.push(`<span class="diag-sum">Σ Hao hụt: <b>${tlSum.toFixed(3)}p</b> / <b>${fmt(vndSum)} ₫</b></span>`);
  }
  if (thua.length) {
    const tlSum = thua.reduce((s, t) => s + t.phan, 0);
    const vndSum = thua.reduce((s, t) => s + t.phan * t.unitPrice, 0);
    parts.push(`<span class="diag-sum">Σ Thừa TL: <b>${tlSum.toFixed(3)}p</b> / <b>${fmt(vndSum)} ₫</b></span>`);
  }

  el.innerHTML = parts.join(' · ');
}

// Parse tỷ lệ linh hoạt:
//   rỗng → null (calculator coi như không nhân = × 1 = 100%)
//   0 < v ≤ 1 → thập phân (0.7 = 70%)
//   1 < v ≤ 100 → phần trăm (70 = 70% = 0.7, 77 = 77%, 100 = 100%)
//   chấp nhận hậu tố "%" và dấu phẩy thập phân VN
function parseRateSimple(s) {
  if (!s) return null;
  const t = String(s).trim().replace('%', '').replace(',', '.').trim();
  if (!t) return null;
  const v = parseFloat(t);
  if (!isFinite(v) || v <= 0 || v > 100) return null;
  if (v > 1) return v / 100;
  return v;
}

function parseDiscountFlexible(s) {
  const raw = String(s || '').trim();
  if (!raw) return { kind: 'percent', raw: 0, rate: 0, amount: 0, ok: true };
  const isPercent = raw.includes('%');
  const clean = raw.replace('%', '').replace(',', '.').trim();
  const looksThousand = /[.,]\d{3}($|[.,])/.test(raw);
  const n = Number(clean);
  if (isPercent || (!looksThousand && isFinite(n) && n >= 0 && n <= 100)) {
    return { kind: 'percent', raw: n, rate: n / 100, amount: 0, ok: isFinite(n) };
  }
  const amount = parseMoney(raw);
  return { kind: 'amount', raw: amount, rate: 0, amount, ok: amount >= 0 };
}

function applyDiscount(base, discount) {
  if (!base) return 0;
  if (discount.kind === 'amount') return base - discount.amount;
  return base * (1 - discount.rate);
}

function reverseDiscount(finalValue, discount) {
  if (discount.kind === 'amount') return finalValue + discount.amount;
  if (discount.rate >= 1) return NaN;
  return finalValue / (1 - discount.rate);
}

function setText(sel, value, suffix = '') {
  const el = $(sel);
  if (!el) return;
  el.textContent = value == null || !isFinite(value) ? '—' : fmt(value) + suffix;
}

function calcSplitDiamond() {
  const vienGoc = parseMoney($('#split-vien-goc')?.value);
  const totalFinal = parseMoney($('#split-total-final')?.value);
  const voDisc = parseDiscountFlexible($('#split-vo-discount')?.value);
  const vienDisc = parseDiscountFlexible($('#split-vien-discount')?.value);

  const vienFinal = applyDiscount(vienGoc, vienDisc);
  const voFinal = totalFinal - vienFinal;
  const voGoc = reverseDiscount(voFinal, voDisc);
  const totalGoc = voGoc + vienGoc;
  const totalDiscValue = totalGoc - totalFinal;

  const voRate = parseRateSimple($('#split-vo-doi')?.value) ?? parseRateSimple($('#split-vo-thu')?.value) ?? 1;
  const vienRate = parseRateSimple($('#split-vien-doi')?.value) ?? parseRateSimple($('#split-vien-thu')?.value) ?? 1;
  const voBk = voFinal * voRate;
  const vienBk = vienFinal * vienRate;

  setText('.out-split-vo-goc', voGoc);
  setText('.out-split-vien-final', vienFinal);
  setText('.out-split-vo-final', voFinal);
  setText('.out-split-vo-bk', voBk);
  setText('.out-split-vien-bk', vienBk);
  setText('.out-split-total-goc', totalGoc);
  setText('.out-split-total-bk', voBk + vienBk);

  const totalDiscEl = $('.out-split-total-discount');
  if (totalDiscEl) {
    if (isFinite(totalDiscValue) && totalGoc > 0) {
      totalDiscEl.textContent = `${fmt(totalDiscValue)} (${(totalDiscValue / totalGoc * 100).toFixed(2)}%)`;
    } else {
      totalDiscEl.textContent = '—';
    }
  }

  const warnings = [];
  if (voFinal < 0) warnings.push('Giá sau giảm của vỏ đang âm. Kiểm tra lại giá gốc viên, giảm giá viên hoặc tổng sau giảm.');
  if (!voDisc.ok || !vienDisc.ok) warnings.push('Giảm giá không hợp lệ.');
  if (!isFinite(voGoc)) warnings.push('Không thể tính ngược giá gốc vỏ khi giảm giá vỏ từ 100% trở lên.');
  $('#split-diag').innerHTML = warnings.map(w => `<span class="diag-err">${escapeHtml(w)}</span>`).join(' · ');
}

function setupSplitDiamondCalc() {
  const ids = [
    '#split-vien-goc', '#split-total-final', '#split-vo-discount', '#split-vien-discount',
    '#split-vo-thu', '#split-vo-doi', '#split-vien-thu', '#split-vien-doi',
  ];
  ids.forEach(sel => $(sel)?.addEventListener('input', calcSplitDiamond));
  [
    ['#split-vo-thu', '#split-vo-doi'],
    ['#split-vien-thu', '#split-vien-doi'],
  ].forEach(([thuSel, doiSel]) => {
    const thu = $(thuSel), doi = $(doiSel);
    thu?.addEventListener('input', () => {
      if (thu.value.trim() && doi) doi.value = '';
      calcSplitDiamond();
    });
    doi?.addEventListener('input', () => {
      if (doi.value.trim() && thu) thu.value = '';
      calcSplitDiamond();
    });
  });
  calcSplitDiamond();
}

// ====== BK multi-row state & rendering ======
let _rowSeq = 0;
function newRow() {
  return { id: ++_rowSeq, giaGoc: '', rotDa: '', tyLeThu: '', tyLeDoi: '', phiKhac: '', tlGoc: '' };
}

function renderBkTable() {
  const tbody = $('#bk-rows');
  tbody.innerHTML = state.rows.map((r, i) => `
    <tr id="row-${r.id}" data-row="${r.id}">
      <td class="col-idx">${i + 1}</td>
      <td><input class="inp-giaGoc" value="${escapeHtml(r.giaGoc)}" placeholder="VD: 52290000 - 0.089*1275000"></td>
      <td class="col-rate"><input class="inp-tyLeThu" value="${escapeHtml(r.tyLeThu)}" placeholder="0.7"></td>
      <td class="col-rate"><input class="inp-tyLeDoi" value="${escapeHtml(r.tyLeDoi)}" placeholder="0.85"></td>
      <td class="col-small"><input class="inp-rotDa num-col" value="${escapeHtml(r.rotDa)}" placeholder="0"></td>
      <td class="col-small"><input class="inp-phiKhac num-col" value="${escapeHtml(r.phiKhac)}" placeholder="0"></td>
      <td class="num-col out-cuoi">—</td>
      <td class="col-tl hidden"><input class="inp-tlGoc num-col" value="${escapeHtml(r.tlGoc)}" placeholder="VD: 5.26/2"></td>
      <td class="col-tl hidden num-col out-tlSau">—</td>
      <td><button class="btn-del" title="Xóa dòng (giữ ô trống)">⟲</button></td>
    </tr>
    <tr id="diag-${r.id}" class="row-diag-tr"><td></td><td colspan="9" class="row-diag"></td></tr>
  `).join('');

  // Bind events
  state.rows.forEach(r => {
    const rowEl = document.querySelector(`#row-${r.id}`);
    const bindInput = (sel, key, sideEffect) => {
      rowEl.querySelector(sel).addEventListener('input', e => {
        r[key] = e.target.value;
        recalcRow(r.id);
        if (sideEffect) sideEffect();
      });
    };
    bindInput('.inp-giaGoc',   'giaGoc',   recalcBKRates);
    setupGiaGocNlAssist(rowEl.querySelector('.inp-giaGoc'), r);
    setupGiaGocRateAssist(rowEl.querySelector('.inp-giaGoc'), r);
    // Thu / Đổi mutually exclusive: nhập ô này → xóa ô kia
    rowEl.querySelector('.inp-tyLeThu').addEventListener('input', e => {
      r.tyLeThu = e.target.value;
      if (r.tyLeThu.trim()) {
        r.tyLeDoi = '';
        rowEl.querySelector('.inp-tyLeDoi').value = '';
      }
      hideRateSuggest();
      recalcRow(r.id); recalcBKRates();
    });
    rowEl.querySelector('.inp-tyLeDoi').addEventListener('input', e => {
      r.tyLeDoi = e.target.value;
      if (r.tyLeDoi.trim()) {
        r.tyLeThu = '';
        rowEl.querySelector('.inp-tyLeThu').value = '';
      }
      hideRateSuggest();
      recalcRow(r.id); recalcBKRates();
    });
    bindInput('.inp-rotDa',    'rotDa');
    bindInput('.inp-phiKhac',  'phiKhac');
    bindInput('.inp-tlGoc',    'tlGoc');
    rowEl.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('focus', () => { state.focusRowId = r.id; });
    });
    rowEl.querySelector('.btn-del').addEventListener('click', () => {
      // Reset row → giữ placeholder 5 dòng mặc định
      Object.assign(r, newRow(), { id: r.id });
      renderBkTable();
      recalcBKRates();
    });
  });

  state.rows.forEach(r => recalcRow(r.id));
  recalcBKTotal();
  toggleTlColsVisibility();
}

// Hiện cột TL gốc/TL sau nếu bất kỳ row nào có biểu thức chứa ± term
function anyRowHasDeltaTL() {
  return state.rows.some(r => {
    const terms = detectGiaGocTerms(safeEval(r.giaGoc).clean);
    return hasWeightDeltaTerms(terms);
  });
}
function toggleTlColsVisibility() {
  const show = anyRowHasDeltaTL();
  document.querySelectorAll('.col-tl').forEach(el => el.classList.toggle('hidden', !show));
}

function recalcRow(rowId) {
  const r = state.rows.find(x => x.id === rowId);
  if (!r) return;
  const rowEl = document.querySelector(`#row-${r.id}`);
  if (!rowEl) return;

  const g = safeEval(r.giaGoc);
  const d = safeEval(r.rotDa);
  const p = safeEval(r.phiKhac);

  const tyThu = parseRateSimple(r.tyLeThu);
  const tyDoi = parseRateSimple(r.tyLeDoi);
  // Nếu nhập cả 2 → ưu tiên ĐỔI (warning bên diag)
  const rate = tyDoi != null ? { mode: 'doi', rate: tyDoi } : (tyThu != null ? { mode: 'thu', rate: tyThu } : null);

  const gocMua = g.val - d.val;
  const giaTM = rate ? gocMua * rate.rate : gocMua;
  const cuoi = giaTM - p.val;

  rowEl.querySelector('.out-cuoi').textContent = g.clean ? fmt(cuoi) : '—';

  // TL: nhận diện ± từ biểu thức
  const terms = detectGiaGocTerms(g.clean);
  const hhSumPhan = terms.filter(t => t.kind === 'haoHut').reduce((s, t) => s + t.phan, 0);
  const thuaSumPhan = terms.filter(t => t.kind === 'thuaTL').reduce((s, t) => s + t.phan, 0);
  const tlGocEval = safeEvalDecimalExpr(r.tlGoc);
  const tlGoc = tlGocEval.val;
  const tlGocOK = isFinite(tlGoc) && tlGoc > 0;
  const hasWeightDelta = hasWeightDeltaTerms(terms);
  const needTlGoc = hasWeightDelta && !tlGocOK;
  const diagEl = document.querySelector(`#diag-${r.id}`);
  rowEl.classList.toggle('needs-tl-goc', needTlGoc);
  diagEl?.classList.toggle('needs-tl-goc', needTlGoc);
  if (tlGocOK) {
    const tlSau = tlGoc - hhSumPhan + thuaSumPhan;
    rowEl.querySelector('.out-tlSau').textContent = tlSau.toFixed(3) + ' p';
  } else {
    rowEl.querySelector('.out-tlSau').textContent = '—';
  }

  renderRowDiag(r.id, g, { tyThu, tyDoi }, { needTlGoc });
  r._computed = { gocMua, giaTM, cuoi: g.clean ? cuoi : 0, rate, hhSumPhan, thuaSumPhan };
  recalcBKTotal();
  toggleTlColsVisibility();
}

function recalcBKTotal() {
  const sum = state.rows.reduce((acc, r) => acc + (r._computed?.cuoi || 0), 0);
  $('#bk-total').textContent = fmt(sum);
}

function recalcBKRates() {
  const el = $('#bk-rates-body');
  const moc = document.querySelector('input[name="moc"]:checked').value;
  const seen = new Map();
  for (const r of state.rows) {
    const tThu = parseRateSimple(r.tyLeThu);
    const tDoi = parseRateSimple(r.tyLeDoi);
    if (tThu != null) seen.set(`thu_${tThu}`, { mode: 'thu', rate: tThu });
    if (tDoi != null) seen.set(`doi_${tDoi}`, { mode: 'doi', rate: tDoi });
  }
  if (!seen.size) {
    el.innerHTML = '<p class="muted">Nhập tỷ lệ ở các dòng trên để xem danh sách DH thoả mãn.</p>';
    return;
  }
  const groups = [...seen.values()];
  el.innerHTML = groups.map(g => {
    const key = g.mode + '_' + moc;
    const hits = itemsForBrand().filter(it => it.rates?.[key] === g.rate);
    const label = `${g.mode === 'thu' ? 'THU' : 'ĐỔI'} ${(g.rate * 100).toFixed(0)}%`;
    if (!hits.length) {
      return `<div class="rate-group"><h4>${label}</h4><p class="diag-warn">⚠️ Không có DH nào khớp (mốc HĐ ${moc === 'truoc' ? 'trước' : 'từ'} 05/01/2026).</p></div>`;
    }
    return `<div class="rate-group"><h4>${label} — ${hits.length} DH</h4>
      <ul class="dh-matches">${hits.map(it =>
        `<li><a class="pick-link" data-id="${it.id}"><span class="dh-id">${it.id}</span></a> — ${escapeHtml(it.ten)} <small class="muted">(N${it.nhom})</small></li>`
      ).join('')}</ul>
    </div>`;
  }).join('');
  el.querySelectorAll('.pick-link').forEach(a => {
    a.addEventListener('click', () => {
      $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === 'items'));
      $$('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-items'));
      const li = document.querySelector(`.list .li[data-id="${a.dataset.id}"]`);
      if (li) { li.click(); li.scrollIntoView({ block: 'center' }); }
    });
  });
}

const BK_DEFAULT_ROWS = 5;

const PNJ_LAB_FEES = {
  seal_lai: [
    { label: 'Seal lại 2.50-3.49mm', phi: 60000 },
    { label: 'Seal lại 3.50-4.99mm', phi: 80000 },
    { label: 'Seal lại 5.00-5.39mm', phi: 120000 },
    { label: 'Seal lại 5.40-8.09mm', phi: 140000 },
    { label: 'Seal lại từ 8.10mm', phi: 290000 },
    { label: 'In lại giấy kiểm định', phi: 90000 },
  ],
  dich_vu: [
    { size: '3.5-3.79', seal: 80000, seal48: 120000, seal3h: 140000, kd: 160000, kd48: 240000, kd3h: 290000, msc: 25000 },
    { size: '3.8-3.9',  seal: 80000, seal48: 120000, seal3h: 140000, kd: 190000, kd48: 290000, kd3h: 340000, msc: 25000 },
    { size: '4.0-4.49', seal: 80000, seal48: 120000, seal3h: 140000, kd: 300000, kd48: 450000, kd3h: 540000, msc: 25000 },
    { size: '4.5-4.99', seal: 80000, seal48: 120000, seal3h: 140000, kd: 420000, kd48: 630000, kd3h: 760000, msc: 30000 },
    { size: '5.0-5.39', seal: 120000, seal48: 180000, seal3h: 220000, kd: 500000, kd48: 750000, kd3h: 900000, msc: 40000 },
    { size: '5.4-5.99', seal: 140000, seal48: 210000, seal3h: 250000, kd: 720000, kd48: 1080000, kd3h: 1300000, msc: 50000 },
    { size: '6.0-6.49', seal: 140000, seal48: 210000, seal3h: 250000, kd: 1080000, kd48: 1620000, kd3h: 1940000, msc: 60000 },
    { size: '6.5-6.99', seal: 140000, seal48: 210000, seal3h: 250000, kd: 1220000, kd48: 1830000, kd3h: 2200000, msc: 80000 },
    { size: '7.0-7.49', seal: 140000, seal48: 210000, seal3h: 250000, kd: 1440000, kd48: 2160000, kd3h: 2590000, msc: 110000 },
    { size: '7.5-7.99', seal: 140000, seal48: 210000, seal3h: 250000, kd: 2090000, kd48: 3140000, kd3h: 3760000, msc: 130000 },
    { size: '8.0-8.29', seal: 290000, seal48: 440000, seal3h: 520000, kd: 1590000, kd48: 3890000, kd3h: 4660000, msc: 160000 },
  ],
};

function setupCalc() {
  state.rows = Array.from({ length: BK_DEFAULT_ROWS }, () => newRow());
  state.focusRowId = null;
  renderBkTable();

  $('#btn-add-row').addEventListener('click', () => {
    state.rows.push(newRow());
    renderBkTable();
  });
  $('#btn-reset-all').addEventListener('click', () => {
    if (!confirm('Xóa toàn bộ và khôi phục 5 dòng trống?')) return;
    state.rows = Array.from({ length: BK_DEFAULT_ROWS }, () => newRow());
    renderBkTable();
    recalcBKRates();
  });

  document.querySelectorAll('input[name="moc"]').forEach(el =>
    el.addEventListener('change', recalcBKRates));
}

function setupFeePresets() {
  const a8 = state.data.pl_a8; if (!a8) return;

  // Mài KC
  const sel1 = $('#preset-mai-kc');
  sel1.innerHTML = '<option value="">+ Phí mài KC…</option>' + a8.phi_mai_kc.map(r => {
    const label = `${r.size_min.toFixed(2)}–${r.size_max.toFixed(2)}mm → ${r.phi ? fmt(r.phi) : (r.note || '—')}`;
    return `<option value="${r.phi || ''}">${escapeHtml(label)}</option>`;
  }).join('');

  // Mất giấy GIA
  const sel2 = $('#preset-mat-gia');
  sel2.innerHTML = '<option value="">+ Phí mất giấy GIA…</option>' + a8.phi_mat_giay_gia.map(r =>
    `<option value="${r.phi}">${r.size_min}–${r.size_max}mm → ${fmt(r.phi)}</option>`
  ).join('');

  // Mài đá màu
  const sel3 = $('#preset-mai-da');
  const opts = [];
  for (const [k, v] of Object.entries(a8.phi_mai_da_mau)) {
    const groupName = k === 'cao_cap' ? 'Ruby/Sapphire/Emerald/Tanzanite/Morganite' : 'Topaz/Citrin/Moon/đá màu khác';
    for (const b of v.brackets) {
      opts.push(`<option value="${b.phi}">${escapeHtml(groupName)} · ${escapeHtml(b.note)} → ${fmt(b.phi)}</option>`);
    }
  }
  sel3.innerHTML = '<option value="">+ Phí mài đá màu…</option>' + opts.join('');

  const sel4 = $('#preset-pnj-lab');
  const labOptions = [];
  labOptions.push('<optgroup label="Seal lại / in giấy">');
  for (const r of PNJ_LAB_FEES.seal_lai) {
    labOptions.push(`<option value="${r.phi}">${escapeHtml(r.label)} → ${fmt(r.phi)}</option>`);
  }
  labOptions.push('</optgroup>');
  const serviceLabels = [
    ['seal', 'Ép seal thường'],
    ['seal48', 'Ép seal 48h'],
    ['seal3h', 'Ép seal 3h'],
    ['kd', 'Kiểm định thường'],
    ['kd48', 'Kiểm định 48h'],
    ['kd3h', 'Kiểm định 3h'],
    ['msc', 'Khác MSC'],
  ];
  labOptions.push('<optgroup label="Bảng giá dịch vụ PNJ Lab">');
  for (const row of PNJ_LAB_FEES.dich_vu) {
    for (const [key, label] of serviceLabels) {
      labOptions.push(`<option value="${row[key]}">${escapeHtml(label)} ${escapeHtml(row.size)}mm → ${fmt(row[key])}</option>`);
    }
  }
  labOptions.push('<option value="90000">In GKĐ → 90.000/tờ</option>');
  labOptions.push('</optgroup>');
  sel4.innerHTML = '<option value="">+ Phí PNJ Lab…</option>' + labOptions.join('');

  [sel1, sel2, sel3, sel4].forEach(sel => {
    sel.addEventListener('change', () => {
      if (!sel.value) return;
      // append vào ô phí khác của row đang focus; nếu không có → row đầu tiên
      const rid = state.focusRowId || state.rows[0]?.id;
      const row = state.rows.find(r => r.id === rid);
      if (!row) return;
      row.phiKhac = row.phiKhac ? `${row.phiKhac} + ${sel.value}` : sel.value;
      // Update input DOM
      const inp = document.querySelector(`#row-${rid} .inp-phiKhac`);
      if (inp) inp.value = row.phiKhac;
      sel.selectedIndex = 0;
      recalcRow(rid);
    });
  });
}

function recalcCalc() {
  // Recalc all rows + rates panel (dùng khi mốc HĐ đổi)
  state.rows?.forEach(r => recalcRow(r.id));
  recalcBKRates();
}

// ===== TAB ITEMS =====
let _itemsRenderFn = null;
function setupItems() {
  const nhomSel = $('#items-filter-nhom');
  const populateNhoms = () => {
    const prev = nhomSel.value;
    const nhoms = [...new Set(itemsForBrand().map(i => i.nhom))].filter(Boolean).sort();
    nhomSel.innerHTML = '<option value="">Tất cả nhóm</option>' + nhoms.map(n => `<option value="${n}">Nhóm ${n}</option>`).join('');
    if (nhoms.includes(prev)) nhomSel.value = prev;
  };
  populateNhoms();
  const render = () => {
    populateNhoms();
    const q = $('#items-search').value.trim().toLowerCase();
    const nhom = nhomSel.value;
    const hits = itemsForBrand().filter(it =>
      (!nhom || it.nhom === nhom) &&
      (!q || it.id.toLowerCase().includes(q) || it.ten.toLowerCase().includes(q) || (it.dac_diem || '').toLowerCase().includes(q))
    );
    const list = $('#items-list');
    list.innerHTML = hits.map(it => `
      <div class="li" data-id="${it.id}">
        <div class="li-id">${it.id}</div>
        <div class="li-ten">${escapeHtml(it.ten)}</div>
        <div class="li-rate">N${it.nhom}</div>
        <span class="li-rate">${rateShortText(it.rates)}</span>
      </div>`).join('');
    list.querySelectorAll('.li').forEach(el => {
      el.addEventListener('click', () => {
        list.querySelectorAll('.li').forEach(x => x.classList.remove('active'));
        el.classList.add('active');
        renderItemDetail(el.dataset.id);
      });
    });
  };
  $('#items-search').addEventListener('input', render);
  nhomSel.addEventListener('change', render);
  _itemsRenderFn = render;
  render();
  // Auto-pick 1 dòng hàng ngẫu nhiên để user thấy tab này có gì
  const items = document.querySelectorAll('#items-list .li');
  if (items.length) {
    const pick = items[Math.floor(Math.random() * items.length)];
    pick.click();
  }
}
function renderItemDetail(id) {
  const it = state.data.items.find(x => x.id === id);
  if (!it) return;
  const r = it.rates;
  const rateRow = (k, label) => {
    const v = r[k]; const raw = r.raw?.[k];
    const tag = formatRate(v);
    const rawText = raw && stripMd(raw).trim() ? `<br><small class="muted">${mdInline(stripMd(raw)).replace(/\n/g, ' · ')}</small>` : '';
    return `<tr><td>${label}</td><td>${tag}${rawText}</td></tr>`;
  };
  const f = (k, label) => it[k] ? `<div class="field"><span class="lbl">${label}</span><div class="val">${mdInline(stripMd(it[k])).replace(/\n/g, '<br>')}</div></div>` : '';
  $('#items-detail').innerHTML = `
    <h2>${it.id} — ${escapeHtml(it.ten)}</h2>
    <div class="muted">Nhóm ${it.nhom}</div>
    ${f('dac_diem', 'Đặc điểm nhận diện')}
    ${f('pham_vi', 'Phạm vi')}
    <div class="field"><span class="lbl">Tỷ lệ</span>
      <table class="rate-table"><tbody>
        ${it.thuong_hieu === 'CAO'
          ? rateRow('thu_truoc', 'THU') + rateRow('doi_truoc', 'ĐỔI')
          : rateRow('thu_truoc', 'THU trước 05/01/2026')
            + rateRow('doi_truoc', 'ĐỔI trước 05/01/2026')
            + rateRow('thu_tu', 'THU từ 05/01/2026')
            + rateRow('doi_tu', 'ĐỔI từ 05/01/2026')}
      </tbody></table>
    </div>
    ${f('cong_thuc', 'Công thức')}
    ${f('dieu_kien', 'Điều kiện')}
    ${f('phi', 'Phí phát sinh')}
    ${f('ghi_chu', 'Ghi chú')}
    ${f('vi_du', 'Ví dụ')}
    ${f('tham_chieu', 'Tham chiếu')}
  `;
}

// ===== TAB CASES =====
function setupCases() {
  const render = () => {
    const q = $('#cases-search').value.trim().toLowerCase();
    const hits = state.data.cases.filter(c =>
      !q || c.id.toLowerCase().includes(q) || c.title.toLowerCase().includes(q) || c.content.toLowerCase().includes(q)
    );
    const list = $('#cases-list');
    list.innerHTML = hits.map(c => `
      <div class="li" data-id="${c.id}">
        <div class="li-id">${c.id}</div>
        <div class="li-ten">${escapeHtml(c.title.replace(/^C\d+\.\s*/, ''))}</div>
      </div>`).join('');
    list.querySelectorAll('.li').forEach(el => {
      el.addEventListener('click', () => {
        list.querySelectorAll('.li').forEach(x => x.classList.remove('active'));
        el.classList.add('active');
        renderCaseDetail(el.dataset.id);
      });
    });
  };
  $('#cases-search').addEventListener('input', render);
  render();
  // Auto-pick 1 tình huống ngẫu nhiên
  const items = document.querySelectorAll('#cases-list .li');
  if (items.length) {
    const pick = items[Math.floor(Math.random() * items.length)];
    pick.click();
  }
}
function renderCaseDetail(id) {
  const c = state.data.cases.find(x => x.id === id);
  if (!c) return;
  $('#cases-detail').innerHTML = `
    <h2>${escapeHtml(c.title)}</h2>
    ${mdBlockToHtml(c.content)}
  `;
}

// ===== TAB FOUNDATION + PL A8 =====
function renderAllStatic() {
  const body = $('#foundation-body');
  body.innerHTML = Object.entries(state.data.foundation).map(([k, v]) => `
    <div class="sec">
      <h3>${escapeHtml(v.title)}</h3>
      ${mdBlockToHtml(v.content)}
    </div>`).join('');

  renderPlA8();
  renderQuickTable();
}

function renderPnjLabFees() {
  const serviceRows = PNJ_LAB_FEES.dich_vu.map(r => `
    <tr>
      <td>${escapeHtml(r.size)}</td>
      <td>${fmt(r.seal)}</td><td>${fmt(r.seal48)}</td><td>${fmt(r.seal3h)}</td>
      <td>${fmt(r.kd)}</td><td>${fmt(r.kd48)}</td><td>${fmt(r.kd3h)}</td>
      <td>${fmt(r.msc)}</td><td>90.000/tờ</td>
    </tr>
  `).join('');
  return `<div class="sec"><h3>IV. Bảng phí PNJ Lab</h3>
    <h4>Seal lại và in lại giấy kiểm định</h4>
    <table><thead><tr><th>Hạng mục</th><th>Phí</th></tr></thead><tbody>
      ${PNJ_LAB_FEES.seal_lai.map(r => `<tr><td>${escapeHtml(r.label)}</td><td>${fmt(r.phi)}</td></tr>`).join('')}
    </tbody></table>
    <h4>Bảng giá dịch vụ PNJ Lab</h4>
    <table><thead><tr>
      <th>Kích thước</th><th>Ép seal thường</th><th>Ép seal 48h</th><th>Ép seal 3h</th>
      <th>Kiểm định thường</th><th>Kiểm định 48h</th><th>Kiểm định 3h</th><th>Khác MSC</th><th>In GKĐ</th>
    </tr></thead><tbody>${serviceRows}</tbody></table>
  </div>`;
}

function renderPlA8() {
  const a8 = state.data.pl_a8;
  if (!a8) return;
  let html = `<div class="sec"><h3>I. Phí mài Kim cương</h3>
    <table><thead><tr><th>Size (mm)</th><th>Phí (VNĐ/viên)</th></tr></thead><tbody>
    ${a8.phi_mai_kc.map(r => `<tr><td>${r.size_min.toFixed(2)} – ${r.size_max.toFixed(2)}</td><td>${r.phi ? fmt(r.phi) : r.note || '—'}</td></tr>`).join('')}
    </tbody></table></div>`;

  html += `<div class="sec"><h3>II. Phí mài Đá màu</h3>`;
  for (const [k, v] of Object.entries(a8.phi_mai_da_mau)) {
    html += `<h4>${k === 'cao_cap' ? 'Nhóm cao cấp' : 'Nhóm thường'}: ${v.ten_loai.join(', ')}</h4>
    <table><thead><tr><th>Size</th><th>Phí</th></tr></thead><tbody>
    ${v.brackets.map(b => `<tr><td>${escapeHtml(b.note)}</td><td>${fmt(b.phi)}</td></tr>`).join('')}
    </tbody></table>`;
  }
  html += `</div>`;

  html += `<div class="sec"><h3>III. Phí mất giấy GIA</h3>
    <table><thead><tr><th>Size (mm)</th><th>Phí (VNĐ/viên)</th></tr></thead><tbody>
    ${a8.phi_mat_giay_gia.map(r => `<tr><td>${r.size_min} – ${r.size_max}</td><td>${fmt(r.phi)}</td></tr>`).join('')}
    </tbody></table></div>`;

  html += renderPnjLabFees();

  html += `<div class="sec"><h3>V. Bảng giá mua lại KC tấm (${a8.gia_kc_tam.length} mã)</h3>
    <div class="toolbar"><input id="kct-search" placeholder="🔍 Lọc theo mã, chất lượng, hình dáng, size..."></div>
    <table id="kct-table"><thead><tr><th>Mã</th><th>Hình dáng</th><th>Chất lượng</th><th>Cạnh lớn</th><th>Cạnh nhỏ</th><th>Giá mua</th></tr></thead><tbody>
    ${a8.gia_kc_tam.map(r => `<tr><td><code>${r.ma}</code></td><td>${r.hinh_dang}</td><td>${r.chat_luong}</td><td>${r.canh_lon}</td><td>${r.canh_nho}</td><td>${fmt(r.gia)}</td></tr>`).join('')}
    </tbody></table></div>`;

  html += `<div class="sec"><h3>Ghi chú</h3><ul>${a8.ghi_chu.map(g => `<li>${escapeHtml(g)}</li>`).join('')}</ul></div>`;

  $('#pla8-body').innerHTML = html;

  $('#kct-search')?.addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    $$('#kct-table tbody tr').forEach(tr => {
      const text = tr.textContent.toLowerCase();
      tr.style.display = text.includes(q) ? '' : 'none';
    });
  });
}
function renderQuickTable() {
  const qt = state.data.quick_table?.raw_md;
  $('#quick-table-body').innerHTML = qt ? mdBlockToHtml(qt) : '<p class="muted">—</p>';
}

// ===== TAB GLOSSARY =====
function setupGlossary() {
  const render = () => {
    const q = $('#gloss-search').value.trim().toLowerCase();
    const hits = state.data.glossary.filter(g =>
      !q || g.abbr.toLowerCase().includes(q) || g.full.toLowerCase().includes(q)
    );
    $('#gloss-body').innerHTML = hits.map(g =>
      `<div class="gloss-item"><span class="abbr">${escapeHtml(g.abbr)}</span>: ${escapeHtml(g.full)}</div>`
    ).join('');
  };
  $('#gloss-search').addEventListener('input', render);
  render();
}

// ===== START =====
boot();
