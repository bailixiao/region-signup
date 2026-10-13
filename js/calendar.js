// 一區的行事曆（沿用分壇行事曆、教全區的看法）：年／月檢視用 FullCalendar，週、近期是自製的直向列表。
// 格子顯示國曆、農曆與色點（顏色依類別）；點日期在下方列出當天活動卡片，卡片右邊是報名狀態（缺人／額滿／已報）。
(function () {
  'use strict';

  const FC_VIEWS = { year: 'multiMonthYear', month: 'dayGridMonth' };
  const KEY = 'region-signup:';
  const DOTS_MAX = { year: 3, month: 4 };
  const RECENT_DAYS = 31;

  const el = {};
  const state = {
    view: 'month',
    anchor: Fmt.toDateStr(new Date()),
    selected: null,
    today: Fmt.toDateStr(new Date()),
    range: null,
    loading: true,
    pendingScroll: null,
    showPast: false,
    region: ''
  };
  const windows = new Map(); // 年份 → { data, fresh, promise }
  const dayMap = new Map();
  const cells = new Map();
  let calendar = null;
  let loadToken = 0;

  function readKey(k, dflt) {
    try { const v = localStorage.getItem(KEY + k); return v === null ? dflt : v; } catch (e) { return dflt; }
  }
  function writeKey(k, v) {
    try { localStorage.setItem(KEY + k, v); } catch (e) { /* 不記住 */ }
  }

  function init() {
    el.fc = document.getElementById('fc');
    el.week = document.getElementById('week');
    el.title = document.getElementById('cal-title');
    el.status = document.getElementById('cal-status');
    el.panel = document.getElementById('day-panel');
    el.tabs = Array.from(document.querySelectorAll('[data-view]'));
    el.pastToggle = document.getElementById('past-toggle');
    el.nav = ['cal-prev', 'cal-next', 'cal-today'].map((id) => document.getElementById(id));
    const v = readKey('view', 'month');
    state.view = ['year', 'month', 'week', 'recent'].indexOf(v) !== -1 ? v : 'month';

    calendar = new FullCalendar.Calendar(el.fc, {
      locale: 'zh-tw',
      firstDay: 0,
      headerToolbar: false,
      height: 'auto',
      fixedWeekCount: false,
      initialView: FC_VIEWS[state.view] || FC_VIEWS.month,
      initialDate: state.anchor,
      multiMonthMinWidth: 260,
      multiMonthMaxColumns: 3,
      dayHeaderContent: (arg) => Fmt.weekday(Fmt.toDateStr(arg.date)),
      dayCellContent: cellContent,
      dayCellDidMount: onCellMount,
      dayCellWillUnmount: onCellUnmount,
      dateClick: (info) => onDateClick(info.dateStr),
      datesSet: () => { if (!isListView() && state.region) loadFcRange(); }
    });
    calendar.render();

    el.tabs.forEach((btn) => btn.addEventListener('click', () => switchView(btn.dataset.view)));
    document.getElementById('cal-prev').addEventListener('click', () => move(-1));
    document.getElementById('cal-next').addEventListener('click', () => move(1));
    document.getElementById('cal-today').addEventListener('click', goToday);
    el.pastToggle.addEventListener('click', () => { state.showPast = !state.showPast; applyPastMonths(); });
  }

  /** 換區：清掉上一區的資料，重新載入 */
  function setRegion(name) {
    if (name === state.region) return;
    state.region = name;
    windows.clear();
    dayMap.clear();
    state.loading = true;
    applyView();
  }

  // ---------- 檢視切換與導覽 ----------

  function switchView(view) {
    if (view === state.view) return;
    if (state.view === 'month' && state.selected) state.anchor = state.selected;
    state.view = view;
    writeKey('view', view);
    applyView();
  }

  function isListView() {
    return state.view === 'week' || state.view === 'recent';
  }

  function applyView() {
    el.tabs.forEach((btn) => {
      const on = btn.dataset.view === state.view;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    const isList = isListView();
    el.fc.hidden = isList;
    if (isList) el.pastToggle.hidden = true;
    el.week.hidden = !isList;
    el.panel.hidden = state.view !== 'month';
    el.nav.forEach((b) => { b.hidden = state.view === 'recent'; });
    if (state.view === 'recent') loadRecent();
    else if (isList) loadWeek();
    else {
      calendar.changeView(FC_VIEWS[state.view], state.anchor);
      calendar.updateSize();
      loadFcRange();
      if (state.view === 'year') state.pendingScroll = state.anchor;
    }
  }

  function pastMonthCount() {
    if (state.view !== 'year' || state.anchor.slice(0, 4) !== state.today.slice(0, 4)) return 0;
    return Number(state.today.slice(5, 7)) - 1;
  }

  function markPastMonth(month) {
    if (!month || !month.dataset.date) return;
    const key = month.dataset.date;
    month.classList.toggle('is-past-month', !state.showPast && key.slice(0, 4) === state.today.slice(0, 4) && key < state.today.slice(0, 7));
  }

  function applyPastMonths() {
    el.fc.querySelectorAll('.fc-multimonth-month').forEach(markPastMonth);
    updatePastToggle();
  }

  function updatePastToggle() {
    const n = pastMonthCount();
    el.pastToggle.hidden = n === 0;
    if (n === 0) return;
    el.pastToggle.textContent = state.showPast ? '隱藏已過的月份' : `顯示已過的月份（${n === 1 ? '1 月' : `1–${n} 月`}）`;
  }

  function scrollToPendingMonth() {
    const dateStr = state.pendingScroll;
    state.pendingScroll = null;
    if (!dateStr || state.view !== 'year') return;
    const month = el.fc.querySelector(`.fc-multimonth-month[data-date="${dateStr.slice(0, 7)}"]`);
    if (!month) return;
    const top = month.getBoundingClientRect().top + window.scrollY - 8;
    if (top > window.innerHeight / 2) window.scrollTo({ top });
  }

  function move(step) {
    if (state.view === 'recent') return;
    if (state.view === 'week') { state.anchor = Fmt.addDays(state.anchor, step * 7); loadWeek(); }
    else if (step < 0) calendar.prev();
    else calendar.next();
  }

  function goToday() {
    state.anchor = state.today;
    state.selected = state.today;
    if (state.view === 'recent') loadRecent();
    else if (state.view === 'week') loadWeek();
    else { calendar.gotoDate(state.today); markSelected(); renderPanel(); }
  }

  function loadFcRange() {
    const view = calendar.view;
    state.anchor = Fmt.toDateStr(calendar.getDate());
    if (state.view === 'month') {
      const ms = Fmt.toDateStr(view.currentStart);
      const me = Fmt.addDays(Fmt.toDateStr(view.currentEnd), -1);
      const inMonth = (d) => d && d >= ms && d <= me;
      if (!inMonth(state.selected)) state.selected = inMonth(state.today) ? state.today : ms;
    }
    setTitle();
    updatePastToggle();
    load(Fmt.toDateStr(view.activeStart), Fmt.addDays(Fmt.toDateStr(view.activeEnd), -1));
  }

  const weekStart = (d) => Fmt.addDays(d, -Fmt.parseDate(d).getDay());
  function loadWeek() { const from = weekStart(state.anchor); setTitle(); load(from, Fmt.addDays(from, 6)); }
  function loadRecent() { setTitle(); load(state.today, Fmt.addDays(state.today, RECENT_DAYS - 1)); }

  function setTitle() {
    const a = state.anchor;
    const md = (s) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
    if (state.view === 'year') el.title.textContent = `${Fmt.rocYear(a)} 年`;
    else if (state.view === 'month') el.title.textContent = `${Fmt.rocYear(a)} 年 ${Number(a.slice(5, 7))} 月`;
    else if (state.view === 'recent') el.title.textContent = '近一個月的活動';
    else { const from = weekStart(a); el.title.textContent = `${Fmt.rocYear(from)} 年 ${md(from)} – ${md(Fmt.addDays(from, 6))}`; }
  }

  // ---------- 資料：一次載入一整年（前後各多 7 天），上次的存在 localStorage ----------

  const windowRange = (y) => ({ from: Fmt.addDays(`${y}-01-01`, -7), to: Fmt.addDays(`${y}-12-31`, 7) });
  function windowYearFor(from, to) { const y = Number(from.slice(0, 4)); return to <= windowRange(y).to ? y : y + 1; }

  function storeKey(year) { return KEY + 'events:' + state.region + ':' + year; }

  function ensureWindow(year) {
    let entry = windows.get(year);
    if (!entry) {
      let data = null;
      try { data = JSON.parse(localStorage.getItem(storeKey(year)) || 'null'); } catch (e) { data = null; }
      entry = { data: data && Array.isArray(data.events) ? data : null, fresh: false, promise: null };
      windows.set(year, entry);
    }
    if (!entry.fresh && !entry.promise) {
      const r = windowRange(year);
      const region = state.region;
      entry.promise = Api.getEvents(region, r.from, r.to).then((data) => {
        entry.promise = null;
        if (region !== state.region) return data;
        entry.data = data;
        entry.fresh = true;
        if (data.today) state.today = data.today;
        try { localStorage.setItem(storeKey(year), JSON.stringify(data)); } catch (e) { /* 忽略 */ }
        return data;
      }, (err) => { entry.promise = null; throw err; });
    }
    return entry;
  }

  async function load(from, to) {
    if (!state.region) return;
    const token = ++loadToken;
    state.range = { from, to };
    const entry = ensureWindow(windowYearFor(from, to));
    if (entry.data) { render(entry.data, from, to); if (entry.fresh) hideStatus(); else showStatus('refreshing'); }
    else { state.loading = true; showStatus('loading'); paintAllCells(); renderList(); }
    if (!entry.fresh) {
      try {
        const data = await entry.promise;
        if (token !== loadToken) return;
        render(data, from, to);
        hideStatus();
      } catch (err) {
        if (token !== loadToken) return;
        showStatus('error', entry.data ? '無法更新，目前顯示的是上次的資料' : (err.message || '無法載入行事曆資料'));
      }
    }
  }

  function render(data, from, to) {
    dayMap.clear();
    data.events.forEach((ev) => {
      Fmt.datesBetween(ev.start > from ? ev.start : from, ev.end < to ? ev.end : to).forEach((d) => {
        if (!dayMap.has(d)) dayMap.set(d, []);
        dayMap.get(d).push(ev);
      });
    });
    dayMap.forEach((list) => list.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || '') || a.name.localeCompare(b.name, 'zh-Hant')));
    state.loading = false;
    paintAllCells();
    renderList();
    scrollToPendingMonth();
  }

  /** 報名、管理者存檔後：重新讀 */
  function refresh() {
    windows.forEach((e) => { e.fresh = false; });
    if (state.range) load(state.range.from, state.range.to);
  }

  // ---------- 格子 ----------

  function cellContent(arg) {
    const date = Fmt.toDateStr(arg.date);
    let html = `<span class="cell-num">${arg.date.getDate()}</span>`;
    if (arg.view.type === FC_VIEWS.month) {
      const l = LunarUtil.cellLabel(date);
      html += `<span class="cell-lunar${l.highlight ? ' is-hl' : ''}">${l.text}</span>`;
    }
    return { html };
  }

  function onCellMount(arg) {
    if (arg.view.type === FC_VIEWS.year) markPastMonth(arg.el.closest('.fc-multimonth-month'));
    if (arg.isOther && arg.view.type === FC_VIEWS.year) return;
    const date = Fmt.toDateStr(arg.date);
    if (!cells.has(date)) cells.set(date, new Set());
    cells.get(date).add(arg.el);
    paintCell(arg.el, date);
  }

  function onCellUnmount(arg) {
    const set = cells.get(Fmt.toDateStr(arg.date));
    if (set) set.delete(arg.el);
  }

  function paintAllCells() { cells.forEach((set, date) => set.forEach((c) => paintCell(c, date))); }

  function paintCell(cell, date) {
    cell.classList.toggle('is-selected', state.view === 'month' && date === state.selected);
    cell.classList.toggle('is-past', date < state.today);
    const frame = cell.querySelector('.fc-daygrid-day-frame');
    if (!frame) return;
    const old = frame.querySelector('.cell-dots');
    if (old) old.remove();
    const items = state.loading ? [] : dayMap.get(date) || [];
    if (!items.length) { cell.removeAttribute('aria-label'); return; }
    const max = DOTS_MAX[state.view] || 4;
    const dots = document.createElement('div');
    dots.className = 'cell-dots';
    dots.setAttribute('aria-hidden', 'true');
    dots.innerHTML = items.slice(0, max).map((ev) => {
      const st = ev.days && ev.days[date] && ev.days[date].status;
      return `<i class="dot dot-${ev.category}${st && st.kind === 'short' ? ' dot-short' : ''}"></i>`;
    }).join('') + (items.length > max ? `<span class="cell-more">+${items.length - max}</span>` : '');
    frame.appendChild(dots);
    cell.setAttribute('aria-label', `${Fmt.shortDate(date)} ${items.length} 項活動`);
  }

  function markSelected() {
    cells.forEach((set, date) => set.forEach((c) => c.classList.toggle('is-selected', state.view === 'month' && date === state.selected)));
  }

  function onDateClick(date) {
    if (state.view === 'year') { state.selected = date; state.anchor = date; switchView('month'); return; }
    state.selected = date;
    markSelected();
    renderPanel();
    el.panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ---------- 卡片 ----------

  function cardHtml(ev, date, compact) {
    const meta = [Fmt.cardTime(ev, date), ev.location].filter(Boolean);
    const st = ev.days && ev.days[date] && ev.days[date].status;
    return `
      <a class="ev-card cat-line-${Fmt.esc(ev.category)}${compact ? ' is-compact' : ''}" href="#/r/${encodeURIComponent(state.region)}/e/${encodeURIComponent(ev.id)}?date=${date}">
        <span class="card-main">
          <span class="tags">${ev.assigned ? '<span class="unit-tag is-fentan">分壇分配</span>' : ''}<span class="cat-tag cat-${Fmt.esc(ev.category)}">${Fmt.esc(Fmt.catLabel(ev.category))}</span></span>
          <span class="card-title">${Fmt.esc(ev.name)}</span>
          ${meta.length ? `<span class="card-meta">${meta.map(Fmt.esc).join('・')}</span>` : ''}
        </span>
        ${Fmt.statusBadge(st)}
        <span class="card-go" aria-hidden="true">›</span>
      </a>`;
  }

  function renderPanel() {
    if (state.view !== 'month' || !state.selected) return;
    const date = state.selected;
    const head = `<h2 class="panel-date">${Number(date.slice(5, 7))} 月 ${Number(date.slice(8, 10))} 日（${Fmt.weekday(date)}）<span class="panel-lunar">農曆${LunarUtil.lunarOf(date).full}</span></h2>`;
    const items = dayMap.get(date) || [];
    el.panel.innerHTML = head + (state.loading ? '<p class="panel-empty">載入中⋯</p>'
      : items.length ? `<div class="card-list">${items.map((ev) => cardHtml(ev, date)).join('')}</div>` : '<p class="panel-empty">這天沒有活動</p>');
  }

  function renderList() {
    if (state.view === 'week') renderWeek();
    else if (state.view === 'recent') renderRecent();
    else renderPanel();
  }

  function dayRow(date, content, extra) {
    const l = LunarUtil.lunarOf(date);
    const isToday = date === state.today;
    return `
      <li class="week-day${isToday ? ' is-today' : ''}${extra || ''}">
        <div class="week-date">
          <span class="week-wd">${isToday ? '今天' : '週' + Fmt.weekday(date)}</span>
          <span class="week-md">${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}</span>
          <span class="week-lunar${l.isFirst || l.isFifteenth ? ' is-hl' : ''}">${l.full}</span>
        </div>
        <div class="week-items">${content}</div>
      </li>`;
  }

  function renderRecent() {
    if (state.loading) { el.week.innerHTML = '<p class="panel-empty">載入中⋯</p>'; return; }
    const dates = Fmt.datesBetween(state.range.from, state.range.to).filter((d) => (dayMap.get(d) || []).length);
    el.week.innerHTML = dates.length
      ? `<ol class="week-list">${dates.map((d) => dayRow(d, dayMap.get(d).map((ev) => cardHtml(ev, d, true)).join(''))).join('')}</ol>`
      : '<p class="panel-empty">近一個月沒有活動</p>';
  }

  function renderWeek() {
    const from = weekStart(state.anchor);
    el.week.innerHTML = `<ol class="week-list">${Fmt.datesBetween(from, Fmt.addDays(from, 6)).map((d) => {
      const items = dayMap.get(d) || [];
      const content = state.loading ? '<p class="week-empty">載入中⋯</p>' : items.length ? items.map((ev) => cardHtml(ev, d, true)).join('') : '<p class="week-empty">沒有活動</p>';
      return dayRow(d, content, d < state.today ? ' is-past' : '');
    }).join('')}</ol>`;
  }

  // ---------- 狀態列 ----------

  function showStatus(kind, message) {
    el.status.hidden = false;
    el.status.className = 'status status-' + kind;
    if (kind === 'loading') el.status.innerHTML = '<span>載入中⋯</span>';
    else if (kind === 'refreshing') el.status.innerHTML = '<span>更新中⋯（先顯示上次的資料）</span>';
    else {
      el.status.innerHTML = `<span>${Fmt.esc(message)}</span><button type="button" class="btn btn-small">重試</button>`;
      el.status.querySelector('button').addEventListener('click', refresh);
    }
  }
  function hideStatus() { el.status.hidden = true; }

  function onShow() { if (!isListView()) calendar.updateSize(); }

  window.CalendarPage = { init, setRegion, refresh, onShow, today: () => state.today, region: () => state.region };
})();
