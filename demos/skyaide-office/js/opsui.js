/* 實操模式的共用畫面行為：模式切換、動作被拒時的提示、另一端有變動時自動更新 */
window.SA = window.SA || {};
SA.opsui = (function () {
  const { h } = SA.ui;
  // 被規則拒絕的動作：顯示原因
  window.addEventListener('unhandledrejection', (e) => {
    const err = e.reason;
    if (!err) return;
    e.preventDefault();
    SA.ui.toast('不能執行：' + (err.message || String(err)), 'warn');
  });
  // 另一個分頁（另一端）改了資料 → 重新整理目前畫面
  let onChange = null, timer = null;
  window.addEventListener('storage', (e) => {
    if (e.key === 'skyaide.mode') { location.reload(); return; }
    if (!SA.mode.isOps() || !SA.ops || e.key !== SA.ops.KEY) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (document.querySelector('.overlay')) return; // 對話框開著時不打斷
      const a = document.activeElement;
      if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.value) return; // 正在填資料時不打斷
      if (onChange) { onChange(); SA.ui.toast('另一端有新的動作，畫面已更新', 'info'); }
    }, 300);
  });
  function switcher() {
    const cur = SA.mode.get();
    const sel = h('select', { 'aria-label': '模式', class: 'mode-sel mode-' + cur, onchange: (e) => { SA.mode.set(e.target.value); location.reload(); } },
      h('option', { value: 'demo', selected: cur === 'demo' ? true : null }, '展示模式（可自由切換）'),
      h('option', { value: 'ops', selected: cur === 'ops' ? true : null }, '實操模式（依實際流程）'));
    const box = h('span', { class: 'mode-pick' }, sel);
    if (cur === 'demo') box.appendChild(h('button', { class: 'linklike small', title: '把實操模式的資料恢復成演示資料的起始狀態', onclick: async () => {
      const ok = await SA.ui.confirmDialog('重設實操資料', '實操模式中做過的所有動作都會清除，回到演示資料的起始狀態。', '重設', { danger: true });
      if (ok) { try { localStorage.removeItem('skyaide.ops.state.v1'); localStorage.removeItem('skyaide.field.route.ops'); localStorage.removeItem('skyaide.field.queue.ops'); localStorage.removeItem('skyaide.farmer.id.ops'); } catch (e) { /* 無法清除 */ } SA.ui.toast('已重設'); }
    } }, '重設實操資料'));
    return box;
  }
  return { switcher, setOnChange: (fn) => { onChange = fn; }, isOps: () => SA.mode.isOps() };
})();
