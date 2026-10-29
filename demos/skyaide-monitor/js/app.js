/* 天相星 公開監看（獨立原型；資料來自 data/*.js） */
(function () {
  'use strict';
  const OV = window.OV, MAP = window.TWMAP, IM = window.IMAGERY;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const GRADES = ['A達標', 'A未達標', 'B邊緣', 'C缺失'];
  const GCOLOR = { 'A達標': 'var(--g-a)', 'A未達標': 'var(--g-na)', 'B邊緣': 'var(--g-b)', 'C缺失': 'var(--g-c)' };
  const SEQ = ['var(--seq-0)', 'var(--seq-1)', 'var(--seq-2)', 'var(--seq-3)', 'var(--seq-4)', 'var(--seq-5)'];
  const ROUTES = [['overview', '全局'], ['imagery', '影像比對'], ['accuracy', '準確度與等級'], ['time', '時效與爭議'], ['verify', '查驗'], ['method', '資料與方法']];

  function store(k, v) { try { if (v === undefined) return localStorage.getItem('skyaide.ov.' + k); localStorage.setItem('skyaide.ov.' + k, v); } catch (e) { return null; } }
  // 展示模式：自由切換身分、拖日期、模擬竄改；實操模式：授權版要以機關憑證登入、只看最新公布的資料、查詢留紀錄
  const OPS = store('mode') === 'ops';
  function session(v) { try { if (v === undefined) return JSON.parse(sessionStorage.getItem('skyaide.ov.session')); if (v === null) sessionStorage.removeItem('skyaide.ov.session'); else sessionStorage.setItem('skyaide.ov.session', JSON.stringify(v)); } catch (e) { return null; } }
  function accessLog(entry) {
    let a = []; try { a = JSON.parse(localStorage.getItem('skyaide.ov.accesslog')) || []; } catch (e) { a = []; }
    if (entry === undefined) return a;
    a.push(entry); a = a.slice(-300);
    try { localStorage.setItem('skyaide.ov.accesslog', JSON.stringify(a)); } catch (e) { /* 無法保存 */ }
    return a;
  }
  const S = {
    role: OPS ? (session() ? 'auth' : 'public') : (store('role') === 'auth' ? 'auth' : 'public'),
    ev: OV.events.find(e => e.live).id,
    day: null, metric: 'applied', town: null, playing: null,
    cat: 'rice_flood', caseFilter: { county: '', grade: '', path: '', agree: '' },
    im: { left: 's2_pre', right: 's2_post', frame: 6, overlays: { grid: 1, towns: 1, flood: 0, ndvi: 0, cloud: 0 }, gridMetric: 'damage', split: 50 },
    verify: { sample: 0, tamper: false, text: '' },
  };

  // ------------------------------------------------------------------ 共用
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const fmt = n => n == null || isNaN(n) ? '—' : Math.round(n).toLocaleString('zh-TW');
  const pct = (a, b, d) => b ? (a / b * 100).toFixed(d == null ? 1 : d) + '%' : '—';
  const auth = () => S.role === 'auth';
  // 公眾版：1–4 件不揭露
  const cnt = n => (!auth() && n > 0 && n < 5) ? '<5' : fmt(n);
  const chip = (t, k) => '<span class="chip ' + (k || 'info') + '">' + esc(t) + '</span>';
  const lv = l => '<span class="chip lv-' + l + '">' + l + '等</span>';
  const ev = () => OV.events.find(e => e.id === S.ev);
  const dateOf = (e, d) => { const [y, m, dd] = e.d0.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, dd + d)); return t.toISOString().slice(0, 10); };
  const catName = c => OV.cats[c].crop + '×' + OV.cats[c].hazard;
  const authBadge = '<span class="authbadge">授權檢視</span>';
  const tip = $('#tip');
  function showTip(e, html) { tip.innerHTML = html; tip.style.display = 'block'; const x = Math.min(e.clientX + 14, innerWidth - 270); tip.style.left = x + 'px'; tip.style.top = (e.clientY + 14) + 'px'; }
  function hideTip() { tip.style.display = 'none'; }

  // 進行中事件的「今天」用時間內插，模擬每小時更新
  function frac() { const n = new Date(); return Math.min(1, (n.getHours() * 60 + n.getMinutes()) / (24 * 60)); }
  function val(arr, t) {
    const e = ev();
    if (!arr) return 0;
    if (e.live && t >= e.T) return arr[e.T - 1] + (arr[e.T] - arr[e.T - 1]) * frac();
    return arr[Math.min(t, arr.length - 1)];
  }
  function townsOf(e) { return Object.keys(OV.series[e.id]); }
  function sumAt(e, key, t, filter) {
    let s = 0;
    for (const k of townsOf(e)) if (!filter || filter(k)) s += val(OV.series[e.id][k][key], t);
    return s;
  }

  // ------------------------------------------------------------------ 圖表（SVG）
  function lineChart(o) {
    // o: { w, h, xs (labels), series: [{name, color, values}], marks: [{x, label}], yfmt, ymax }
    const w = o.w || 640, h = o.h || 220, l = 52, r = 14, t = 14, b = 30;
    const n = o.xs.length;
    const ymax = o.ymax || Math.max(1, ...o.series.flatMap(s => s.values.filter(v => v != null))) * 1.08;
    const X = i => l + (n <= 1 ? 0 : i / (n - 1) * (w - l - r));
    const Y = v => t + (1 - v / ymax) * (h - t - b);
    let s = '<svg class="chart" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + esc(o.label || '') + '">';
    for (let k = 0; k <= 4; k++) { const v = ymax * k / 4; s += '<line class="ax" x1="' + l + '" x2="' + (w - r) + '" y1="' + Y(v) + '" y2="' + Y(v) + '"/><text x="' + (l - 6) + '" y="' + (Y(v) + 4) + '" text-anchor="end">' + (o.yfmt ? o.yfmt(v) : fmt(v)) + '</text>'; }
    const step = Math.max(1, Math.ceil(n / 8));
    o.xs.forEach((x, i) => { if (i % step === 0 || i === n - 1) s += '<text x="' + X(i) + '" y="' + (h - 10) + '" text-anchor="middle">' + esc(x) + '</text>'; });
    (o.marks || []).forEach(m => { if (m.x < 0 || m.x >= n) return; s += '<line x1="' + X(m.x) + '" x2="' + X(m.x) + '" y1="' + t + '" y2="' + (h - b) + '" stroke="' + (m.color || 'var(--ink-3)') + '" stroke-dasharray="' + (m.solid ? '' : '3 3') + '"/><text x="' + (X(m.x) + 3) + '" y="' + (t + 10) + '" class="lab">' + esc(m.label) + '</text>'; });
    if (o.hline != null) s += '<line x1="' + l + '" x2="' + (w - r) + '" y1="' + Y(o.hline) + '" y2="' + Y(o.hline) + '" stroke="var(--red)" stroke-dasharray="4 3"/><text x="' + (w - r) + '" y="' + (Y(o.hline) - 4) + '" text-anchor="end" class="lab">' + esc(o.hlineLabel || '') + '</text>';
    for (const se of o.series) {
      let d = '', pen = false;
      se.values.forEach((v, i) => { if (v == null) { pen = false; return; } d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(v).toFixed(1); pen = true; });
      s += '<path d="' + d + '" fill="none" stroke="' + se.color + '" stroke-width="2"' + (se.dash ? ' stroke-dasharray="5 3"' : '') + '/>';
      se.values.forEach((v, i) => { if (v != null && (se.dots || n < 20)) s += '<circle cx="' + X(i) + '" cy="' + Y(v) + '" r="3" fill="' + se.color + '"><title>' + esc(o.xs[i] + ' ' + se.name + ' ' + (o.yfmt ? o.yfmt(v) : fmt(v))) + '</title></circle>'; });
    }
    s += '</svg>';
    s += '<div class="legend">' + o.series.map(se => '<span><i style="background:' + se.color + '"></i>' + esc(se.name) + '</span>').join('') + '</div>';
    return s;
  }
  function stackBars(rows, keys, colors, o) {
    // rows: [{label, values: {k: n}}]，水平百分比堆疊
    o = o || {};
    const w = 640, rowH = 22, l = 92, r = 60;
    const h = rows.length * (rowH + 8) + 6;
    let s = '<svg class="chart" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + esc(o.label || '') + '">';
    rows.forEach((row, i) => {
      const y = 4 + i * (rowH + 8);
      const tot = keys.reduce((a, k) => a + (row.values[k] || 0), 0);
      s += '<text x="' + (l - 8) + '" y="' + (y + 15) + '" text-anchor="end" class="lab">' + esc(row.label) + '</text>';
      let x = l;
      keys.forEach(k => {
        const v = row.values[k] || 0;
        const ww = tot ? v / tot * (w - l - r) : 0;
        if (ww > 0) s += '<rect x="' + x.toFixed(1) + '" y="' + y + '" width="' + Math.max(0, ww - 1).toFixed(1) + '" height="' + rowH + '" rx="2" fill="' + colors[k] + '"><title>' + esc(row.label + ' ' + k + ' ' + cnt(v) + '（' + pct(v, tot) + '）') + '</title></rect>';
        if (ww > 34) s += '<text x="' + (x + ww / 2) + '" y="' + (y + 15) + '" text-anchor="middle" style="fill:#fff;font-size:11px">' + pct(v, tot, 0) + '</text>';
        x += ww;
      });
      s += '<text x="' + (w - r + 6) + '" y="' + (y + 15) + '">' + cnt(tot) + '</text>';
    });
    s += '</svg><div class="legend">' + keys.map(k => '<span><i style="background:' + colors[k] + '"></i>' + esc(k) + '</span>').join('') + '</div>';
    return s;
  }
  function histogram(groups, o) {
    const w = 640, h = 230, l = 44, r = 14, t = 14, b = 34;
    const bin = o.bin || 5, max = o.max || 80;
    const nb = Math.ceil(max / bin);
    const counts = groups.map(g => { const c = new Array(nb).fill(0); g.values.forEach(v => { c[Math.min(nb - 1, Math.floor(v / bin))]++; }); return c; });
    const ymax = Math.max(1, ...counts.flat()) * 1.1;
    const bw = (w - l - r) / nb;
    let s = '<svg class="chart" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + esc(o.label || '') + '">';
    for (let k = 0; k <= 4; k++) { const v = ymax * k / 4; const y = t + (1 - v / ymax) * (h - t - b); s += '<line class="ax" x1="' + l + '" x2="' + (w - r) + '" y1="' + y + '" y2="' + y + '"/><text x="' + (l - 6) + '" y="' + (y + 4) + '" text-anchor="end">' + fmt(v) + '</text>'; }
    counts.forEach((c, gi) => c.forEach((v, i) => {
      if (!v) return;
      const x = l + i * bw + gi * (bw / groups.length) + 1, hh = v / ymax * (h - t - b);
      s += '<rect x="' + x.toFixed(1) + '" y="' + (h - b - hh).toFixed(1) + '" width="' + (bw / groups.length - 2).toFixed(1) + '" height="' + hh.toFixed(1) + '" fill="' + groups[gi].color + '"><title>' + esc(groups[gi].name + ' 第 ' + (i * bin) + '–' + ((i + 1) * bin) + ' 天：' + cnt(v) + ' 件') + '</title></rect>';
    }));
    for (let i = 0; i <= nb; i += 2) s += '<text x="' + (l + i * bw) + '" y="' + (h - 16) + '" text-anchor="middle">' + i * bin + '</text>';
    s += '<text x="' + ((w + l) / 2) + '" y="' + (h - 2) + '" text-anchor="middle">自災害日起算的天數</text>';
    (o.marks || []).forEach(m => { const x = l + m.x / bin * bw; s += '<line x1="' + x + '" x2="' + x + '" y1="' + t + '" y2="' + (h - b) + '" stroke="' + m.color + '" stroke-dasharray="4 3"/><text x="' + (x + 4) + '" y="' + (t + 10 + (m.dy || 0)) + '" class="lab">' + esc(m.label) + '</text>'; });
    s += '</svg><div class="legend">' + groups.map(g => '<span><i style="background:' + g.color + '"></i>' + esc(g.name) + '</span>').join('') + '</div>';
    return s;
  }

  // ------------------------------------------------------------------ 外框
  function nav() {
    const r = route();
    $('#nav').innerHTML = ROUTES.map(([k, t]) => '<a href="#/' + k + '" class="' + (r === k ? 'on' : '') + '">' + t + '</a>').join('');
    $$('.role button').forEach(b => b.classList.toggle('on', b.dataset.role === S.role));
    const sess = session();
    if (OPS) {
      $('#notice').innerHTML = auth() ? '實操模式・授權監察版：' + esc(sess.agency + ' ' + sess.officer) + '（機關憑證，演示）。每次查詢都留存紀錄。 <a href="#" id="logout">登出</a>'
        : '實操模式・公眾版：只顯示最新公布的資料；統計最小到鄉鎮，1–4 件不揭露。授權監察版須以機關憑證登入。';
      const lo = $('#logout'); if (lo) lo.addEventListener('click', (e) => { e.preventDefault(); session(null); S.role = 'public'; render(); });
      return;
    }
    $('#notice').innerHTML = auth()
      ? '授權監察版（示範）：可看到去識別的案件明細、鄉鎮層級的系統與公所判定差異、像素層級的影像判讀。正式系統以機關憑證登入，每次查詢留存紀錄。'
      : '公眾版：統計最小到鄉鎮，1–4 件不揭露；影像只顯示 500 公尺網格。統計為測試資料，影像比對為真實衛星影像。';
  }
  $$('.role button').forEach(b => b.addEventListener('click', () => {
    if (OPS && b.dataset.role === 'auth' && !session()) { loginDialog(); return; }
    if (OPS && b.dataset.role === 'public') { S.role = 'public'; render(); return; }
    S.role = b.dataset.role; store('role', S.role); render();
  }));
  // 模式切換
  (function () {
    const sel = document.createElement('select');
    sel.setAttribute('aria-label', '模式');
    sel.style.cssText = 'font:inherit;font-size:13px;border-radius:8px;padding:4px 8px;background:' + (OPS ? '#1d6b43' : '#24345a') + ';color:#fff;border:1px solid #3c4d74';
    sel.innerHTML = '<option value="demo">展示模式</option><option value="ops">實操模式</option>';
    sel.value = OPS ? 'ops' : 'demo';
    sel.addEventListener('change', () => { store('mode', sel.value); session(null); location.reload(); });
    document.querySelector('.top .in').insertBefore(sel, document.querySelector('.role'));
  })();
  function loginDialog() {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(10,15,25,.5);display:flex;align-items:center;justify-content:center;z-index:50;padding:16px';
    ov.innerHTML = '<div class="card" role="dialog" aria-modal="true" aria-label="機關憑證登入" style="max-width:420px;width:100%"><h2>授權監察版登入</h2><p class="sub">正式系統插入機關憑證（政府憑證管理中心）並輸入 PIN；演示時選機關與承辦。登入後每次查詢都會留存紀錄。</p>' +
      '<p><label class="small">機關 <select id="lgA"><option>監察院</option><option>立法院</option><option>審計部</option><option>法院</option><option>農業部</option></select></label></p>' +
      '<p><label class="small">承辦 <input type="text" id="lgN" placeholder="姓名"></label></p><p><label class="small">查詢目的 <input type="text" id="lgP" placeholder="例如：調查案、預算審查、訴訟"></label></p>' +
      '<p class="small" id="lgW" style="color:var(--red)"></p><div class="row"><button class="btn" id="lgC">取消</button><button class="btn primary" id="lgO">以機關憑證登入（演示）</button></div></div>';
    document.body.appendChild(ov);
    ov.querySelector('#lgC').addEventListener('click', () => ov.remove());
    ov.querySelector('#lgO').addEventListener('click', () => {
      const n = ov.querySelector('#lgN').value.trim(), pu = ov.querySelector('#lgP').value.trim();
      if (!n || !pu) { ov.querySelector('#lgW').textContent = '請填承辦姓名與查詢目的'; return; }
      session({ agency: ov.querySelector('#lgA').value, officer: n, purpose: pu, at: new Date().toISOString() });
      accessLog({ at: new Date().toISOString(), agency: ov.querySelector('#lgA').value, officer: n, purpose: pu, what: '登入' });
      ov.remove(); S.role = 'auth'; render();
    });
  }
  function route() { const r = (location.hash || '').replace(/^#\/?/, '').split('/')[0]; return ROUTES.some(x => x[0] === r) ? r : 'overview'; }
  window.addEventListener('hashchange', () => { stopPlay(); render(); window.scrollTo(0, 0); });

  function eventBar() {
    const e = ev();
    const btns = OV.events.map(x => '<button class="btn' + (x.id === S.ev ? ' on' : '') + '" data-ev="' + x.id + '">' + esc(x.name) + (x.live ? '（進行中）' : '') + '</button>').join(' ');
    const status = e.live ? '<span class="live"><i></i>進行中・第 ' + e.T + ' 天</span> <span class="muted small" id="updated"></span>' : '<span class="chip">已結束</span>';
    return '<div class="row" style="margin-bottom:10px">' + btns + '<span class="spacer" style="flex:1"></span>' + status + '</div>';
  }
  function bindEventBar(root) {
    $$('[data-ev]', root).forEach(b => b.addEventListener('click', () => { S.ev = b.dataset.ev; S.day = null; S.town = null; stopPlay(); render(); }));
    tickUpdated();
  }
  function tickUpdated() {
    const u = $('#updated');
    if (!u) return;
    const n = new Date();
    u.textContent = '資料更新 ' + String(n.getHours()).padStart(2, '0') + ':' + String(Math.floor(n.getMinutes() / 5) * 5).padStart(2, '0') + '（測試資料，模擬每 5 分鐘更新）';
  }

  // ------------------------------------------------------------------ 全局
  const METRICS = {
    applied: ['申請件數', (a, t) => val(a.applied, t), 'count'],
    direct: ['系統可直接判定比例（A 達標＋A 未達標）', (a, t) => { const ap = val(a.applied, t); return ap ? (val(a['A達標'], t) + val(a['A未達標'], t)) / ap : null; }, 'rate'],
    done: ['已完成審核或通知比例', (a, t) => { const ap = val(a.applied, t); return ap ? val(a.done, t) / ap : null; }, 'rate'],
    supp: ['待補件件數', (a, t) => val(a.supp_open, t), 'count'],
    paid: ['已撥款件數', (a, t) => val(a.paid, t), 'count'],
  };
  function stagesOf(e) {
    const s = e.stages;
    return [{ x: 0, label: '災害' }, { x: s.announce, label: '公告' }, { x: s.apply_end, label: '申請截止' }, { x: s.survey_end, label: '勘查截止' }, { x: s.county_check, label: '縣府抽查' }, { x: s.agency, label: '農糧署審核' }];
  }
  function overview() {
    const e = ev();
    if (S.day == null || S.day > e.T || OPS) S.day = e.T;
    const t = S.day;
    const H = 62;
    const marks = stagesOf(e).map((m, i, arr) => '<span class="' + (i === 0 ? 'first' : '') + '" style="left:' + (m.x / H * 100) + '%">' + m.label + '<br>' + dateOf(e, m.x).slice(5) + '</span>').join('') +
      '<span class="last" style="left:100%">第 62 天<br>' + dateOf(e, H).slice(5) + '</span>';
    const ap = sumAt(e, 'applied', t), done = sumAt(e, 'done', t), aa = sumAt(e, 'A達標', t), an = sumAt(e, 'A未達標', t);
    const kp = [
      ['申請件數', cnt(ap), '涉及 ' + townsOf(e).length + ' 個鄉鎮市區'],
      ['系統可直接判定', pct(aa + an, ap), 'A 達標 ' + cnt(aa) + '、A 未達標 ' + cnt(an)],
      ['已完成審核或通知', cnt(done), pct(done, ap)],
      ['到場確認', cnt(sumAt(e, 'field', t)), '含抽查、異議、B、C'],
      ['待補件', cnt(sumAt(e, 'supp_open', t)), '無人機已補拍 ' + cnt(sumAt(e, 'drone', t))],
      ['異議／申復', cnt(sumAt(e, 'objection', t)) + '／' + cnt(sumAt(e, 'appeal', t)), '任一方異議即改排到場'],
      ['已撥款', cnt(sumAt(e, 'paid', t)), '示意金額 ' + fmt(sumAt(e, 'amount', t)) + ' 萬元'],
    ];
    const m = METRICS[S.metric];
    const html = '<div class="card">' + eventBar() +
      '<div class="timeline"><div class="bar"><i style="width:' + (t / H * 100) + '%"></i></div><div class="marks">' + marks + '</div></div>' +
      (OPS ? '<div class="small"><b>第 ' + t + ' 天</b>　' + dateOf(e, t) + (e.live ? '　最新公布' : '　事件結束後的最終數字') + '</div></div>' : '<div class="dayctl"><button class="btn" id="play" aria-label="播放">' + (S.playing ? '暫停' : '▶ 播放') + '</button><input type="range" id="day" min="0" max="' + e.T + '" value="' + t + '" aria-label="事件第幾天"><span class="small" style="min-width:10em"><b>第 ' + t + ' 天</b>　' + dateOf(e, t) + '</span></div></div>') +
      '<div class="kpis" style="margin:12px 0" id="kpis">' + kp.map(k => '<div class="kpi"><span>' + k[0] + '</span><b>' + k[1] + '</b><em>' + k[2] + '</em></div>').join('') + '</div>' +
      '<div class="grid g2"><div class="card"><div class="row" style="justify-content:space-between"><h2>各鄉鎮市區</h2><select id="metric" aria-label="地圖指標">' +
      Object.entries(METRICS).map(([k, v]) => '<option value="' + k + '"' + (k === S.metric ? ' selected' : '') + '>' + v[0] + '</option>').join('') + '</select></div>' +
      '<p class="sub">灰色為本事件未涉及的地區。點選鄉鎮看細節。</p><div class="mapbox">' + twMap(e, t) + '</div><div id="mlegend"></div></div>' +
      '<div class="grid" style="align-content:start"><div class="card" id="towncard">' + townCard(e, t) + '</div>' +
      '<div class="card"><h2>分級組成（依縣市）</h2><p class="sub">系統對每件申請的分級。A 級才可能免到場；B、C 交由公所到場或補件。</p>' + gradeByCounty(e, t) + '</div></div></div>' +
      '<div class="grid g2e" style="margin-top:16px"><div class="card"><h2>每日進度</h2><p class="sub">累計件數；虛線為法定時程。</p>' + progressChart(e, t) + '</div>' +
      '<div class="card"><h2>本場各類別的系統等級</h2><p class="sub">等級決定系統結果怎麼用：甲等 A 級書面處理，乙等只作排序參考，丙等不交公所。</p>' + levelMix(e) + '</div></div>' +
      (auth() ? '<div class="card authonly" style="margin-top:16px"><h2>去識別案件明細' + authBadge + '</h2><p class="sub">每場隨機抽 360 筆示範。不含姓名、完整地號與帳戶；案號可對應公所的原始案卷。</p>' + caseTable(e, t) + '</div>' : '');
    $('#main').innerHTML = html;
    bindEventBar($('#main'));
    if (!OPS) { $('#day').addEventListener('input', ev2 => { S.day = +ev2.target.value; stopPlay(); overview(); }); $('#play').addEventListener('click', togglePlay); }
    $('#metric').addEventListener('change', x => { S.metric = x.target.value; overview(); });
    bindMap(e, t);
    $$('[data-cf]').forEach(s => s.addEventListener('change', x => { S.caseFilter[x.target.dataset.cf] = x.target.value; overview(); }));
  }
  function togglePlay() {
    const e = ev();
    if (S.playing) { stopPlay(); overview(); return; }
    if (S.day >= e.T) S.day = 0;
    S.playing = setInterval(() => { S.day++; if (S.day >= e.T) { S.day = e.T; stopPlay(); } if (route() === 'overview') overview(); }, 380);
    overview();
  }
  function stopPlay() { if (S.playing) { clearInterval(S.playing); S.playing = null; } }

  function metricDomain(e) {
    const m = METRICS[S.metric];
    if (m[2] === 'rate') return [0, 1];
    let mx = 1;
    for (const k of townsOf(e)) for (let d = 0; d <= e.T; d++) mx = Math.max(mx, m[1](OV.series[e.id][k], d) || 0);
    return [0, mx];
  }
  function twMap(e, t) {
    const m = METRICS[S.metric];
    const [, mx] = metricDomain(e);
    const ser = OV.series[e.id];
    let s = '<svg class="tw" viewBox="0 0 ' + MAP.width + ' ' + MAP.height + '" role="img" aria-label="臺灣各鄉鎮市區 ' + esc(m[0]) + '">';
    for (const tn of MAP.towns) {
      const a = ser[tn.key];
      let fill = '';
      if (a) {
        const v = m[1](a, t);
        const k = v == null ? 0 : Math.min(5, Math.floor(v / mx * 5.999));
        fill = ' style="fill:' + (v == null || (m[2] === 'count' && v === 0) ? 'var(--seq-0)' : SEQ[Math.max(1, k)]) + '"';
      }
      s += '<path class="town' + (a ? ' hit' : '') + (S.town === tn.key ? ' sel' : '') + '" data-k="' + tn.key + '" d="' + tn.d + '"' + fill + '/>';
    }
    for (const c of MAP.counties) s += '<path class="county" d="' + c.d + '"/>';
    for (const b of MAP.insets) s += '<rect class="inset" x="' + b.box[0] + '" y="' + b.box[1] + '" width="' + (b.box[2] - b.box[0]) + '" height="' + (b.box[3] - b.box[1]) + '"/><text x="' + (b.box[0] + 4) + '" y="' + (b.box[3] - 4) + '">' + b.name + '</text>';
    s += '</svg>';
    return s;
  }
  function bindMap(e, t) {
    const m = METRICS[S.metric];
    const [, mx] = metricDomain(e);
    const f = v => m[2] === 'rate' ? (v * 100).toFixed(0) + '%' : fmt(v);
    $('#mlegend').innerHTML = '<div class="legend">' + esc(m[0]) + '　<span class="ramp">' + SEQ.slice(1).map(c => '<i style="background:' + c + '"></i>').join('') + '</span> ' + f(0) + '–' + f(mx) + '　<span><i style="background:var(--land)"></i>本事件未涉及</span></div>';
    $$('svg.tw path.hit').forEach(p => {
      p.addEventListener('mousemove', x => { const a = OV.series[e.id][p.dataset.k]; const v = m[1](a, t); showTip(x, '<b>' + esc(p.dataset.k.replace('|', ' ')) + '</b><br>' + esc(m[0]) + '：' + (v == null ? '—' : (m[2] === 'rate' ? (v * 100).toFixed(1) + '%' : cnt(v))) + '<br>申請 ' + cnt(val(a.applied, t)) + ' 件'); });
      p.addEventListener('mouseleave', hideTip);
      p.addEventListener('click', () => { S.town = p.dataset.k; hideTip(); overview(); });
    });
  }
  function townCard(e, t) {
    const ser = OV.series[e.id];
    if (!S.town || !ser[S.town]) {
      const byC = {};
      for (const k of townsOf(e)) { const c = k.split('|')[0]; byC[c] = byC[c] || { applied: 0, done: 0, paid: 0, n: 0 }; byC[c].applied += val(ser[k].applied, t); byC[c].done += val(ser[k].done, t); byC[c].paid += val(ser[k].paid, t); byC[c].n++; }
      return '<h2>縣市彙總</h2><p class="sub">點地圖上的鄉鎮看單一公所。</p><table><tr><th>縣市</th><th class="n">鄉鎮</th><th class="n">申請</th><th class="n">已完成</th><th class="n">已撥款</th></tr>' +
        Object.entries(byC).map(([c, v]) => '<tr><td>' + c + '</td><td class="n">' + v.n + '</td><td class="n">' + cnt(v.applied) + '</td><td class="n">' + pct(v.done, v.applied, 0) + '</td><td class="n">' + cnt(v.paid) + '</td></tr>').join('') + '</table>';
    }
    const a = ser[S.town];
    const ap = val(a.applied, t);
    const comp = e.comparison[S.town];
    const rows = [['申請', ap], ['A 達標', val(a['A達標'], t)], ['A 未達標', val(a['A未達標'], t)], ['B 邊緣', val(a['B邊緣'], t)], ['C 缺失', val(a['C缺失'], t)],
      ['已完成審核或通知', val(a.done, t)], ['到場確認', val(a.field, t)], ['待補件', val(a.supp_open, t)], ['無人機補拍', val(a.drone, t)], ['異議', val(a.objection, t)], ['申復', val(a.appeal, t)], ['已撥款', val(a.paid, t)]];
    return '<div class="row" style="justify-content:space-between"><h2>' + esc(S.town.replace('|', ' ')) + '公所</h2><button class="btn" id="clrTown">回到縣市彙總</button></div><p class="sub">' + dateOf(e, t) + ' 為止</p>' +
      '<table>' + rows.map(r => '<tr><td>' + r[0] + '</td><td class="n">' + cnt(r[1]) + '</td><td class="n muted">' + (r[0] === '申請' ? '' : pct(r[1], ap, 0)) + '</td></tr>').join('') + '</table>' +
      (auth() ? '<h3>系統與公所判定' + authBadge + '</h3>' + (comp && comp[1] ? '<p>到場確認的 A 級 ' + comp[1] + ' 件中，公所結論與系統一致 ' + comp[0] + ' 件（' + pct(comp[0], comp[1]) + '）。</p>' : '<p class="muted">尚無到場確認的 A 級案件。</p>') : '');
  }
  document.addEventListener('click', x => { if (x.target.id === 'clrTown') { S.town = null; overview(); } });
  function gradeByCounty(e, t) {
    const byC = {};
    for (const k of townsOf(e)) { const c = k.split('|')[0]; byC[c] = byC[c] || {}; GRADES.forEach(g => byC[c][g] = (byC[c][g] || 0) + val(OV.series[e.id][k][g], t)); }
    return stackBars(Object.entries(byC).map(([c, v]) => ({ label: c, values: v })), GRADES, GCOLOR, { label: '各縣市分級組成' });
  }
  function progressChart(e, t) {
    const xs = [], A = [], D = [], P = [];
    for (let d = 0; d <= e.T; d++) { xs.push('第' + d + '天'); A.push(sumAt(e, 'applied', d)); D.push(sumAt(e, 'done', d)); P.push(sumAt(e, 'paid', d)); }
    return lineChart({ xs, series: [{ name: '申請', color: 'var(--ink-2)', values: A }, { name: '完成審核或通知', color: 'var(--blue)', values: D }, { name: '撥款', color: 'var(--green)', values: P }],
      marks: stagesOf(e).slice(1).concat([{ x: t, label: '查詢日', color: 'var(--red)', solid: true }]), label: '每日累計進度' });
  }
  function levelMix(e) {
    return '<table><tr><th>類別</th><th>本場適用</th><th>系統結果怎麼用</th></tr>' + Object.keys(OV.cats).map(c => {
      const l = e.levels[c];
      const use = l === '甲' ? 'A 達標自動申報、書面審核；A 未達標附理由通知；各抽查 20%' : l === '乙' ? '只作排序與參考，照現行規定到場' : '只收集，不交公所';
      return '<tr><td>' + catName(c) + '</td><td>' + lv(l) + '</td><td class="small">' + use + '</td></tr>';
    }).join('') + '</table><p class="small muted">整體等級：' + lv(OV.history.overall) + '；類別等級不得高於整體。</p>';
  }
  function caseTable(e, t) {
    const all = OV.authorized[e.id].filter(c => c.applied <= t);
    const f = S.caseFilter;
    const opts = (k, vals, label) => '<select data-cf="' + k + '" aria-label="' + label + '"><option value="">' + label + '（全部）</option>' + vals.map(v => '<option' + (f[k] === v ? ' selected' : '') + '>' + v + '</option>').join('') + '</select>';
    const uniq = k => [...new Set(all.map(c => c[k]))].sort();
    const rows = all.filter(c => (!f.county || c.county === f.county) && (!f.grade || c.grade === f.grade) && (!f.path || c.path === f.path) &&
      (!f.agree || (f.agree === '不一致' ? c.agree === false : f.agree === '一致' ? c.agree === true : c.agree == null)));
    const st = c => c.paid != null && c.paid <= t ? chip('已撥款', 'ok') : c.done != null && c.done <= t ? chip('已完成', 'info') : chip('處理中', 'warn');
    return '<div class="row" style="margin-bottom:8px">' + opts('county', uniq('county'), '縣市') + opts('grade', GRADES, '分級') + opts('path', uniq('path'), '處理方式') +
      opts('agree', ['一致', '不一致', '未到場'], '系統與公所') + '<span class="small muted">' + rows.length + ' 筆</span></div>' +
      '<div class="scroll tall"><table><tr><th>案號</th><th>鄉鎮</th><th>類別</th><th>等級</th><th>分級</th><th>原因</th><th>處理方式</th><th>公所判定</th><th>系統與公所</th><th>異議／申復</th><th>狀態</th></tr>' +
      rows.map(c => '<tr><td class="mono">' + c.no + '</td><td>' + esc(c.town) + '</td><td>' + esc(c.crop + '×' + c.hazard) + '</td><td>' + lv(c.level) + '</td><td>' + gchip(c.grade) + '</td><td class="small">' + esc(c.reason || '') + '</td><td class="small">' + esc(c.path) + (c.sampled ? ' ' + chip('抽查', 'pur') : '') + '</td><td>' + esc(c.office || '—') + '</td><td>' + (c.agree == null ? '<span class="muted">—</span>' : c.agree ? chip('一致', 'ok') : chip('不一致', 'bad')) + '</td><td class="small">' + esc(c.objection || '') + (c.appeal ? ' 申復' : '') + '</td><td>' + st(c) + '</td></tr>').join('') + '</table></div>';
  }
  function gchip(g) { return '<span class="chip" style="background:' + GCOLOR[g] + ';color:#fff">' + g + '</span>'; }

  // ------------------------------------------------------------------ 影像比對（真實影像）
  const BASES = () => {
    const b = [['s2_pre', '光學 ' + IM.s2.pre.date + '（災前）', 'img/s2_pre.jpg'], ['s2_post', '光學 ' + IM.s2.post.date + '（災後）', 'img/s2_post.jpg'], ['s2_late', '光學 ' + IM.s2.late.date, 'img/s2_late.jpg']];
    b.push(['s1', '雷達 ' + IM.s1[S.im.frame].date + '（逐期）', 'img/s1_' + String(S.im.frame).padStart(2, '0') + '.jpg']);
    b.push(['s1_pre', '雷達 ' + IM.s1[4].date + '（災前固定）', 'img/s1_04.jpg']);
    return b;
  };
  function imagery() {
    const st = S.im;
    if (!auth()) { st.overlays.ndvi = 0; }
    const bases = BASES();
    const opt = (sel) => bases.map(b => '<option value="' + b[0] + '"' + (b[0] === sel ? ' selected' : '') + '>' + esc(b[1]) + '</option>').join('');
    const s = IM.stats;
    const html = '<div class="grid g2"><div class="card"><h2>災前災後拉桿比對</h2><p class="sub">2025 年丹娜絲颱風（7 月 6 日登陸）嘉南沿海，東經 ' + IM.bbox[0] + '–' + IM.bbox[2] + '、北緯 ' + IM.bbox[1] + '–' + IM.bbox[3] + '，約 15 × 17 公里。左右拖動中間的把手。</p>' +
      '<div class="row" style="margin-bottom:8px"><label class="small">左 <select id="imL">' + opt(st.left) + '</select></label><label class="small">右 <select id="imR">' + opt(st.right) + '</select></label></div>' +
      '<div class="cmp" id="cmp"><div class="layer left"><img id="imgL" alt="左側影像"></div><div class="layer right" id="rightLayer"><img id="imgR" alt="右側影像"></div><div class="layer" id="ovl"></div>' +
      '<div class="handle" id="handle" role="slider" tabindex="0" aria-label="比對分隔線" aria-valuemin="0" aria-valuemax="100"></div><span class="tag l" id="tagL"></span><span class="tag r" id="tagR"></span><span class="attr">Contains modified Copernicus Sentinel data 2024–2025</span></div>' +
      '<div class="checks" style="margin-top:8px"><label><input type="checkbox" data-ov="grid"' + (st.overlays.grid ? ' checked' : '') + '> 500 公尺網格</label>' +
      '<select id="gm" aria-label="網格指標"><option value="damage"' + (st.gridMetric === 'damage' ? ' selected' : '') + '>疑似受損比例（扣去年同期）</option><option value="flood"' + (st.gridMetric === 'flood' ? ' selected' : '') + '>雷達疑似積水面積</option><option value="cloud"' + (st.gridMetric === 'cloud' ? ' selected' : '') + '>光學被雲遮比例</option></select> ' +
      '<label><input type="checkbox" data-ov="towns"' + (st.overlays.towns ? ' checked' : '') + '> 鄉鎮界線</label><label><input type="checkbox" data-ov="flood"' + (st.overlays.flood ? ' checked' : '') + '> 雷達疑似積水（隨逐期變動）</label>' +
      '<label><input type="checkbox" data-ov="cloud"' + (st.overlays.cloud ? ' checked' : '') + '> 光學雲遮</label>' +
      (auth() ? '<label><input type="checkbox" data-ov="ndvi"' + (st.overlays.ndvi ? ' checked' : '') + '> 像素層級植生異常' + authBadge + '</label>' : '<span class="small muted">像素層級判讀只在授權監察版顯示</span>') + '</div>' +
      '<div id="gridLegend" class="legend" style="margin-top:6px"></div></div>' +
      '<div class="grid" style="align-content:start"><div class="card"><h2>雷達逐期播放</h2><p class="sub">Sentinel-1 每 6 天經過一次，不受雲遮。暗的地方是平靜水面。選「雷達（逐期）」或勾「雷達疑似積水」即可在左圖看到。</p>' +
      '<div class="dayctl"><button class="btn" id="imPlay">▶ 播放</button><input type="range" id="frame" min="0" max="' + (IM.s1.length - 1) + '" value="' + st.frame + '" aria-label="雷達期別"><b id="frameDate" style="min-width:6.5em"></b></div>' +
      '<div id="floodChart"></div><p class="small muted">7 月 10 日（颱風後第一期）起的積水，與 7 月下旬起的增加要分開看：7 月下旬也是二期稻作插秧灌水的時間，雷達看到的「水面」不一定是災害。系統用三種方法投票，並比對光學與往年同期，才把一塊田算成淹水（見「資料與方法」）。</p></div>' +
      '<div class="card"><h2>這一區的判讀結果</h2><div class="stat">' +
      '<div><b>' + fmt(s.crop_analysable_ha) + '</b><span>四期光學都無雲、可判讀的作物（公頃）</span></div>' +
      '<div><b>' + fmt(s.damage_raw_ha) + '</b><span>只看今年植生下降（公頃）</span></div>' +
      '<div><b>' + fmt(s.damage_ha) + '</b><span>扣除去年同期後疑似受損（公頃）</span></div>' +
      '<div><b>' + fmt(s.flood_peak_ha) + '</b><span>雷達疑似積水最多的一期（公頃）</span></div>' +
      '<div><b>' + (s.cloud_frac * 100).toFixed(0) + '%</b><span>災前或災後光學被雲遮的比例</span></div></div>' +
      '<p class="small muted" style="margin-top:8px">「只看今年」會把正常成熟、收割也算進去；扣掉同一塊地去年同期的變化，面積明顯變小。這些是區域判讀，不是個別案件的核定結果。</p>' +
      '<h3>使用的影像</h3><div class="small mono">' + ['pre', 'post', 'late', 'ly_pre', 'ly_post'].map(k => esc(IM.s2[k].date) + '：' + IM.s2[k].ids.map(esc).join('、')).join('<br>') + '<br>Sentinel-1 RTC（相對軌道 105）：' + IM.s1.map(x => x.date.slice(5)).join('、') + '</div></div></div></div>';
    $('#main').innerHTML = html;
    $('#imL').addEventListener('change', x => { st.left = x.target.value; drawCmp(); });
    $('#imR').addEventListener('change', x => { st.right = x.target.value; drawCmp(); });
    $('#gm').addEventListener('change', x => { st.gridMetric = x.target.value; drawCmp(); });
    $$('[data-ov]').forEach(c => c.addEventListener('change', x => { st.overlays[x.target.dataset.ov] = x.target.checked ? 1 : 0; drawCmp(); }));
    $('#frame').addEventListener('input', x => { st.frame = +x.target.value; stopIm(); drawFrame(); });
    $('#imPlay').addEventListener('click', () => { if (imTimer) { stopIm(); return; } $('#imPlay').textContent = '暫停'; if (st.left !== 's1' && st.right !== 's1') st.left = 's1'; if (st.frame >= IM.s1.length - 1) st.frame = 0; imTimer = setInterval(() => { st.frame = (st.frame + 1) % IM.s1.length; $('#frame').value = st.frame; drawFrame(); if (st.frame === IM.s1.length - 1) stopIm(); }, 900); drawFrame(); });
    bindHandle();
    drawCmp();
  }
  let imTimer = null;
  function stopIm() { if (imTimer) { clearInterval(imTimer); imTimer = null; } const b = $('#imPlay'); if (b) b.textContent = '▶ 播放'; }
  function drawFrame() {
    const sel = $('#imL'); if (!sel) return;
    sel.innerHTML = BASES().map(b => '<option value="' + b[0] + '"' + (b[0] === S.im.left ? ' selected' : '') + '>' + esc(b[1]) + '</option>').join('');
    $('#imR').innerHTML = BASES().map(b => '<option value="' + b[0] + '"' + (b[0] === S.im.right ? ' selected' : '') + '>' + esc(b[1]) + '</option>').join('');
    drawCmp();
  }
  function drawCmp() {
    const st = S.im, bases = BASES();
    const L = bases.find(b => b[0] === st.left), R = bases.find(b => b[0] === st.right);
    $('#imgL').src = L[2]; $('#imgR').src = R[2];
    $('#tagL').textContent = L[1]; $('#tagR').textContent = R[1];
    $('#frameDate').textContent = IM.s1[st.frame].date + (IM.s1[st.frame].date < IM.typhoon ? '（災前）' : '（災後）');
    // 疊圖
    let o = '';
    const fr = String(st.frame).padStart(2, '0');
    if (st.overlays.cloud) o += '<img src="img/cloud.png" alt="">';
    if (st.overlays.ndvi && auth()) o += '<img src="img/ndvi_anom.png" alt="">';
    if (st.overlays.flood) o += '<img src="img/flood_' + fr + '.png" alt="">';
    let svg = '<svg viewBox="0 0 1000 1000" preserveAspectRatio="none" id="ovsvg">';
    const legend = [];
    if (st.overlays.grid) {
      const cw = 1000 / IM.nx, chh = 1000 / IM.ny;
      for (const c of IM.cells) {
        let v, a = 0, col = '214,60,40';
        if (st.gridMetric === 'damage') { if (c.analysable_ha < 2) continue; v = c.damage_ha / c.analysable_ha; a = Math.min(0.85, v * 2.4); }
        else if (st.gridMetric === 'flood') { v = c.flood_ha; a = Math.min(0.85, v / 8); col = '40,150,255'; }
        else { v = c.cloud; a = v * 0.55; col = '240,240,245'; }
        if (a < 0.04) continue;
        svg += '<rect x="' + (c.i * cw).toFixed(1) + '" y="' + (c.j * chh).toFixed(1) + '" width="' + cw.toFixed(1) + '" height="' + chh.toFixed(1) + '" fill="rgba(' + col + ',' + a.toFixed(2) + ')" stroke="rgba(255,255,255,.18)" stroke-width=".6" data-c="' + c.i + ',' + c.j + '"/>';
      }
      legend.push(st.gridMetric === 'damage' ? '<span><i style="background:rgba(214,60,40,.75)"></i>網格內疑似受損占可判讀作物比例（越紅越高；可判讀不足 2 公頃不顯示）</span>' :
        st.gridMetric === 'flood' ? '<span><i style="background:rgba(40,150,255,.75)"></i>7/10–7/22 雷達疑似積水面積</span>' : '<span><i style="background:rgba(200,200,210,.9)"></i>災前或災後光學被雲遮的比例</span>');
    }
    if (st.overlays.towns) {
      for (const t of IM.towns) {
        for (const r of t.rings) svg += '<path d="M' + r.map(p => (p[0] * 1000).toFixed(1) + ',' + (p[1] * 1000).toFixed(1)).join('L') + 'Z" fill="none" stroke="#fff" stroke-width="1.6" stroke-dasharray="6 4" opacity=".85"/>';
        svg += '<text x="' + t.label[0] * 1000 + '" y="' + t.label[1] * 1000 + '" fill="#fff" font-size="22" text-anchor="middle" style="paint-order:stroke;stroke:#000;stroke-width:3px;stroke-opacity:.5">' + esc(t.town) + '</text>';
      }
    }
    svg += '</svg>';
    if (st.overlays.flood) legend.push('<span><i style="background:rgb(40,170,255)"></i>' + IM.s1[st.frame].date + ' 雷達疑似積水（排除常年水體）</span>');
    if (st.overlays.ndvi && auth()) legend.push('<span><i style="background:rgb(214,40,40)"></i>植生比去年同期多降 0.15 以上（作物像素）</span>');
    $('#ovl').innerHTML = o + svg;
    $('#gridLegend').innerHTML = legend.join('');
    $$('#ovsvg rect').forEach(r => {
      r.addEventListener('mousemove', x => {
        const [i, j] = r.dataset.c.split(',').map(Number);
        const c = IM.cells.find(q => q.i === i && q.j === j);
        showTip(x, '<b>500 公尺網格</b><br>作物約 ' + c.crop_ha + ' 公頃，可判讀 ' + c.analysable_ha + ' 公頃<br>疑似受損 ' + c.damage_ha + ' 公頃（' + pct(c.damage_ha, c.analysable_ha, 0) + '）<br>雷達疑似積水 ' + c.flood_ha + ' 公頃<br>雲遮 ' + Math.round(c.cloud * 100) + '%');
      });
      r.addEventListener('mouseleave', hideTip);
    });
    $('#ovsvg').style.pointerEvents = st.overlays.grid ? 'auto' : 'none';
    // 逐期積水圖
    $('#floodChart').innerHTML = lineChart({ w: 520, h: 190, xs: IM.s1.map(x => x.date.slice(5)), series: [{ name: '雷達疑似積水（公頃）', color: 'var(--blue)', values: IM.s1.map(x => x.flood_ha), dots: true }],
      marks: [{ x: IM.s1.findIndex(x => x.date > IM.typhoon) - 0.5, label: '颱風', color: 'var(--red)' }, { x: st.frame, label: '目前', color: 'var(--ink)', solid: true }], label: '逐期雷達疑似積水面積' });
    setSplit(st.split);
  }
  function setSplit(p) {
    S.im.split = Math.max(0, Math.min(100, p));
    const rl = $('#rightLayer'), h = $('#handle');
    if (!rl) return;
    rl.style.clipPath = 'inset(0 0 0 ' + S.im.split + '%)';
    h.style.left = S.im.split + '%';
    h.setAttribute('aria-valuenow', Math.round(S.im.split));
  }
  function bindHandle() {
    const box = $('#cmp');
    let drag = false;
    const move = x => { const r = box.getBoundingClientRect(); setSplit((x - r.left) / r.width * 100); };
    box.addEventListener('pointerdown', e => { if (e.target.closest('rect')) return; drag = true; box.setPointerCapture(e.pointerId); move(e.clientX); });
    box.addEventListener('pointermove', e => { if (drag) move(e.clientX); });
    box.addEventListener('pointerup', () => { drag = false; });
    $('#handle').addEventListener('keydown', e => { if (e.key === 'ArrowLeft') setSplit(S.im.split - 5); if (e.key === 'ArrowRight') setSplit(S.im.split + 5); });
  }

  // ------------------------------------------------------------------ 準確度與等級
  function accuracy() {
    const H = OV.history;
    const latest = c => { const rs = H.rows.filter(r => r.cat === c && r.lb_a != null); return rs[rs.length - 1]; };
    const changes = H.rows.filter(r => r.level_before !== r.level_after || /待政府審核/.test(r.note) && r.streak === 10);
    const evName = id => (H.events.find(x => x.id === id) || {}).name || id;
    const evYm = id => (H.events.find(x => x.id === id) || {}).ym || '';
    const e = ev();
    const rows = H.rows.filter(r => r.cat === S.cat);
    const xs = rows.map(r => evName(r.event).replace('準備期回溯 ', '回溯').replace('第 ', '').replace(' 場', '場').replace('測試', ''));
    let compTot = [0, 0];
    const compC = {};
    for (const [k, v] of Object.entries(e.comparison)) { compTot[0] += v[0]; compTot[1] += v[1]; const c = k.split('|')[0]; compC[c] = compC[c] || [0, 0]; compC[c][0] += v[0]; compC[c][1] += v[1]; }
    const html = '<div class="grid g2"><div class="card"><h2>各類別目前等級</h2><p class="sub">只有 A 級（系統說「達標」或「未達標」）有對錯可言。下界是 95% 單側信賴下界：抽查 20 件全對，下界也只有 86%。任一場下界低於 95% 即降一等。</p>' +
      '<div class="scroll"><table><tr><th>作物×災害</th><th>等級</th><th class="n">連續達標</th><th class="n">A 達標下界</th><th class="n">A 未達標下界</th><th>政府審核</th></tr>' +
      Object.keys(OV.cats).map(c => { const l = latest(c) || {}; const L = H.levels[c]; const lbc = v => v == null ? '—' : '<span style="color:' + (v >= 0.95 ? 'var(--green)' : 'var(--red)') + '">' + (v * 100).toFixed(1) + '%</span>';
        return '<tr class="click" data-cat="' + c + '"' + (c === S.cat ? ' style="background:var(--sunk)"' : '') + '><td>' + catName(c) + '</td><td>' + lv(L.level) + '</td><td class="n">' + L.streak + ' 場</td><td class="n">' + lbc(l.lb_a) + '</td><td class="n">' + lbc(l.lb_na) + '</td><td class="small">' + (OV.cats[c].gov ? '已列入客觀證明文件（' + OV.cats[c].gov + '）' : (L.streak >= 10 ? chip('待審核', 'warn') : '<span class="muted">未達申請條件</span>')) + '</td></tr>'; }).join('') +
      '</table></div><p class="small muted">整體等級 ' + lv(H.overall) + '。升甲等要連續 10 場達標並經政府審核（列入種植客觀證明文件或作業要點）。降等只會讓更多案件到場，不會產生錯誤的免勘或駁回。</p></div>' +
      '<div class="card"><h2>' + catName(S.cat) + '：歷次下界</h2><p class="sub">點左表換類別。跨場累計計算；降等後歸零重算。</p>' +
      lineChart({ w: 560, h: 230, xs, ymax: 1, yfmt: v => (v * 100).toFixed(0) + '%', series: [{ name: 'A 達標精確度下界', color: 'var(--g-a)', values: rows.map(r => r.lb_a), dots: true }, { name: 'A 未達標精確度下界', color: 'var(--g-na)', values: rows.map(r => r.lb_na), dots: true, dash: true }],
        hline: 0.95, hlineLabel: '95% 門檻', label: '歷次精確度下界' }) +
      '<div class="scroll"><table class="small"><tr><th>場次</th><th class="n">A 達標 到場／錯</th><th class="n">A 未達標 到場／錯</th><th>等級</th><th>說明</th></tr>' +
      rows.slice().reverse().map(r => '<tr><td>' + esc(evName(r.event)) + ' <span class="muted">' + evYm(r.event) + '</span></td><td class="n">' + (r.n_a ? r.n_a + '／' + r.err_a : '—') + '</td><td class="n">' + (r.n_na ? r.n_na + '／' + r.err_na : '—') + '</td><td>' + (r.level_before !== r.level_after ? lv(r.level_before) + ' → ' + lv(r.level_after) : lv(r.level_after)) + '</td><td>' + esc(r.note) + '</td></tr>').join('') + '</table></div></div></div>' +
      '<div class="grid g2e" style="margin-top:16px"><div class="card"><h2>升降等紀錄</h2><p class="sub">每一次等級變動與原因，依時間排列。</p><div class="scroll tall"><table><tr><th>場次</th><th>類別</th><th>變動</th><th>原因</th></tr>' +
      changes.slice().reverse().map(r => '<tr><td>' + esc(evName(r.event)) + ' <span class="muted small">' + evYm(r.event) + '</span></td><td>' + catName(r.cat) + '</td><td>' + (r.level_before !== r.level_after ? lv(r.level_before) + ' → ' + lv(r.level_after) : lv(r.level_after)) + '</td><td class="small">' + esc(r.note) + '</td></tr>').join('') + '</table></div></div>' +
      '<div class="card"><h2>' + esc(e.name) + '：到場確認的 A 級，公所結論與系統一致的比例</h2><p class="sub">包含甲等 20% 抽查、異議、乙丙等的到場。' + (e.live ? '事件進行中，數字會持續變動。' : '') + '</p>' +
      '<div class="stat"><div><b>' + pct(compTot[0], compTot[1]) + '</b><span>全部（' + cnt(compTot[1]) + ' 件）</span></div></div>' +
      '<table style="margin-top:8px"><tr><th>縣市</th><th class="n">到場的 A 級</th><th class="n">一致</th></tr>' + Object.entries(compC).map(([c, v]) => '<tr><td>' + c + '</td><td class="n">' + cnt(v[1]) + '</td><td class="n">' + pct(v[0], v[1]) + '</td></tr>').join('') + '</table>' +
      (auth() ? '<h3>各鄉鎮' + authBadge + '</h3><div class="scroll tall"><table><tr><th>鄉鎮</th><th class="n">到場的 A 級</th><th class="n">一致</th></tr>' +
        Object.entries(e.comparison).sort((a, b) => (a[1][0] / a[1][1]) - (b[1][0] / b[1][1])).map(([k, v]) => '<tr><td>' + esc(k.replace('|', ' ')) + '</td><td class="n">' + v[1] + '</td><td class="n" style="color:' + (v[0] / v[1] < 0.95 ? 'var(--red)' : 'inherit') + '">' + pct(v[0], v[1]) + '</td></tr>').join('') + '</table></div><p class="small muted">一致率偏低的公所，可能是系統在該地的作物或地形上表現較差，也可能是現勘標準不一，兩者都值得追查。</p>' : '') +
      '</div></div>';
    $('#main').innerHTML = '<div class="card" style="margin-bottom:16px">' + eventBar() + '<p class="small muted" style="margin:0">等級與歷次下界是跨場資料，與上方選的事件無關；下方右側的一致比例依所選事件。</p></div>' + html;
    bindEventBar($('#main'));
    $$('[data-cat]').forEach(r => r.addEventListener('click', () => { S.cat = r.dataset.cat; accuracy(); }));
  }

  // ------------------------------------------------------------------ 時效與爭議
  function timeliness() {
    const e = ev();
    const done = !e.live;
    const med = a => a.length ? a[Math.floor(a.length / 2)] : null;
    let byC = {};
    const ds = Math.min(e.T, e.stages.survey_end);
    for (const k of townsOf(e)) { const c = k.split('|')[0]; byC[c] = byC[c] || [0, 0]; byC[c][0] += val(OV.series[e.id][k].done, ds); byC[c][1] += val(OV.series[e.id][k].applied, ds); }
    const obj = Object.entries(e.objections);
    const html = '<div class="card" style="margin-bottom:16px">' + eventBar() + '</div>' +
      '<div class="grid g2"><div class="card"><h2>從災害到撥款的天數</h2><p class="sub">甲等 A 達標走自動申報、書面審核，可分批層報；其他案件要等勘查期結束後一起層報。</p>' +
      (done ? '<div class="stat" style="margin-bottom:8px"><div><b>' + med(e.days_auto) + ' 天</b><span>自動申報（中位數，' + cnt(e.days_auto.length) + ' 件）</span></div><div><b>' + med(e.days_other) + ' 天</b><span>其他途徑（中位數，' + cnt(e.days_other.length) + ' 件）</span></div><div><b>58 天</b><span>現行須現勘案件的參考值</span></div></div>' +
        histogram([{ name: '自動申報＋書面審核', color: 'var(--g-a)', values: e.days_auto }, { name: '到場、補件等其他途徑', color: 'var(--ink-3)', values: e.days_other }], { bin: 4, max: 76, marks: [{ x: 58, label: '現行參考 58 天', color: 'var(--red)' }, { x: e.stages.survey_end, label: '勘查截止', color: 'var(--ink-3)', dy: 14 }], label: '撥款天數分布' })
        : '<div class="empty">事件進行中，尚無撥款。第一批自動申報案件預計在第 ' + (Math.min(...OV.authorized[e.id].filter(c => c.path === '自動申報＋書面審核').map(c => c.applied)) + 17) + ' 天前後撥款。</div>') + '</div>' +
      '<div class="card"><h2>勘查期限內完成的比例</h2><p class="sub">第 ' + ds + ' 天（' + (e.T >= e.stages.survey_end ? '勘查截止日' : '今天') + '）為止，已完成審核、通知或到場的比例。</p>' +
      '<table><tr><th>縣市</th><th class="n">申請</th><th class="n">已完成</th><th></th></tr>' + Object.entries(byC).map(([c, v]) => '<tr><td>' + c + '</td><td class="n">' + cnt(v[1]) + '</td><td class="n">' + pct(v[0], v[1]) + '</td><td style="width:40%"><div style="height:8px;background:var(--line-2);border-radius:4px"><div style="height:8px;border-radius:4px;background:var(--blue);width:' + (v[1] ? v[0] / v[1] * 100 : 0) + '%"></div></div></td></tr>').join('') + '</table></div></div>' +
      '<div class="grid g2e" style="margin-top:16px"><div class="card"><h2>異議與申復</h2><p class="sub">自動申報的結果，農民認為估低或公所認為估高都可以提出異議，改排到場；A 未達標的通知，農民可補件或申復。</p>' +
      (obj.length ? '<table><tr><th>提出方</th><th>結果</th><th class="n">件數</th></tr>' + obj.map(([k, v]) => { const [a, b] = k.split('｜'); return '<tr><td>' + esc(a) + '</td><td>' + esc(b || '處理中') + '</td><td class="n">' + cnt(v) + '</td></tr>'; }).join('') + '</table>' : '<p class="muted">本場沒有甲等類別的自動申報，或尚無異議。</p>') +
      '<p>A 未達標的申復：<b>' + cnt(e.appeals) + '</b> 件</p></div>' +
      '<div class="card"><h2>縣市政府抽查</h2><p class="sub">依公所申請戶數抽查：未達 100 戶至少 5 戶（10 戶以下抽半數）、100 至未達 500 戶抽 5%、500 至未達 1,500 戶至少 25 戶、1,500 戶以上至少 30 戶；符合率 90% 為合格。抽查由救助系統隨機抽選，天相星的分級只作參考。</p>' +
      (e.county_checks.length ? '<div class="scroll tall"><table><tr><th>公所</th><th class="n">申請戶數</th><th class="n">抽查</th><th class="n">符合率</th><th></th></tr>' + e.county_checks.map(c => '<tr><td>' + esc(c.county + ' ' + c.town) + '</td><td class="n">' + cnt(c.households) + '</td><td class="n">' + c.sampled + '</td><td class="n">' + (c.rate * 100).toFixed(0) + '%</td><td>' + (c.rate >= 0.9 ? chip('合格', 'ok') : chip('未達 90%', 'bad')) + '</td></tr>').join('') + '</table></div>' : '<p class="muted">勘查期尚未結束，縣府抽查還沒開始。</p>') + '</div></div>';
    $('#main').innerHTML = html;
    bindEventBar($('#main'));
  }

  // ------------------------------------------------------------------ 查驗
  const canon = o => {
    if (o === null || typeof o !== 'object') return JSON.stringify(o);
    if (Array.isArray(o)) return '[' + o.map(canon).join(',') + ']';
    return '{' + Object.keys(o).sort().map(k => JSON.stringify(k) + ':' + canon(o[k])).join(',') + '}';
  };
  const hex = b => Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('');
  const unhex = s => new Uint8Array(s.match(/../g).map(x => parseInt(x, 16)));
  async function sha(data) { return hex(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? new TextEncoder().encode(data) : data)); }
  async function shaPair(a, b) { const u = new Uint8Array(64); u.set(unhex(a), 0); u.set(unhex(b), 32); return sha(u); }
  const codeMap = (() => { const m = new Map(); OV.codes.forEach(s => { const [rid, h, b, st] = s.split('|'); m.set(rid, { h, b: +b, st }); }); return m; })();

  function verify() {
    const v = S.verify;
    const html = '<div class="grid g2"><div class="grid" style="align-content:start"><div class="card"><h2>查驗碼查詢</h2><p class="sub">輸入報告上的查驗碼。這裡只回答「這份報告有沒有簽發過、目前是否有效、屬於哪一批」，不顯示報告內容。</p>' +
      '<div class="row"><input type="text" id="code" style="flex:1;min-width:14em" placeholder="例如 ' + esc(OV.samples[0].code) + '" aria-label="查驗碼"><button class="btn primary" id="lookup">查詢</button></div><div id="lookupOut" style="margin-top:10px"></div></div>' +
      '<div class="card"><h2>批次根公告</h2><p class="sub">每一批報告算出一個 Merkle 根並公告；每筆公告也記下前一筆的雜湊，事後抽換、刪除或補入任何一批都會被發現。共 ' + OV.batches.length + ' 批（' + esc(ev().name) + '）。</p>' +
      '<div class="row" style="margin-bottom:8px"><button class="btn" id="chain">查驗整條公告鏈</button><span id="chainOut" class="small"></span></div>' +
      '<div class="scroll tall"><table class="small"><tr><th>批次</th><th>鄉鎮</th><th>公告時間</th><th class="n">份數</th><th>Merkle 根</th></tr>' +
      OV.batches.slice().reverse().slice(0, 80).map(b => '<tr><td class="mono">' + b.batch_id + '</td><td>' + esc(b.town) + '</td><td>' + b.issued_at.slice(0, 16).replace('T', ' ') + '</td><td class="n">' + b.count + '</td><td class="mono">' + b.root.slice(0, 20) + '…</td></tr>').join('') + '</table></div><p class="small muted">顯示最新 80 批。</p></div></div>' +
      '<div class="card"><h2>驗證我手上的報告</h2><p class="sub">農民、法院或審計人員持有完整報告時，可在這裡驗證它沒被改過、確實由資料中心簽發、並包含在公告的批次裡。全部在瀏覽器裡計算，不上傳。</p>' +
      '<div class="row" style="margin-bottom:8px">' + (OPS ? '' : '<label class="small">範例報告 <select id="sample">' + OV.samples.map((s, i) => '<option value="' + i + '"' + (i === v.sample ? ' selected' : '') + '>' + (i + 1) + '. ' + esc(s.town + ' ' + s.grade) + '</option>').join('') + '</select></label>' +
      '<label class="small"><input type="checkbox" id="tamper"' + (v.tamper ? ' checked' : '') + '> 模擬被改過（把損失中位數改掉）</label>') + '<label class="btn small" style="cursor:pointer">讀取報告檔<input type="file" id="file" accept=".json,application/json" hidden></label>' + (OPS ? '<span class="small muted">或把報告內容貼在下方</span>' : '') + '</div>' +
      '<textarea id="rep" aria-label="報告內容（JSON）"></textarea><div class="row" style="margin-top:8px"><button class="btn primary" id="go">驗證</button><span class="small muted">公開金鑰：<span class="mono">' + OV.public_key.slice(0, 24) + '…</span>（示範金鑰）</span></div>' +
      '<ol class="steps" id="steps" style="margin-top:10px"></ol></div></div>';
    $('#main').innerHTML = html;
    const fill = () => {
      const s = JSON.parse(JSON.stringify(OV.samples_inline[v.sample]));
      if (v.tamper) { if (s.report.loss_pct) s.report.loss_pct.p50 += 9; else s.report.grade = 'A達標'; }
      $('#rep').value = JSON.stringify(s, null, 1);
      $('#steps').innerHTML = '';
    };
    if (!OPS) {
      fill();
      $('#sample').addEventListener('change', x => { v.sample = +x.target.value; fill(); });
      $('#tamper').addEventListener('change', x => { v.tamper = x.target.checked; fill(); });
    }
    $('#file').addEventListener('change', x => { const f = x.target.files[0]; if (!f) return; f.text().then(t => { $('#rep').value = t; $('#steps').innerHTML = ''; }); });
    $('#go').addEventListener('click', runVerify);
    $('#lookup').addEventListener('click', lookup);
    $('#code').addEventListener('keydown', x => { if (x.key === 'Enter') lookup(); });
    $('#chain').addEventListener('click', checkChain);
  }
  function lookup() {
    const code = $('#code').value.trim();
    const out = $('#lookupOut');
    const m = code.match(/^(.+)-([0-9a-f]{16})$/i);
    if (!m) { out.innerHTML = chip('格式不對', 'bad') + ' <span class="small muted">查驗碼是「報告編號-16 碼雜湊」。</span>'; return; }
    const rec = codeMap.get(m[1]);
    if (!rec) { out.innerHTML = chip('查無此報告', 'bad'); return; }
    if (rec.h !== m[2].toLowerCase()) { out.innerHTML = chip('雜湊不符', 'bad') + ' <span class="small">報告編號存在，但後 16 碼對不上：手上的報告可能被改過，或查驗碼抄錯。</span>'; return; }
    const b = OV.batches[rec.b - 1];
    out.innerHTML = (rec.st === 'V' ? chip('有效', 'ok') : chip('已由補件後的新版取代', 'warn')) + '<table style="margin-top:6px"><tr><td>報告編號</td><td class="mono">' + esc(m[1]) + '</td></tr><tr><td>批次</td><td class="mono">' + b.batch_id + '</td></tr><tr><td>簽發地點</td><td>' + esc(b.town) + '</td></tr><tr><td>簽發時間</td><td>' + b.issued_at.replace('T', ' ').slice(0, 16) + '</td></tr><tr><td>批次根</td><td class="mono">' + b.root + '</td></tr></table>' +
      (rec.st !== 'V' ? '<p class="small">這份報告因補件後重新檢核，已有新版。舊版仍保留，可查驗，但以新版為準。</p>' : '');
  }
  async function checkChain() {
    const out = $('#chainOut');
    if (!(window.crypto && crypto.subtle)) { out.innerHTML = chip('此瀏覽器不能計算雜湊', 'warn'); return; }
    let prev = '0'.repeat(64);
    for (const b of OV.batches) {
      const rec = { batch_id: b.batch_id, town: b.town, issued_at: b.issued_at, count: b.count, root: b.root, prev };
      const h = await sha(canon(rec));
      if (b.prev !== prev || h !== b.hash) { out.innerHTML = chip('在 ' + b.batch_id + ' 斷開', 'bad'); return; }
      prev = h;
    }
    out.innerHTML = chip('完整：' + OV.batches.length + ' 批全部接得起來', 'ok') + ' <span class="mono">' + prev.slice(0, 16) + '…</span>';
  }
  async function runVerify() {
    const st = $('#steps');
    const li = (cls, t, d) => '<li class="' + cls + '"><b>' + t + '</b><div class="small">' + d + '</div></li>';
    let obj;
    try { obj = JSON.parse($('#rep').value); } catch (e) { st.innerHTML = li('bad', '讀不到報告', '內容不是有效的 JSON。'); return; }
    if (!(window.crypto && crypto.subtle)) { st.innerHTML = li('na', '此瀏覽器不能計算雜湊', '請改用 tools/verify.py。'); return; }
    const out = [];
    const h = await sha(canon(obj.report));
    const code = obj.verify_code || '';
    const okCode = code.endsWith('-' + h.slice(0, 16));
    out.push(li(okCode ? 'ok' : 'bad', '內容雜湊與查驗碼', '重新計算的 SHA-256：<span class="mono">' + h + '</span><br>' + (okCode ? '前 16 碼與查驗碼相符。' : '與查驗碼 <span class="mono">' + esc(code) + '</span> 不符：內容和簽發時不一樣。')));
    let sigOk = null;
    try {
      const key = await crypto.subtle.importKey('raw', unhex(obj.public_key), { name: 'Ed25519' }, false, ['verify']);
      sigOk = await crypto.subtle.verify({ name: 'Ed25519' }, key, unhex(obj.signature), new TextEncoder().encode(canon(obj.report)));
    } catch (e) { sigOk = null; }
    const keyMatch = obj.public_key === OV.public_key;
    out.push(sigOk == null ? li('na', '數位簽章', '這個瀏覽器不支援 Ed25519 驗章（新版 Chrome、Edge、Firefox、Safari 都支援），請改用 tools/verify.py。') :
      li(sigOk && keyMatch ? 'ok' : 'bad', '數位簽章', sigOk ? (keyMatch ? '以公告的公開金鑰驗證通過：報告由資料中心簽發。' : '簽章本身成立，但用的不是公告的公開金鑰。') : '驗證失敗：報告內容在簽發後被改過，或簽章不是資料中心的。'));
    let x = h;
    for (const p of obj.merkle_proof || []) x = p.side === 'L' ? await shaPair(p.hash, x) : await shaPair(x, p.hash);
    const b = OV.batches.find(q => q.root === x);
    out.push(li(b ? 'ok' : 'bad', '包含在公告的批次裡', '由報告雜湊與 ' + (obj.merkle_proof || []).length + ' 個相鄰雜湊算出根：<span class="mono">' + x.slice(0, 24) + '…</span><br>' + (b ? '與公告的 ' + b.batch_id + '（' + esc(b.town) + '，' + b.issued_at.slice(0, 10) + '）相符。' : '公告清單裡沒有這個根：報告被改過，或不屬於任何公告的批次。')));
    const rid = obj.report && obj.report.report_id;
    const rec = rid && codeMap.get(rid);
    out.push(li(rec ? (rec.st === 'V' ? 'ok' : 'na') : 'bad', '目前狀態', rec ? (rec.st === 'V' ? '有效。' : '已由補件後的新版取代，以新版為準。') : '查無此報告編號。'));
    st.innerHTML = out.join('');
  }

  // ------------------------------------------------------------------ 資料與方法
  function method() {
    const e = ev();
    $('#main').innerHTML = '<div class="grid g2e"><div class="card prose"><h2>這個頁面給誰看、看什麼</h2>' +
      '<p>給監察委員、立法委員、法院與一般民眾，在不接觸個資的前提下，看到衛星分級在每一場災害裡實際做了什麼：多少案件由系統直接判定、多少交給公所到場、判得準不準、有沒有拖延、等級為什麼升降，以及任何一份報告是否被改過。</p>' +
      '<p>這裡不檢查模型本身（輸入特徵、參數、程式版本）；那屬於審計重算，要用報告記載的產品編號與程式版本另外重算。</p>' +
      '<h3>兩種檢視</h3><ul><li><b>公眾版</b>：統計最小到鄉鎮市區；1–4 件以「<5」顯示；影像判讀只到 500 公尺網格。</li><li><b>授權監察版</b>：多看去識別案件明細（無姓名、完整地號、帳戶）、各鄉鎮系統與公所判定的一致率、像素層級的植生異常。正式系統以機關憑證登入，每次查詢留存紀錄。</li></ul>' +
      '<h3>指標定義</h3><ul><li><b>系統可直接判定</b>：A 達標＋A 未達標占申請件數。只有甲等類別會真的用來免到場。</li><li><b>精確度下界</b>：判為 A 達標（或 A 未達標）的案件中，到場確認結果一致的比例，取 Clopper–Pearson 95% 單側下界，跨場累計。</li><li><b>從災害到撥款的天數</b>：以災害發生日起算。現行參考 58 天為須現勘案件的平均。</li><li><b>勘查期限內完成</b>：公告翌日起 30 日內完成審核、通知或到場。</li></ul>' +
      '<h3>影像判讀（影像比對頁）</h3><ul><li>光學：Sentinel-2 L2A 真彩色與 NDVI；只用災前、災後、去年同期四期都無雲（場景分類為植生或裸地等）的像素。疑似受損＝今年災前到災後的 NDVI 變化，比去年同一時段多降 0.15 以上。</li><li>雷達：Sentinel-1 RTC VV，3×3 中值濾波；疑似積水＝低於 −15 dB 且比災前中位數低 3 dB 以上，排除災前多數期都是水的常年水體。</li><li>這是公開頁的簡化版；正式分級用三種方法投票、逐坵塊計算，並經五項證據檢核。</li></ul></div>' +
      '<div class="grid" style="align-content:start"><div class="card"><h2>下載</h2><p class="sub">' + esc(e.name) + '，第 ' + (S.day == null ? e.T : Math.min(S.day, e.T)) + ' 天，鄉鎮層級。</p><div class="row"><button class="btn" id="csv">下載鄉鎮統計 CSV</button><a class="btn" href="data/public_key.txt" download>公開金鑰</a>' +
      OV.samples.slice(0, 3).map((s, i) => '<a class="btn" href="' + s.file + '" download>範例報告 ' + (i + 1) + '</a>').join('') + '</div><p class="small muted" style="margin-top:8px">離線驗證：<span class="mono">python tools/verify.py 報告.json</span></p></div>' +
      (OPS ? '<div class="card"><h2>授權查詢紀錄</h2><p class="sub">實操模式下，授權監察版的登入與每次瀏覽都記錄（機關、承辦、目的、時間）。正式系統存於伺服器並可受稽核。</p><div class="scroll tall"><table class="small"><tr><th>時間</th><th>機關</th><th>承辦</th><th>目的</th><th>內容</th></tr>' + accessLog().slice().reverse().map(l => '<tr><td>' + esc(l.at.replace('T', ' ').slice(0, 16)) + '</td><td>' + esc(l.agency) + '</td><td>' + esc(l.officer) + '</td><td>' + esc(l.purpose) + '</td><td>' + esc(l.what) + '</td></tr>').join('') + '</table></div></div>' : '') +
      '<div class="card prose"><h2>測試資料說明</h2><p>事件名稱、申請件數、分級、處理、撥款、等級、批次與報告全部是模擬產生的測試資料，金額以每公頃示意單價計算，不代表任何實際災害或救助。</p><p>「影像比對」用的是 2025 年丹娜絲颱風前後的真實 Sentinel-1／2 影像；網格與面積是本頁的簡化計算，不是核定結果。</p><p>簽章用的是示範金鑰，正式系統由憑證機構簽發，金鑰保存在硬體安全模組，並取得 RFC 3161 時戳。</p></div></div></div>';
    $('#csv').addEventListener('click', () => {
      const t = S.day == null ? e.T : Math.min(S.day, e.T);
      const keys = ['applied', 'A達標', 'A未達標', 'B邊緣', 'C缺失', 'done', 'field', 'supp_open', 'drone', 'objection', 'appeal', 'paid'];
      const lines = [['縣市', '鄉鎮市區'].concat(keys).join(',')];
      for (const k of townsOf(e)) lines.push(k.split('|').concat(keys.map(x => { const v = Math.round(val(OV.series[e.id][k][x], t)); return !auth() && v > 0 && v < 5 ? '<5' : v; })).join(','));
      const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = e.id + '_day' + t + '_鄉鎮統計.csv'; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
  }

  // ------------------------------------------------------------------ 即時更新（進行中事件）
  setInterval(() => {
    const e = ev();
    if (!e.live || route() !== 'overview' || S.playing || S.day !== e.T) { tickUpdated(); return; }
    const before = $('#kpis') && $('#kpis').innerText;
    overview();
    if ($('#kpis') && before !== $('#kpis').innerText) $$('#kpis .kpi').forEach(k => k.classList.add('flash'));
  }, 30000);

  function render() {
    if (OPS && auth()) { const se = session(); accessLog({ at: new Date().toISOString(), agency: se.agency, officer: se.officer, purpose: se.purpose, what: '瀏覽 ' + (ROUTES.find(r => r[0] === route()) || [])[1] + '（' + ev().name + '）' }); }
    nav();
    stopIm();
    const r = route();
    ({ overview, imagery, accuracy, time: timeliness, verify, method })[r]();
  }
  render();
})();
