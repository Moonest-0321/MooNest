/*
 * 天相星：模式切換（公所端、現勘手機、農民端共用）
 *
 *   展示模式（demo）：原本的原型，可自由切換情境、資料來源、測試帳號、被改過的報告等，方便檢查各種畫面。
 *   實操模式（ops）：只能照實際作業流程操作。時間用真實時鐘，期限、權限、順序都會檢查；
 *                    公所、農民、現勘手機讀寫同一份資料，任何一端的動作另一端立即看到。
 *
 * 兩種模式的資料分開存放，互不影響。
 */
window.SA = window.SA || {};

SA.mode = (function () {
  const KEY = 'skyaide.mode';
  // 頁面載入時決定一次，切換模式一律重新載入頁面（避免同一頁混用兩種模式）
  const AT_LOAD = (() => { try { return localStorage.getItem(KEY) === 'ops' ? 'ops' : 'demo'; } catch (e) { return 'demo'; } })();
  const get = () => AT_LOAD;
  return {
    get,
    isOps: () => get() === 'ops',
    set: (m) => { try { localStorage.setItem(KEY, m === 'ops' ? 'ops' : 'demo'); } catch (e) { /* 無法保存 */ } },
    // 各模式各自的本機資料
    key: (base) => (get() === 'ops' ? base + '.ops' : base),
    label: (m) => ((m || get()) === 'ops' ? '實操模式' : '展示模式')
  };
})();
