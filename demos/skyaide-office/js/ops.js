/*
 * 天相星：實操模式的資料與規則
 *
 * 公所端、現勘手機、農民端共用同一份資料（瀏覽器本機，key：skyaide.ops.state.v1）。
 * 每一個寫入動作都先檢查：誰可以做、現在能不能做（期限）、前一步做完沒有；不符合就拒絕並說明原因。
 * 時間一律用真實時鐘；資料一進來（送件、補件、無人機回傳、現勘回傳）流程就往前推，不需要後台。
 *
 * 起始資料取自測試資料庫（js/testdb.js）的同一場颱風：公告日為 12 天前，申請期快結束、勘查期進行中。
 */
window.SA = window.SA || {};

SA.ops = (function () {
  const KEY = 'skyaide.ops.state.v1';
  const T = () => SA.testdb;
  const R = () => SA.rules;
  const CFG = () => SA.config;
  const now = () => new Date();
  const iso = (d) => new Date(d).toISOString();
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const eod = (d) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };
  const ymd = (d) => { const x = new Date(d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
  const fmtD = (d) => SA.ui ? SA.ui.date(d, true) : ymd(d);

  class OpsError extends Error {}
  const fail = (msg) => { throw new OpsError(msg); };

  // ------------------------------------------------------------------ 儲存
  let lastRaw = null, lastObj = null, seeding = null;
  function read() {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { raw = null; }
    if (raw === lastRaw) return lastObj;
    lastRaw = raw; lastObj = raw ? JSON.parse(raw) : null;
    return lastObj;
  }
  function write(s) {
    s.rev = (s.rev || 0) + 1;
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { fail('瀏覽器儲存空間不足，動作沒有存下來'); }
    lastRaw = null;
  }
  // 讀取用（快取）；寫入用 dbw()（每次重新讀一份，動作失敗時不會留下半套的變更）
  function db() {
    if (seeding) return seeding;
    if (read()) return read();
    try { const n = seed(); seeding = null; write(n); } finally { seeding = null; }
    return read();
  }
  function dbw() { if (seeding) return seeding; db(); return JSON.parse(localStorage.getItem(KEY)); }
  function stOf(s, id) { return (s.cases[id] = s.cases[id] || {}); }
  function log(s, actor, action, id, detail) { s.log.push({ at: iso(now()), actor, action, id: id || null, detail: detail || '' }); }
  function commit(s, actor, action, id, detail) { log(s, actor, action, id, detail); write(s); }

  // ------------------------------------------------------------------ 事件與期限
  const event = () => T().listEvents()[0];
  const dl = () => R().deadlines(event().announceDate);

  // ------------------------------------------------------------------ 案件：測試資料庫的原始判讀 ＋ 實操過程中的變化
  function baseList() {
    const s = db();
    return T().listCases().concat(Object.values(s.newCases || {}).map((c) => clone(c)));
  }
  function baseFull(id) {
    const s = db();
    if (s.newCases && s.newCases[id]) return clone(s.newCases[id]);
    return T().getCase(id);
  }
  function suppState(st) {
    if (!st.supp) return 'none';
    if (st.supp.state === 'received') return st.supp.result === 'still' ? 'insufficient' : 'received';
    if (now() > eod(st.supp.due)) return 'expired';
    return 'pending';
  }
  function project(c) {
    if (!c) return c;
    const s = db();
    const st = s.cases[c.id] || {};
    if (st.over) Object.assign(c, clone(st.over));
    c.reasons = R().reasonCodes(c.checks);
    c.grade = R().grade(c);
    c.supplementState = suppState(st);
    c.appeal = !!st.objection;
    c.filed = st.filed || null;
    c.accepted = st.accepted || null;
    c.decision = st.decision || null;
    c.fieldRecord = st.field || null;
    c.visit = st.visit || null;
    c.review = st.review || null;
    c.notices = st.notices || {};
    if (c.filed && c.filed.by !== 'auto') c.declaredRate = c.filed.declaredRate;
    return c;
  }
  const isAuto = (c) => c.level === '甲' && (c.grade === 'A_MET' || c.grade === 'A_NOT_MET');
  const allCases = () => baseList().map(project);
  const filedCases = () => allCases().filter((c) => c.filed);
  function getCase(id) { return project(baseFull(id)); }

  // ------------------------------------------------------------------ 重新檢核（補件、無人機回傳）
  const PHOTO_CLEARS = ['像素不足', '雲遮', '樹冠遮蔽或網室'];
  const PHOTO_NOTE_CLEARS = ['來源不一致', '疑似灌溉', 'L3 損失時點'];
  function recheck(s, id, cleared, source) {
    const c = getCase(id);
    const st = stOf(s, id);
    const checks = clone(c.checks);
    Object.keys(checks).forEach((k) => {
      const ck = checks[k];
      if (ck.pass === false && (ck.reasons || []).every((r) => cleared.includes(r))) {
        ck.pass = true; ck.reasons = [];
        ck.detail = (ck.detail || '') + '（' + source + '後重新檢核通過）';
        if (k === 'production' && ck.longterm) Object.keys(ck.longterm).forEach((l) => { ck.longterm[l] = true; });
      }
    });
    st.over = Object.assign({}, st.over, { checks });
    const after = R().grade(Object.assign({}, c, { checks }));
    st.rechecks = (st.rechecks || []).concat([{ at: iso(now()), source, cleared, grade: after }]);
    return after;
  }

  // ------------------------------------------------------------------ 起始資料
  function seed() {
    let x = 20261026;
    const rnd = () => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff; };
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const E = event();
    const A = R().parseDate(E.announceDate);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const span = Math.max(1, R().daysBetween(A, today));
    const at = (day, hh) => { const d = new Date(A); d.setDate(d.getDate() + Math.min(day, span)); d.setHours(hh || 9, Math.floor(rnd() * 50), 0, 0); return d > now() ? iso(now()) : iso(d); };
    const due = (day) => ymd(R().addDays(A, day));
    const s = { v: 1, seededAt: iso(now()), cases: {}, newCases: {}, baseline: {}, registered: [], drone: {}, capacity: { droneCases: 4, personDays: 6, perPersonDay: 10 }, route: null, batch: null, reports: {}, log: [] };
    seeding = s;
    const farmerIds = new Set();
    const farmerOf = {};
    T().listFarmers().forEach((f) => T().listFarmerCases(f.id).forEach((c) => { farmerIds.add(c.id); farmerOf[c.id] = f.id; }));
    const list = T().listCases();
    list.forEach((c) => {
      const st = stOf(s, c.id);
      const full = T().getCase(c.id);
      const auto = isAuto(c);
      if (auto) { st.filed = { by: 'auto', at: at(1, 9) }; st.accepted = { by: 'system', at: st.filed.at }; if (farmerIds.has(c.id)) return; }
      else if (farmerIds.has(c.id)) {
        if (c.grade === 'C' && c.level !== '丙') { // 陳大明的山坡竹林：已送件、已受理、公所已通知補件
          st.filed = { by: '本人', at: at(3, 10), declaredRate: 45 }; st.accepted = { by: '測試承辦', at: at(4, 10) };
          st.notices = { supplement: { at: at(span - 2, 15), due: due(span + 4) } };
          st.supp = { state: 'requested', at: st.notices.supplement.at, due: st.notices.supplement.due };
        }
        return;
      } else if (rnd() < 0.8) {
        st.filed = { by: pick(['本人', '本人', '農會協助', '委託']), at: at(1 + Math.floor(rnd() * (span - 1)), 10), declaredRate: full.declaredRate };
        if (rnd() < 0.85) st.accepted = { by: '測試承辦', at: at(R().daysBetween(A, new Date(st.filed.at)) + 1, 14) };
      }
      if (!st.filed) return;
      // C 缺失：補件通知
      if (c.grade === 'C' && c.level !== '丙' && rnd() < 0.8) {
        const old = rnd() < 0.45;
        const nAt = old ? at(2, 15) : at(span - 3, 15);
        st.notices = Object.assign({}, st.notices, { supplement: { at: nAt, due: old ? due(9) : due(span + 4) } });
        st.supp = { state: 'requested', at: nAt, due: st.notices.supplement.due };
        if (!old && rnd() < 0.35) {
          st.supp = Object.assign(st.supp, { state: 'received', receivedAt: at(span - 1, 11), data: { photos: ['遠拍：IMG_0812.jpg', '近拍：IMG_0813.jpg'], note: '田裡沒有灌水，倒伏在東半邊' } });
          const g = recheck(s, c.id, PHOTO_CLEARS.concat(PHOTO_NOTE_CLEARS), '補件');
          st.supp.result = g === 'C' ? 'still' : 'regraded';
        }
      }
      // 甲等 A 未達標：通知、異議
      if (c.level === '甲' && c.grade === 'A_NOT_MET' && !c.sampled && rnd() < 0.6) {
        st.notices = Object.assign({}, st.notices, { notMet: { at: at(3, 16), due: due(10) } });
        if (c.appeal) st.objection = { by: 'farmer', at: at(6, 20), note: '實際倒伏比影像看到的多' };
      }
      // 甲等 A 達標：部分已書面核定
      if (c.level === '甲' && c.grade === 'A_MET' && !c.sampled && rnd() < 0.45) {
        st.decision = { result: 'approve', method: 'paper', cropMatch: true, areaHa: c.areaHa, rate: c.interval.p50, reportHash: full.report.hash, systemGrade: c.grade, level: c.level, at: at(4 + Math.floor(rnd() * (span - 5)), 15), by: '測試承辦' };
      }
      // 已到場的案件
      const visitKind = c.level !== '甲' || c.grade === 'B' || c.sampled;
      if (visitKind && st.accepted && rnd() < 0.3) {
        st.field = { rate: Math.max(0, Math.min(100, Math.round(c._trueLoss + (rnd() - 0.5) * 6))), at: at(5 + Math.floor(rnd() * (span - 6)), 11), by: '測試勘查員', photos: ['遠拍', '近拍'], gnss: { lat: c.center.lat, lon: c.center.lon, accuracy: 5 } };
        if (rnd() < 0.6) {
          const ok = st.field.rate >= 20;
          st.decision = { result: ok ? 'approve' : 'reject', method: c.sampled ? 'sample' : 'survey', cropMatch: true, areaHa: c.areaHa, rate: st.field.rate, rejectReason: ok ? null : 'T1', reportHash: full.report.hash, systemGrade: c.grade, level: c.level, at: st.field.at, by: '測試承辦' };
        }
      }
    });
    s.log.push({ at: iso(now()), actor: '系統', action: '載入演示資料', id: null, detail: E.name + '：公告日 ' + E.announceDate });
    return s;
  }

  // ------------------------------------------------------------------ 工作項目（需要到場或無人機）
  function workItems() {
    const s = db();
    const cases = filedCases().filter((c) => c.accepted && !(c.decision && !(c.review && !c.review.done)) && !(c.fieldRecord && !(c.review && !c.review.done && c.fieldRecord.at < c.review.at)));
    const sup = {}; cases.forEach((c) => { sup[c.id] = c.supplementState === 'none' ? 'pending' : c.supplementState; });
    const ap = {}; cases.forEach((c) => { if (c.appeal) ap[c.id] = true; });
    const items = R().workItems(cases, sup, ap);
    // 復查：重新到場
    cases.filter((c) => c.review && !c.review.done).forEach((c) => { if (!items.find((i) => i.id === c.id)) items.push(Object.assign({}, c, { kind: 'appeal' })); });
    return items;
  }

  // ------------------------------------------------------------------ 判定規則（案件審核頁用）
  function policy(id) {
    const c = getCase(id);
    if (!c) return { block: '找不到案件' };
    const st = db().cases[id] || {};
    const D = dl();
    const t = now();
    const reviewOpen = !!(st.review && !st.review.done);
    if (!st.filed) return { block: '尚未送件：申請人送件後（甲等 A 級由系統自動申報）才能審核。' };
    if (!st.accepted) return { block: '尚未受理：請先在「受理與文件核對」核對文件並受理。' };
    if (st.decision && !reviewOpen) return { block: '本案已判定（' + ({ approve: '核定', reject: '不予救助' })[st.decision.result] + '，' + SA.ui.datetime(st.decision.at) + '）。申請人 7 日內可申請復查。', done: true };
    if (t > eod(D.surveyEnd) && !reviewOpen) return { block: '勘查期已於 ' + fmtD(D.surveyEnd) + ' 截止。' };
    const auto = isAuto(c);
    const fieldOk = !!(st.field && (!reviewOpen || st.field.at > st.review.at));
    const needField = reviewOpen || c.level !== '甲' || c.grade === 'B' || c.grade === 'C' || c.sampled || !!st.objection;
    if (needField) {
      const photos = c.hasApp || !!(st.supp && st.supp.data && (st.supp.data.photos || []).length);
      const methods = [];
      if (fieldOk) methods.push(c.sampled && auto && !st.objection ? 'sample' : 'survey');
      if (photos && !reviewOpen && !(c.sampled && auto) && !st.objection) methods.push('appPhoto');
      const why = reviewOpen ? '申請人申請復查，須重新到場。' : st.objection ? (st.objection.by === 'office' ? '公所提出異議，' : '申請人提出異議，') + '須到場，以公所勘查為準。' : c.sampled && auto ? '本案被抽中 20% 抽查，須到場。' : c.grade === 'C' ? 'C 缺失：補件、無人機或到場後才能判定。' : c.grade === 'B' ? 'B 邊緣須到場確認。' : c.level + '等類別依現行規定勘查。';
      if (!methods.length) return { block: why + '目前還沒有現勘紀錄：請在「補件與無人機 → ② 依量能分配」排入到場，由現勘手機回傳。', needVisit: true };
      return { methods, fieldRate: fieldOk ? st.field.rate : null, why, review: reviewOpen };
    }
    if (c.grade === 'A_MET') return { methods: ['paper'], fixedRate: c.interval.p50, canObject: true, why: '甲等 A 達標，系統已自動申報；書面審核。' };
    if (c.grade === 'A_NOT_MET') {
      if (!(st.notices && st.notices.notMet)) return { block: 'A 未達標：先送出 A 未達標通知（附影像日期與理由），申請人可在期限內補件或提出異議。', needNotMet: true, canObject: true };
      if (t <= eod(st.notices.notMet.due)) return { block: '已於 ' + SA.ui.datetime(st.notices.notMet.at) + ' 通知，' + fmtD(st.notices.notMet.due) + ' 前申請人可補件或提出異議；期限過後才能判定。', canObject: true };
      return { methods: ['paper'], rejectOnly: true, fixedRate: c.interval.p50, why: '通知期限已過，申請人未提出異議。' };
    }
    return { block: '分級資料不完整' };
  }

  // ------------------------------------------------------------------ 寫入動作
  const W = {};

  // 農民：送件（甲等 A 級由系統自動申報，不經此步）
  W.submitApplication = (id, payload) => {
    const s = dbw(); const D = dl(); const t = now();
    if (t < D.announce) fail('還沒有救助公告，不能送件');
    if (t > eod(D.applyEnd)) fail('申請期已於 ' + fmtD(D.applyEnd) + ' 截止，逾期不受理');
    // 主動通知的田（還沒有案件）：甲等受損明顯，確認後由系統自動申報
    const f = unappliedField(id);
    if (f) {
      if (s.newCases['N-' + f.id]) fail('這塊田已經申請');
      const tmpl = T().getCase('T0001');
      const nc = Object.assign(clone(tmpl), {
        id: 'N-' + f.id, caseNo: 'T-01-09' + String(Object.keys(s.newCases).length + 1).padStart(2, '0'), landNo: f.landNo, crop: f.crop, areaHa: f.areaHa,
        center: f.center, geometry: f.geometry, interval: { p10: 44, p50: 55, p90: 66 }, applicant: tmpl.applicant, farmerId: f.farmerId, sampled: false, appeal: false, hasApp: false, fromField: f.id
      });
      nc.report = Object.assign({}, nc.report, { no: 'SKY-TEST-N' + f.id, verifyCode: 'SKY-TEST-N' + f.id + '-' + T().fakeHash(f.id).slice(0, 16) });
      nc.provenance = Object.assign({}, nc.provenance, { mapping: f.landNo + ' ↔ 坵塊 N-' + f.id + ' ↔ ' + nc.caseNo });
      s.newCases[nc.id] = nc;
      const st = stOf(s, nc.id);
      st.filed = { by: 'auto', at: iso(t), confirmedBy: 'farmer' };
      st.accepted = { by: 'system', at: iso(t) };
      commit(s, '農民', '確認申請（主動通知的田，系統自動申報）', nc.id, f.landNo);
      return { ok: true, caseId: nc.id, caseNo: nc.caseNo };
    }
    const c = getCase(id);
    if (!c) fail('找不到案件');
    const st = stOf(s, id);
    if (st.filed) fail('這筆已經送件');
    if (isAuto(c)) fail('這筆由系統依存證報告自動申報，不必自行送件');
    const r = payload && payload.declaredRate;
    if (typeof r !== 'number' || r < 0 || r > 100) fail('受災率須介於 0–100%');
    st.filed = { by: payload.by || '本人', at: iso(t), declaredRate: r };
    commit(s, '農民', '送件', id, '申報受災率 ' + r + '%');
    return { ok: true, caseNo: c.caseNo };
  };

  // 公所：受理
  W.acceptApplication = (id, docs) => {
    const s = dbw(); const st = stOf(s, id); const D = dl();
    if (!st.filed) fail('申請人尚未送件，不能受理');
    if (st.accepted) fail('已受理');
    if (new Date(st.filed.at) > eod(D.applyEnd)) fail('送件時間晚於申請截止日，逾期不受理');
    const need = CFG().requiredDocs.filter((d) => !d.optional && !(d.canWaive && docs[d.key] === '免附') && docs[d.key] !== '已附');
    if (need.length) fail('尚有必附文件未確認：' + need.map((d) => d.label.replace(/（.*/, '')).join('、'));
    st.accepted = { by: '測試承辦', at: iso(now()), docs };
    commit(s, '公所', '受理', id);
    return { ok: true };
  };

  // 公所：通知（補件、A 未達標）
  W.sendNotice = (ids, kind, content) => {
    const s = dbw(); const D = dl(); const t = now();
    const done = [];
    const skipped = [];
    (ids || []).forEach((id) => {
      const c = getCase(id); const st = stOf(s, id);
      if (!c) { skipped.push(id + '：找不到'); return; }
      if (!st.filed) { skipped.push(c.caseNo + '：尚未送件'); return; }
      let due = content && content.due ? content.due : ymd(R().addDays(t, 7) < D.surveyEnd ? R().addDays(t, 7) : D.surveyEnd);
      if (new Date(due + 'T00:00:00') > D.surveyEnd) { skipped.push(c.caseNo + '：期限不得晚於勘查截止日'); return; }
      if (eod(due) < R().addDays(t, 2)) { skipped.push(c.caseNo + '：期限至少要給 3 天'); return; }
      if (kind === 'supplement') {
        if (c.grade !== 'C' || c.level === '丙') { skipped.push(c.caseNo + '：不是需要補件的 C 缺失案件'); return; }
        if (st.supp) { skipped.push(c.caseNo + '：已通知過'); return; }
        st.notices = Object.assign({}, st.notices, { supplement: { at: iso(t), due, reasons: c.reasons } });
        st.supp = { state: 'requested', at: iso(t), due };
      } else if (kind === 'notMet') {
        if (!(c.level === '甲' && c.grade === 'A_NOT_MET')) { skipped.push(c.caseNo + '：不是甲等 A 未達標'); return; }
        if (st.notices && st.notices.notMet) { skipped.push(c.caseNo + '：已通知過'); return; }
        st.notices = Object.assign({}, st.notices, { notMet: { at: iso(t), due } });
      } else { skipped.push(c.caseNo + '：此類通知在實操模式不提供'); return; }
      done.push(c.caseNo);
    });
    if (!done.length) fail(skipped.join('；') || '沒有可通知的案件');
    commit(s, '公所', kind === 'supplement' ? '補件通知' : 'A 未達標通知', done.join('、'));
    return { ok: true, sent: done.length, skipped };
  };

  W.setSupplementState = () => fail('實操模式下，補件狀態由申請人補件或期限自動決定，不能手動更改');

  // 農民：補件 → 重新檢核
  W.uploadSupplement = (id, payload) => {
    const s = dbw(); const st = stOf(s, id); const c = getCase(id);
    if (!st.supp) fail('公所尚未通知補件；收到補件通知後才能補件');
    const ss = suppState(st);
    if (ss === 'expired') fail('補件期限 ' + fmtD(st.supp.due) + ' 已過，公所會依人力安排無人機或到場');
    if (ss !== 'pending') fail('已經補件');
    const photos = (payload.photos || []);
    if (!photos.length && !payload.crop && !payload.note) fail('請至少上傳照片、更正作物或填寫說明');
    const cleared = [];
    if (photos.length >= 2) PHOTO_CLEARS.forEach((r) => cleared.push(r));
    if (photos.length >= 1 && payload.note) PHOTO_NOTE_CLEARS.forEach((r) => cleared.push(r));
    st.supp = Object.assign(st.supp, { state: 'received', receivedAt: iso(now()), data: payload });
    const g = recheck(s, id, cleared, '補件');
    st.supp.result = g === 'C' ? 'still' : 'regraded';
    commit(s, '農民', '補件', id, g === 'C' ? '重新檢核後仍不足：' + R().reasonCodes(st.over.checks).join('、') : '重新檢核後改列 ' + CFG().grades[g].label);
    return { ok: true, grade: g, still: g === 'C' };
  };

  // 農民或公所：異議（甲等 A 級自動申報）
  W.appeal = (id, kind, payload) => {
    const s = dbw(); const st = stOf(s, id); const c = getCase(id); const t = now(); const D = dl();
    if (kind === 'objection') {
      if (!isAuto(c)) fail('只有甲等 A 級自動申報的案件可以提出異議');
      if (st.decision) fail('已核定，請改申請復查');
      if (st.objection) fail('已提出過異議');
      if (t > eod(D.surveyEnd)) fail('勘查期已截止');
      if (c.grade === 'A_NOT_MET' && st.notices && st.notices.notMet && t > eod(st.notices.notMet.due)) fail('通知所附的異議期限 ' + fmtD(st.notices.notMet.due) + ' 已過');
      st.objection = { by: 'farmer', at: iso(t), note: (payload && payload.note) || '' };
      commit(s, '農民', '提出異議', id, st.objection.note);
      return { ok: true };
    }
    if (kind === 'review') {
      if (!st.decision) fail('公所還沒有判定，不能申請復查');
      if (st.review) fail('已申請過復查');
      if (t > eod(R().addDays(new Date(st.decision.at), CFG().deadlines.appealDays))) fail('已超過收到通知後 7 日的復查期限');
      st.review = { at: iso(t), done: false };
      commit(s, '農民', '申請復查', id);
      return { ok: true };
    }
    fail('不支援的申請');
  };

  // 公所：改排到場（甲等 A 級＝公所異議）
  W.scheduleVisit = (id, reason) => {
    if (String(id).startsWith('baseline:')) return W.baselineVisit(String(id).slice(9));
    const s = dbw(); const st = stOf(s, id); const c = getCase(id);
    if (!c) fail('找不到案件');
    if (!st.accepted) fail('尚未受理');
    if (st.decision && !(st.review && !st.review.done)) fail('已判定');
    if (isAuto(c) && !st.objection) st.objection = { by: 'office', at: iso(now()), note: reason || '公所認為估計需到場確認' };
    st.visit = { at: iso(now()), reason: reason || '' };
    commit(s, '公所', '改排到場', id, isAuto(c) ? '公所異議' : '');
    return { ok: true };
  };

  // 公所：判定（以機關憑證簽章）
  W.submitDecision = (id, rec) => {
    if (rec.result === 'visit') return W.scheduleVisit(id, '公所判定改排到場');
    const s = dbw(); const st = stOf(s, id); const c = getCase(id);
    const p = policy(id);
    if (p.block) fail(p.block);
    if (!p.methods.includes(rec.method)) fail('本案不能用「' + (CFG().decisionMethods[rec.method] || {}).label + '」判定');
    const TH = CFG().grade.lossThreshold;
    let rate = rec.rate;
    if (p.fixedRate != null && rec.method === 'paper') rate = p.fixedRate;
    if ((rec.method === 'survey' || rec.method === 'sample') && p.fieldRate != null && rate !== p.fieldRate) fail('實地勘查的受害率須與現勘紀錄一致（' + p.fieldRate + '%）');
    if (rec.result === 'approve') {
      if (p.rejectOnly) fail('A 未達標且未提出異議，只能依通知結果判定不予救助');
      if (!(typeof rate === 'number') || rate < TH) fail('受害率未達 ' + TH + '%，不能核定救助');
      if (!rec.cropMatch) fail('作物與申報不符時不能核定，請改排到場或不予救助');
      if (!(rec.areaHa > 0) || rec.areaHa > c.areaHa + 1e-9) fail('核定面積須大於 0、且不超過災前基準面積 ' + c.areaHa + ' 公頃');
    } else if (rec.result === 'reject') {
      if (!rec.rejectReason) fail('不予救助須選擇法定原因');
      if (rec.rejectReason === 'T1' && !(typeof rate === 'number' && rate < TH)) fail('以「損失率未達 20%」不予救助，須有未達 20% 的受害率依據');
    }
    const r2 = Object.assign({}, rec, { rate, at: iso(now()), by: '測試承辦', systemGrade: c.grade, level: c.level, reportHash: c.report && c.report.hash });
    st.decision = r2;
    st.decisions = (st.decisions || []).concat([r2]);
    if (st.review && !st.review.done) st.review.done = true;
    commit(s, '公所', rec.result === 'approve' ? '核定' : '不予救助', id, (CFG().decisionMethods[rec.method] || {}).label + (rate != null ? '，受害率 ' + rate + '%' : ''));
    return { ok: true, rec: r2 };
  };

  W.saveRCheck = (id, key, value) => {
    const s = dbw(); const st = stOf(s, id);
    if (!st.filed) fail('尚未送件');
    st.rcheck = Object.assign({}, st.rcheck, { [key]: value });
    commit(s, '公所', 'R1–R5 回寫', id, key + '：' + value.status);
    return { ok: true };
  };

  // 公所：量能、到場清單
  W.setCapacity = (cap) => {
    const s = dbw();
    s.capacity = Object.assign({}, s.capacity, cap);
    commit(s, '公所', '設定量能', null, JSON.stringify(s.capacity));
    return { ok: true };
  };
  W.saveRoute = (items) => {
    const s = dbw();
    const allowed = new Set(workItems().map((i) => i.id));
    const bad = items.filter((i) => !allowed.has(i.caseId));
    if (bad.length) fail('清單中有不需要到場的案件：' + bad.map((b) => b.caseNo).join('、'));
    if (!items.length) fail('沒有排入到場的案件（請先設定現勘人日）');
    s.route = { at: iso(now()), items };
    items.forEach((i) => { const st = stOf(s, i.caseId); st.visit = st.visit || { at: iso(now()), reason: '排入到場' }; });
    commit(s, '公所', '下載到場清單到公務手機', null, items.length + ' 筆');
    return { ok: true };
  };

  // 公所：無人機
  W.droneStep = (groupId, step, payload) => {
    const s = dbw();
    const order = ['route', 'apply', 'dispatch', 'returned'];
    const g = s.drone[groupId] || {};
    const i = order.indexOf(step);
    if (i < 0) fail('不明的步驟');
    if (i > 0 && !g[order[i - 1]]) fail('請依序：計算航線 → 提交飛行申請 → 派飛 → 資料回傳');
    if (g[step]) fail('這一步已完成');
    const ids = (payload && payload.caseIds) || g.caseIds || [];
    if (!(s.capacity && s.capacity.droneCases > 0)) fail('尚未設定無人機量能');
    const ok = ids.every((id) => { const c = getCase(id); return c.grade === 'C' && ['expired', 'insufficient'].includes(c.supplementState) && R().isImagery(c.reasons); });
    if (step === 'route' && !ok) fail('無人機只處理補件期限已過（或補件仍不足）的影像類 C 缺失案件');
    s.drone[groupId] = Object.assign(g, { [step]: iso(now()), caseIds: ids, takeoff: payload && payload.takeoff });
    ids.forEach((id) => { const st = stOf(s, id); st.drone = { group: groupId, step, at: iso(now()) }; });
    let detail = '';
    if (step === 'returned') {
      const res = ids.map((id) => { const g2 = recheck(s, id, PHOTO_CLEARS, '無人機補拍'); return getCase(id).caseNo + ' → ' + (g2 ? CFG().grades[g2].label : '—'); });
      detail = res.join('、');
    }
    commit(s, '公所', '無人機：' + ({ route: '計算航線', apply: '提交飛行申請', dispatch: '派飛', returned: '資料回傳並重新檢核' })[step], groupId.slice(0, 40), detail);
    return { ok: true };
  };

  // 現勘手機：回傳
  W.uploadFieldRecords = (records) => {
    const s = dbw();
    const routeIds = new Set(((s.route && s.route.items) || []).map((i) => i.caseId));
    const done = [];
    records.forEach((r) => {
      if (!r.caseId || !routeIds.has(r.caseId)) fail((r.caseNo || '') + ' 不在公所下載的到場清單內');
      if (!r.gnss) fail((r.caseNo || '') + ' 缺 GNSS 座標');
      if (!(r.photos && r.photos.far && r.photos.near)) fail((r.caseNo || '') + ' 缺遠拍或近拍');
      if (!(typeof r.rate === 'number' && r.rate >= 0 && r.rate <= 100)) fail((r.caseNo || '') + ' 受害率須介於 0–100%');
      const st = stOf(s, r.caseId);
      st.field = { rate: r.rate, at: r.at, by: '測試勘查員', gnss: r.gnss, note: r.note, photos: [r.photos.far.name, r.photos.near.name], kind: r.kind };
      if (st.visit) st.visit.doneAt = iso(now());
      done.push(r.caseNo);
    });
    commit(s, '現勘', '回傳現勘紀錄', done.join('、'));
    return { ok: true };
  };

  // 公所：封存、層報
  W.sealBatch = () => {
    const s = dbw();
    if (s.batch && s.batch.sealed) fail('已封存');
    s.batch = { sealed: true, sealedAt: iso(now()) };
    commit(s, '公所', '封存本批存證報告');
    return { ok: true };
  };
  W.submitReport = (eventId, kind) => {
    const s = dbw(); const D = dl();
    if (s.reports[kind]) fail('已送出過');
    if (kind === 'statTable') {
      const left = filedCases().filter((c) => c.accepted && !c.decision);
      if (left.length && now() <= eod(D.surveyEnd)) fail('還有 ' + left.length + ' 件未判定；全部判定完成或勘查期截止後才能報送縣府');
    }
    s.reports[kind] = { at: iso(now()) };
    commit(s, '公所', kind === 'statTable' ? '報送縣府' : '送出分級清冊副本與參考名單');
    return { ok: true };
  };

  // 平時：登錄與災前基準
  W.registerField = (payload) => {
    const s = dbw();
    if (!(payload.declaredHa > 0)) fail('請填申報面積');
    const cap = payload.capHa || 0.92;
    const status = payload.declaredHa > cap ? 'blocked' : payload.scopeCheck ? 'scope' : 'pending';
    const r = Object.assign({ id: 'R' + String(s.registered.length + 1).padStart(3, '0'), at: iso(now()), capHa: cap, status }, payload);
    s.registered.push(r);
    commit(s, '農民', '登錄田區', r.id, payload.landNo);
    return { ok: true, id: r.id };
  };
  W.confirmBaseline = (id, method, note) => {
    const s = dbw();
    const b = baselineRow(id);
    if (!b) fail('找不到登錄資料');
    if (b.status === 'locked') fail('已鎖定');
    if (b.status === 'blocked') fail('申報超過權利面積，系統已擋下；請申請人更正後重新登錄');
    if (method === 'adjust' && !note) fail('修正範圍後確認，請註明扣除項目');
    if (b.status === 'scope' && method === 'overlay') fail('範圍需確認的案件不能直接依套疊確認，請修正範圍或排定到場');
    if (method === 'visit') return W.baselineVisit(id);
    s.baseline[id] = Object.assign({}, s.baseline[id], { status: 'locked', method, note, at: iso(now()) });
    commit(s, '公所', '鎖定災前基準', id, method);
    return { ok: true };
  };
  W.baselineVisit = (id) => {
    const s = dbw();
    s.baseline[id] = Object.assign({}, s.baseline[id], { visitAt: iso(now()) });
    commit(s, '公所', '災前基準排定到場', id);
    return { ok: true };
  };

  // ------------------------------------------------------------------ 讀取（與 api.js 同名）
  function unappliedField(id) {
    const s = db();
    for (const f of T().listFarmers()) {
      const fx = T().getFarmer(f.id).fields.find((x) => x.unappliedDamaged && (x.id === id || x.caseId === id));
      if (fx && !s.newCases['N-' + fx.id]) return Object.assign({ farmerId: f.id }, fx);
    }
    return null;
  }
  function baselineRow(id) {
    const s = db();
    const reg = s.registered.find((r) => r.id === id);
    let b;
    if (reg) b = { id: reg.id, applicant: farmerName(reg.farmerId), identity: reg.identity, rightDoc: (reg.files || []).join('、') || '—', declaredHa: reg.declaredHa, capHa: reg.capHa, roadPondPct: 0.06, cadastreMatch: !reg.scopeCheck, status: reg.status, landNo: reg.landNo, crop: reg.crop, proof: reg.proofType, farmerId: reg.farmerId, registered: true };
    else { b = ['pending', 'scope', 'blocked', 'locked'].map((k) => T().listBaseline(k)).flat().find((x) => x.id === id); if (!b) return null; }
    const o = s.baseline[id];
    if (o) b = Object.assign({}, b, { status: o.status || b.status, lockedAt: o.at, method: o.method, visitAt: o.visitAt });
    return b;
  }
  function farmerName(fid) { const f = T().listFarmers().find((x) => x.id === fid); return f ? f.name : fid; }

  const Rd = {};
  Rd.listCases = () => filedCases();
  Rd.getCase = (id) => getCase(id);
  Rd.findApplication = (q) => {
    q = String(q || '').trim();
    const c = allCases().find((x) => x.caseNo === q || x.landNo === q || x.id === q || (x.report && (q === x.report.verifyCode || q.startsWith(x.report.no + '-'))));
    if (!c) return null;
    const full = getCase(c.id);
    if (!full.filed) return Object.assign(full, { notFiled: true });
    return full;
  };
  Rd.getOverview = () => {
    const cases = filedCases();
    const vis = cases.filter((c) => c.level !== '丙');
    const cnt = (g) => vis.filter((c) => c.grade === g).length;
    const items = workItems();
    const k = (x) => items.filter((i) => i.kind === x).length;
    const s = db();
    return {
      applied: cases.length,
      bySource: { self: cases.filter((c) => ['本人', 'auto'].includes(c.filed.by)).length, farmersAssoc: cases.filter((c) => c.filed.by === '農會協助').length, proxy: cases.filter((c) => c.filed.by === '委託').length },
      counts: { A_MET: cnt('A_MET'), A_NOT_MET: cnt('A_NOT_MET'), B: cnt('B'), C: cnt('C') },
      notifiedUnapplied: 9, registeredParcels: 214 + s.registered.filter((r) => (baselineRow(r.id) || {}).status === 'locked').length, submitted: cases.length,
      damagedUnsubmitted: 9 - Object.keys(s.newCases).length, appPhotos: cases.filter((c) => c.hasApp).length,
      workload: {
        paper: cases.filter((c) => isAuto(c) && !c.sampled && !c.appeal).length,
        visit: items.length, currentRuleVisit: cases.length,
        sampleA: k('sample'), bVisit: k('B'), cVisit: items.filter((i) => i.kind === 'C').length, currentRule: k('current'),
        drone: items.filter((i) => i.kind === 'C' && i._route === 'drone').length,
        waitingSupplement: cases.filter((c) => c.grade === 'C' && c.supplementState === 'pending').length
      },
      delivery: [
        { label: '分級清冊與存證報告交本所（封存根雜湊）', done: true, detail: T().fakeHash('root').slice(0, 4) + '…' + T().fakeHash('root').slice(-4) },
        { label: '分級清冊副本交縣市政府農業處，作為抽查參考', done: !!s.reports.countyReference, detail: s.reports.countyReference ? SA.ui.datetime(s.reports.countyReference.at) : '尚未送出' },
        { label: '到場清單下載至公務手機', done: !!s.route, detail: s.route ? SA.ui.datetime(s.route.at) + '，' + s.route.items.length + ' 筆' : '尚未下載' },
        { label: '熱區圖交縣府提報（與官方統計偏差 ±20% 內）', done: true, detail: '偏差 +6%（測試）' }
      ]
    };
  };
  Rd.listCategories = () => T().listCategories().map((cat) => Object.assign(cat, { count: filedCases().filter((c) => c.categoryId === cat.id).length }));
  Rd.listSamples = () => filedCases().filter((c) => c.sampled && isAuto(c)).map((c) => ({ caseId: c.id, caseNo: c.caseNo, category: c.crop + ' × ' + c.hazard, grade: c.grade, fieldLoss: c.fieldRecord ? c.fieldRecord.rate : null }));
  Rd.getReporting = () => { const c = filedCases().filter((x) => x.accepted); return { households: new Set(c.map((x) => x.applicant)).size, surveyed: c.filter((x) => x.decision).length, total: c.length }; };
  Rd.listFollowups = () => allCases().filter((c) => c.review).map((c) => ({ caseNo: c.caseNo, kind: 'appeal', receivedAt: c.review.at.slice(0, 10), noticeAt: c.decision ? c.decision.at.slice(0, 10) : null, status: c.review.done ? '已重新判定' : '待重新到場' }));
  Rd.listBaseline = (status) => {
    const s = db();
    const ids = ['pending', 'scope', 'blocked', 'locked'].map((k) => T().listBaseline(k)).flat().map((b) => b.id).concat(s.registered.map((r) => r.id));
    return ids.map(baselineRow).filter((b) => b && b.status === status);
  };
  Rd.getBaseline = (id) => {
    const b = baselineRow(id);
    if (!b) return null;
    const tmpl = T().getBaseline(b.registered ? 'B001' : id) || {};
    const checks = [
      { label: '申報面積未超過本筆面積 × 持分', ok: b.declaredHa <= b.capHa, detail: b.declaredHa + ' / ' + b.capHa + ' 公頃' },
      { label: '扣除農路水塘後的種植範圍', ok: b.roadPondPct < 0.1, detail: '農路水塘佔 ' + (b.roadPondPct * 100).toFixed(1) + '%' },
      { label: '地籍與航照相符', ok: b.cadastreMatch, detail: b.cadastreMatch ? '偏移 < 2 公尺' : '申請人勾選「只租一部分或地籍對不上」' },
      { label: '使用權文件有效期間涵蓋本期作', ok: true, detail: '（測試）' }
    ];
    return Object.assign({}, tmpl, b, { checks: b.registered ? checks : tmpl.checks });
  };
  Rd.downloadRoute = () => {
    const s = db();
    const done = new Set(allCases().filter((c) => c.fieldRecord && !(c.review && !c.review.done)).map((c) => c.id));
    return ((s.route && s.route.items) || []).filter((i) => !done.has(i.caseId));
  };
  Rd.getFarmer = (fid) => {
    const s = db();
    const f = T().getFarmer(fid);
    if (!f) return f;
    f.fields.forEach((x) => { if (x.unappliedDamaged && s.newCases['N-' + x.id]) { x.caseId = 'N-' + x.id; x.unappliedDamaged = false; } });
    return f;
  };
  Rd.listFarmerCases = (fid) => {
    const s = db();
    return T().listFarmerCases(fid).map((c) => getCase(c.id)).concat(Object.values(s.newCases).filter((c) => c.farmerId === fid).map((c) => getCase(c.id)));
  };
  Rd.getBatch = () => Object.assign({}, T().getBatch(), db().batch || {});

  // 本機狀態（api.js 的 getLocal* 在實操模式改讀這裡）
  const L = {};
  L.decision = (id) => (db().cases[id] || {}).decision || null;
  L.accepted = (id) => (db().cases[id] || {}).accepted || null;
  L.application = (id) => { const st = db().cases[id] || {}; return st.filed && st.filed.by !== 'auto' ? { declaredRate: st.filed.declaredRate, by: st.filed.by, at: st.filed.at, caseNo: (getCase(id) || {}).caseNo } : null; };
  L.supplement = (id) => { const st = db().cases[id] || {}; return st.supp && st.supp.state === 'received' ? Object.assign({ at: st.supp.receivedAt, result: st.supp.result }, st.supp.data) : null; };
  L.supplementStates = () => { const out = {}; Object.entries(db().cases).forEach(([id, st]) => { out[id] = suppState(st); }); return out; };
  L.appeal = (id) => { const st = db().cases[id] || {}; if (st.review) return { kind: 'review', at: st.review.at, payload: {} }; if (st.objection) return { kind: 'objection', at: st.objection.at, by: st.objection.by, payload: { note: st.objection.note } }; return null; };
  L.appeals = () => { const out = {}; Object.entries(db().cases).forEach(([id, st]) => { if (st.objection) out[id] = { kind: 'objection' }; }); return out; };
  L.notice = (id) => { const n = (db().cases[id] || {}).notices || {}; const x = n.supplement || n.notMet; return x ? { kind: n.supplement ? 'supplement' : 'notMet', content: { due: x.due }, at: x.at } : null; };
  L.droneCase = (id) => (db().cases[id] || {}).drone || null;
  L.droneStates = () => db().drone;
  L.rchecks = (id) => (db().cases[id] || {}).rcheck || {};
  L.registered = (fid) => db().registered.filter((r) => r.farmerId === fid).map((r) => Object.assign({}, r, { status: (baselineRow(r.id) || {}).status }));
  L.capacity = () => db().capacity;
  L.visit = (id) => (db().cases[id] || {}).visit || null;
  L.field = (id) => (db().cases[id] || {}).field || null;

  return {
    OpsError, W, Rd, L, policy, workItems, isAuto, event, deadlines: dl,
    log: () => db().log.slice(),
    rev: () => (read() || {}).rev || 0,
    reset: () => { localStorage.removeItem(KEY); lastRaw = null; db(); },
    KEY
  };
})();
