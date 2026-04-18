// ===== CS Thu Đổi PNJ — Frontend =====
// Trọng tâm: Tab calculator. Các tab khác tra cứu & làm rõ.

const API_BASE = document.querySelector('base')?.href || '';
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  data: null,
  gv: null,        // gold data cached
  gvLoc: null,     // selected location name
  gvExpanded: localStorage.getItem('gvExpanded') === '1',
  picked: null,    // DH item picked for calculator
  theme: localStorage.getItem('theme') || 'light',
};

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
  setupItems();
  setupCases();
  setupGlossary();
  await loadGiaVang(false);
  // Populate fee presets sau khi data & giá vàng đã sẵn
  setupFeePresets();
  recalcCalc();
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
    state.gv = j.data;
    // Dropdown chỉ chứa các khu vực vàng miếng (6 location đầu)
    const regionals = (j.data.locations || []).filter(isRegionalLoc);
    const sel = $('#gv-location');
    const prev = state.gvLoc || localStorage.getItem('gvLoc') || 'Đà Nẵng';
    sel.innerHTML = regionals.map(l => `<option value="${l.name}"${l.name === prev ? ' selected' : ''}>${l.name}</option>`).join('');
    state.gvLoc = sel.value || (regionals[0]?.name);
    sel.onchange = () => { state.gvLoc = sel.value; localStorage.setItem('gvLoc', sel.value); renderGiaVang(); fillLoaiVang(); };
    const ago = j.age_sec != null ? ` (${j.source}, ${j.age_sec}s trước)` : '';
    $('#gv-updated').textContent = (j.data.updated_text || '') + ago;
    renderGiaVang();
    fillLoaiVang();
  } catch (e) {
    $('#gv-updated').textContent = 'Lỗi fetch';
  } finally {
    btn.disabled = false; btn.textContent = '↻';
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

// Alias keyword cho giá MUA nguyên liệu (nl/vl đều valid)
const NL_ALIASES = {
  '750':  'Vàng 750 (18K)',
  '585':  'Vàng 585 (14K)',
  '416':  'Vàng 416 (10K)',
  '9999': 'Vàng nữ trang 999.9',
};

// Resolve alias `nl<số>` → giá MUA. Trả về {resolved, map}.
function resolveAliases(expr) {
  if (!expr) return { resolved: '', map: {} };
  const map = {};
  let out = String(expr);
  for (const [num, goldName] of Object.entries(NL_ALIASES)) {
    const re = new RegExp(`\\bnl${num}\\b`, 'gi');
    if (re.test(out)) {
      const loc = state.gv?.locations?.find(l =>
        l.gold_type.some(g => g.name === goldName)
      );
      const g = loc?.gold_type?.find(x => x.name === goldName);
      if (g) {
        const price = apiToPerPhan(g.gia_mua);
        out = out.replace(re, String(price));
        map[`nl${num}`] = { goldName, price };
      }
    }
  }
  return { resolved: out, map };
}

// safeEval với alias resolve
function safeEval(expr) {
  if (expr == null) return { val: 0, ok: true, clean: '', raw: '' };
  const raw = String(expr).trim();
  if (!raw) return { val: 0, ok: true, clean: '', raw: '' };
  const { resolved, map } = resolveAliases(raw);
  const strict = resolved.replace(/^=+/, '').replace(/,/g, '').replace(/\s+/g, '');
  if (!/^[\d.+\-*/()]+$/.test(strict)) {
    return { val: NaN, ok: false, clean: strict, raw, err: 'Chỉ số + − × / hoặc nl750/nl585/nl416/nl9999', aliasMap: map };
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
  // Regex: (leading? dấu) (optional space) (a) * (b)
  // Bắt tất cả term có dạng [±]num*num (num có thể có dấu .)
  const re = /([+\-]?)\s*([\d.]+)\s*\*\s*([\d.]+)/g;
  let m, first = true;
  while ((m = re.exec(strict)) !== null) {
    const sign = m[1] || (first ? '' : '+');
    const a = parseFloat(m[2]);
    const b = parseFloat(m[3]);
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

function findGoldByPrice(unitPrice, side) {
  const idx = goldPriceIndex();
  return idx.find(g => g.side === side && g.perPhan === unitPrice) || null;
}

function renderRowDiag(rowId, exprRes, ratesCtx) {
  const el = document.querySelector(`#diag-${rowId} .row-diag`);
  if (!el) return;
  const parts = [];

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
      <td class="num-col out-giaTM">—</td>
      <td class="col-small"><input class="inp-rotDa num-col" value="${escapeHtml(r.rotDa)}" placeholder="0"></td>
      <td class="col-small"><input class="inp-phiKhac num-col" value="${escapeHtml(r.phiKhac)}" placeholder="0"></td>
      <td class="num-col out-cuoi">—</td>
      <td class="col-tl hidden"><input class="inp-tlGoc num-col" value="${escapeHtml(r.tlGoc)}" placeholder="phân"></td>
      <td class="col-tl hidden num-col out-tlSau">—</td>
      <td><button class="btn-del" title="Xóa dòng (giữ ô trống)">⟲</button></td>
    </tr>
    <tr id="diag-${r.id}" class="row-diag-tr"><td></td><td colspan="10" class="row-diag"></td></tr>
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
    // Thu / Đổi mutually exclusive: nhập ô này → xóa ô kia
    rowEl.querySelector('.inp-tyLeThu').addEventListener('input', e => {
      r.tyLeThu = e.target.value;
      if (r.tyLeThu.trim()) {
        r.tyLeDoi = '';
        rowEl.querySelector('.inp-tyLeDoi').value = '';
      }
      recalcRow(r.id); recalcBKRates();
    });
    rowEl.querySelector('.inp-tyLeDoi').addEventListener('input', e => {
      r.tyLeDoi = e.target.value;
      if (r.tyLeDoi.trim()) {
        r.tyLeThu = '';
        rowEl.querySelector('.inp-tyLeThu').value = '';
      }
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
    return terms.some(t => t.kind === 'haoHut' || t.kind === 'thuaTL');
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

  rowEl.querySelector('.out-giaTM').textContent = g.clean ? fmt(giaTM) : '—';
  rowEl.querySelector('.out-cuoi').textContent = g.clean ? fmt(cuoi) : '—';

  // TL: nhận diện ± từ biểu thức
  const terms = detectGiaGocTerms(g.clean);
  const hhSumPhan = terms.filter(t => t.kind === 'haoHut').reduce((s, t) => s + t.phan, 0);
  const thuaSumPhan = terms.filter(t => t.kind === 'thuaTL').reduce((s, t) => s + t.phan, 0);
  const tlGoc = parseFloat(String(r.tlGoc).replace(',', '.'));
  const tlGocOK = isFinite(tlGoc) && tlGoc > 0;
  if (tlGocOK) {
    const tlSau = tlGoc - hhSumPhan + thuaSumPhan;
    rowEl.querySelector('.out-tlSau').textContent = tlSau.toFixed(3) + ' p';
  } else {
    rowEl.querySelector('.out-tlSau').textContent = '—';
  }

  renderRowDiag(r.id, g, { tyThu, tyDoi });
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
    const hits = state.data.items.filter(it => it.rates?.[key] === g.rate);
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

  [sel1, sel2, sel3].forEach(sel => {
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
function setupItems() {
  const nhomSel = $('#items-filter-nhom');
  const nhoms = [...new Set(state.data.items.map(i => i.nhom))].filter(Boolean).sort();
  nhomSel.innerHTML = '<option value="">Tất cả nhóm</option>' + nhoms.map(n => `<option value="${n}">Nhóm ${n}</option>`).join('');
  const render = () => {
    const q = $('#items-search').value.trim().toLowerCase();
    const nhom = nhomSel.value;
    const hits = state.data.items.filter(it =>
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
        ${rateRow('thu_truoc', 'THU trước 05/01/2026')}
        ${rateRow('doi_truoc', 'ĐỔI trước 05/01/2026')}
        ${rateRow('thu_tu', 'THU từ 05/01/2026')}
        ${rateRow('doi_tu', 'ĐỔI từ 05/01/2026')}
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
