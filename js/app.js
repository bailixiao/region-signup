// 進入點：依網址 # 切換頁面（首頁、區行事曆、活動頁、查我的報名、常見問題、管理後台），字體大小，Service Worker。
(function () {
  'use strict';

  const VIEWS = ['home', 'calendar', 'event', 'mine', 'help', 'admin'];
  const TEXT_KEY = 'region-signup:text-size';
  const SIZES = ['', 'l', 'xl'];
  const titleEl = () => document.getElementById('site-title');

  function showView(name) {
    VIEWS.forEach((v) => { document.getElementById('view-' + v).hidden = v !== name; });
    document.body.classList.toggle('is-sub', name !== 'calendar' && name !== 'home');
    document.body.classList.toggle('on-admin', name === 'admin');
  }

  function setRegionTitle(region) {
    titleEl().textContent = region ? `${region}行事曆` : window.SITE.name;
    document.title = region ? `${region}行事曆` : window.SITE.name;
    document.querySelector('.app-title').setAttribute('href', region ? '#/r/' + encodeURIComponent(region) : '#/');
  }

  function route() {
    const hash = location.hash || '#/';
    const r = hash.match(/^#\/r\/([^/?]+)(?:\/(e)\/([^?]+)|\/(mine))?(?:\?date=(\d{4}-\d{2}-\d{2}))?/);
    if (r) {
      const region = decodeURIComponent(r[1]);
      setRegionTitle(region);
      HomePage.remember(region);
      CalendarPage.setRegion(region);
      if (r[2]) { showView('event'); window.scrollTo(0, 0); EventPage.show(document.getElementById('view-event'), region, decodeURIComponent(r[3]), r[5]); return; }
      if (r[4]) { showView('mine'); window.scrollTo(0, 0); MinePage.show(document.getElementById('view-mine'), region); return; }
      showView('calendar');
      document.getElementById('region-name').textContent = region;
      document.getElementById('mine-link').setAttribute('href', '#/r/' + encodeURIComponent(region) + '/mine');
      CalendarPage.onShow();
      return;
    }
    if (/^#\/help\/?$/.test(hash)) { showView('help'); window.scrollTo(0, 0); HelpPage.show(document.getElementById('view-help')); return; }
    const admin = hash.match(/^#\/admin\/?(.*)$/);
    if (admin) { setRegionTitle(''); showView('admin'); window.scrollTo(0, 0); AdminPage.show(document.getElementById('view-admin'), admin[1]); return; }
    setRegionTitle('');
    showView('home');
    HomePage.show(document.getElementById('view-home'), hash === '#/choose');
  }

  function initTextSize() {
    const btn = document.getElementById('text-size');
    let i = 0;
    try { i = Math.max(0, SIZES.indexOf(localStorage.getItem(TEXT_KEY) || '')); } catch (e) { /* 預設 */ }
    const apply = () => {
      SIZES.forEach((s) => { if (s) document.documentElement.classList.toggle('text-' + s, s === SIZES[i]); });
      btn.setAttribute('aria-label', `字體大小（目前第 ${i + 1} 級，共 3 級）`);
    };
    btn.addEventListener('click', () => {
      i = (i + 1) % SIZES.length;
      try { localStorage.setItem(TEXT_KEY, SIZES[i]); } catch (e) { /* 不記住 */ }
      apply();
      CalendarPage.onShow();
    });
    apply();
  }

  function init() {
    initTextSize();
    CalendarPage.init();
    window.addEventListener('hashchange', route);
    route();
    if ('serviceWorker' in navigator && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
      navigator.serviceWorker.register('sw.js').catch(() => { /* 不支援：照常使用 */ });
    }
  }

  init();
})();
