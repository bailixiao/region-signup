// 首頁（#/ 與 #/choose，規格第 9 節）：列出開放的區；記住上次進的區，下次打開直接進去。
(function () {
  'use strict';

  const LAST_KEY = 'region-signup:last-region';

  function last() {
    try { return localStorage.getItem(LAST_KEY) || ''; } catch (e) { return ''; }
  }
  function remember(region) {
    try { localStorage.setItem(LAST_KEY, region); } catch (e) { /* 不記住 */ }
  }

  async function show(view, choose) {
    const saved = last();
    if (!choose && saved) { location.replace('#/r/' + encodeURIComponent(saved)); return; }
    view.innerHTML = '<h1 class="admin-title">選擇您的區</h1><p class="panel-empty">載入中⋯</p>';
    try {
      const { regions } = await Api.regions();
      view.innerHTML = `
        <h1 class="admin-title">選擇您的區</h1>
        <p class="hint">點您的區，就能看行事曆、報名。這支手機會記住，下次打開直接進去。</p>
        ${regions.length ? `<div class="region-grid">${regions.map((r) => `<a class="btn region-btn" href="#/r/${encodeURIComponent(r.name)}">${Fmt.esc(r.name)}</a>`).join('')}</div>`
          : '<p class="panel-empty">還沒有開放報名的區</p>'}
        <p class="hint">沒看到您的區：表示那一區還沒有開放這個報名系統。</p>
        <a class="btn btn-block" href="#/help">❓ 常見問題</a>`;
    } catch (err) {
      view.innerHTML = `<h1 class="admin-title">選擇您的區</h1><div class="notice notice-error"><p>${Fmt.esc(err.message)}</p></div>`;
    }
  }

  window.HomePage = { show, remember };
})();
