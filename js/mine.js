// 查我的報名（#/r/<區>/mine，規格第 6 節）：輸入名字（完全相同才算），列出今天起的報名，可以取消、改期。
// 活動當天和之後不能自己取消、改期。名字放在 POST 內容，不放網址；這支手機記住上次查的名字。
(function () {
  'use strict';

  const NAME_KEY = 'region-signup:mine-name';
  let token = 0;
  const st = { region: '', name: '', items: null };

  const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

  function savedName() {
    try { return localStorage.getItem(NAME_KEY) || ''; } catch (e) { return ''; }
  }

  function busy(on, text) {
    const box = document.getElementById('busy');
    box.hidden = !on;
    box.querySelector('.busy-text').textContent = text || '';
  }

  function render(view, notice) {
    const list = st.items;
    view.innerHTML = `
      <h1 class="admin-title">查我的報名</h1>
      ${notice || ''}
      <form class="mine-form" novalidate>
        <label class="form-row"><span>名字（要和報名時一樣）</span>
          <span class="name-row"><input class="input" name="name" maxlength="20" value="${Fmt.esc(st.name)}" placeholder="例：王小明"><button type="submit" class="btn btn-primary">查詢</button></span></label>
      </form>
      ${list === null ? '' : list.length ? `<ul class="mine-list">${list.map((it) => `
        <li class="mine-item" data-id="${Fmt.esc(it.id)}">
          <div><strong>${Fmt.esc(Fmt.shortDate(it.date))}</strong>　${Fmt.esc(it.eventName)}</div>
          <div class="card-meta">${Fmt.esc([it.position, it.startTime, it.location].filter(Boolean).join('・'))}</div>
          ${it.canChange ? `<div class="mine-actions"><button type="button" class="btn btn-small" data-act="move">改期</button><button type="button" class="btn btn-small btn-quiet-danger" data-act="cancel">取消</button></div><div class="mine-move" hidden></div>`
            : '<p class="hint">今天的活動不能自己取消或改期，請聯絡區管理者。</p>'}
        </li>`).join('')}</ul>` : `<p class="panel-empty">「${Fmt.esc(st.name)}」今天起沒有報名</p>`}
      <a class="btn btn-block back-btn" href="#/r/${encodeURIComponent(st.region)}">‹ 回${Fmt.esc(st.region)}行事曆</a>`;
    bind(view);
  }

  async function search(view, notice) {
    if (!st.name) { st.items = null; render(view, notice); return; }
    busy(true, '查詢中⋯');
    try {
      const res = await Api.mySignups(st.region, st.name);
      st.items = res.items;
      try { localStorage.setItem(NAME_KEY, st.name); } catch (e) { /* 不記住 */ }
      busy(false);
      render(view, notice);
    } catch (err) {
      busy(false);
      render(view, `<div class="notice notice-error"><p>${Fmt.esc(err.message)}</p></div>`);
    }
  }

  async function openMove(view, li, it) {
    const box = li.querySelector('.mine-move');
    box.hidden = false;
    box.innerHTML = '<p class="panel-empty">載入中⋯</p>';
    try {
      const data = await Api.getEvent(st.region, it.eventId);
      const dates = data.days.filter((d) => d.date > data.today);
      box.innerHTML = `
        <div class="form-row-pair">
          <label><span>改到哪一天</span><select class="input" data-f="date">${dates.map((d) => `<option value="${d.date}"${d.date === it.date ? ' selected' : ''}>${Fmt.esc(Fmt.shortDate(d.date))}　${Fmt.esc(d.status.label)}</option>`).join('')}</select></label>
          <label><span>了愿項目</span><select class="input" data-f="pos">${data.event.positions.map((p) => `<option value="${Fmt.esc(p.id)}"${p.id === it.positionId ? ' selected' : ''}>${Fmt.esc(p.name)}</option>`).join('')}</select></label>
        </div>
        <button type="button" class="btn btn-primary btn-block" data-act="move-ok">確定改期</button>`;
      box.querySelector('[data-act="move-ok"]').addEventListener('click', async () => {
        const date = box.querySelector('[data-f="date"]').value;
        const positionId = box.querySelector('[data-f="pos"]').value;
        const pos = data.event.positions.find((p) => p.id === positionId);
        if (!window.confirm(`確定改期？\n\n${st.name}：${it.eventName}\n${md(it.date)} ${it.position} → ${md(date)} ${pos.name}`)) return;
        busy(true, '改期中⋯');
        try {
          await Api.reschedule({ region: st.region, signupId: it.id, date, positionId });
          busy(false);
          CalendarPage.refresh();
          search(view, `<div class="notice notice-success"><p>已改到 ${Fmt.esc(md(date))}（${Fmt.esc(pos.name)}）</p></div>`);
        } catch (err) {
          busy(false);
          box.insertAdjacentHTML('afterbegin', `<p class="form-error">${Fmt.esc(err.message)}${err.details && err.details.length ? '：' + err.details.map((d) => Fmt.esc(d.reason)).join('；') : ''}</p>`);
        }
      });
    } catch (err) {
      box.innerHTML = `<p class="form-error">${Fmt.esc(err.message)}</p>`;
    }
  }

  function bind(view) {
    view.querySelector('.mine-form').addEventListener('submit', (e) => {
      e.preventDefault();
      st.name = e.target.name.value.replace(/[\s　]/g, '');
      search(view);
    });
    view.querySelectorAll('.mine-item').forEach((li) => li.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const it = st.items.find((x) => x.id === li.dataset.id);
      if (b.dataset.act === 'move') openMove(view, li, it);
      if (b.dataset.act === 'cancel') {
        if (!window.confirm(`確定取消？\n\n${st.name}：${it.eventName}\n${md(it.date)} ${it.position}`)) return;
        busy(true, '取消中⋯');
        try {
          await Api.cancel(st.region, it.id);
          busy(false);
          CalendarPage.refresh();
          search(view, '<div class="notice notice-success"><p>已取消</p></div>');
        } catch (err) {
          busy(false);
          window.alert(err.message);
        }
      }
    }));
  }

  function show(view, region) {
    ++token;
    st.region = region;
    st.name = st.name || savedName();
    st.items = null;
    if (st.name) search(view);
    else render(view);
  }

  window.MinePage = { show };
})();
