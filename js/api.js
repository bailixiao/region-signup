// 呼叫各區報名系統的 Worker API（規格第 8 節）。
// 讀取用 GET（逾時就同時再問一次）；寫入用 POST，內容是 JSON、標頭 text/plain（避免 CORS 預檢）。名字只放在 POST 內容，不放網址。
(function () {
  'use strict';

  const TOKEN_KEY = 'region-signup:admin';

  class ApiError extends Error {
    constructor(code, message, details) {
      super(message);
      this.code = code;
      this.details = details || [];
    }
  }

  async function parse(res) {
    if (!res.ok) throw new ApiError('NETWORK', '連線失敗，請稍後再試');
    let json;
    try { json = await res.json(); } catch (e) { throw new ApiError('NETWORK', '伺服器回應格式錯誤，請稍後再試'); }
    if (!json.ok) throw new ApiError(json.error.code, json.error.message, json.error.details);
    return json.data;
  }

  async function fetchJson(url, init, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await parse(await fetch(url, Object.assign({ signal: ctrl.signal }, init)));
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError('NETWORK', '無法連線，請檢查網路後再試');
    } finally {
      clearTimeout(timer);
    }
  }

  /** 讀取：4 秒沒回來就同時再送一次，最多 3 個；全部都連線失敗才算失敗 */
  function get(action, params) {
    const url = window.APP_CONFIG.API_URL + (window.APP_CONFIG.API_URL.indexOf('?') === -1 ? '?' : '&') + new URLSearchParams(Object.assign({ action }, params || {})).toString();
    const waits = [4000, 8000];
    return new Promise((resolve, reject) => {
      let done = false;
      let started = 0;
      let failed = 0;
      let timer = null;
      const launch = () => {
        if (done) return;
        started++;
        if (started <= waits.length) timer = setTimeout(launch, waits[started - 1]);
        fetchJson(url, {}, 20000).then((data) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(data);
        }, (err) => {
          if (done) return;
          if (err.code !== 'NETWORK') { done = true; clearTimeout(timer); reject(err); return; }
          failed++;
          if (failed < started) return;
          if (started <= waits.length) { clearTimeout(timer); launch(); return; }
          done = true;
          reject(err);
        });
      };
      launch();
    });
  }

  /** 寫入：連線失敗不自動重送（避免重複報名） */
  function post(body) {
    return fetchJson(window.APP_CONFIG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) }, 30000);
  }

  // ---------- 管理者：通行碼存在這個瀏覽器（12 小時） ----------

  function loadSaved() {
    try {
      const t = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null');
      return t && t.expires > Date.now() ? t : null;
    } catch (e) { return null; }
  }
  let saved = loadSaved();

  function save(data) {
    saved = data ? { token: data.token, account: data.account, role: data.role, expires: Date.now() + data.expiresInSec * 1000 - 60000 } : null;
    try {
      if (saved) localStorage.setItem(TOKEN_KEY, JSON.stringify(saved));
      else localStorage.removeItem(TOKEN_KEY);
    } catch (e) { /* 無痕模式：只是要重新登入 */ }
  }

  async function admin(action, payload) {
    try {
      return await post(Object.assign({ action, token: saved && saved.token }, payload || {}));
    } catch (err) {
      if (err.code === 'UNAUTHORIZED' && /登入/.test(err.message)) save(null);
      throw err;
    }
  }

  window.Api = {
    ApiError,
    regions: () => get('regions'),
    loginAccounts: () => get('loginAccounts'),
    getEvents: (region, from, to) => get('getEvents', { region, from, to }),
    getEvent: (region, id) => get('getEvent', { region, id }),
    signup: (p) => post(Object.assign({ action: 'signup' }, p)),
    mySignups: (region, name) => post({ action: 'mySignups', region, name }),
    cancel: (region, signupId) => post({ action: 'cancel', region, signupId }),
    reschedule: (p) => post(Object.assign({ action: 'reschedule' }, p)),
    admin,
    adminLogin: async (account, password) => { save(await post({ action: 'adminLogin', account, password })); return saved; },
    adminLogout: () => { const t = saved && saved.token; save(null); if (t) post({ action: 'adminLogout', token: t }).catch(() => {}); },
    who: () => saved
  };
})();
