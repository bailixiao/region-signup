// 管理後台（#/admin，規格第 4、9 節）。
//   區管理者：自己區的活動（新增／修改／另存新的／刪除）、名單（取消、改期、幫人報名）、操作紀錄。
//   分壇總管理者：開設區、設定區管理者密碼、開放／測試；也可以管理任何一區。
(function () {
  'use strict';

  let view = null;
  const st = { events: null, filterPast: false };

  const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  const enc = encodeURIComponent;

  function busy(on, text) {
    const box = document.getElementById('busy');
    box.hidden = !on;
    box.querySelector('.busy-text').textContent = text || '處理中⋯';
  }

  function failTo(err, retry) {
    busy(false);
    if (err.code === 'UNAUTHORIZED') { renderLogin(err.message); return; }
    view.innerHTML = `<div class="notice notice-error"><p>${Fmt.esc(err.message || '發生錯誤')}</p></div><button type="button" class="btn">重試</button>`;
    view.querySelector('button').addEventListener('click', retry);
  }

  function head(region, active) {
    const who = Api.who();
    const tab = (hash, label, key) => `<a class="admin-tab${active === key ? ' is-active' : ''}" href="${hash}">${label}</a>`;
    const base = `#/admin/r/${enc(region || '')}`;
    return `
      <div class="admin-head">
        <h1 class="admin-title">管理後台${region ? '・' + Fmt.esc(region) : ''}</h1>
        <button type="button" class="link-btn" data-act="logout">登出</button>
      </div>
      <p class="muted admin-who">登入：${Fmt.esc(who.account)}</p>
      <nav class="admin-tabs">
        ${who.role === 'super' ? tab('#/admin/regions', '區', 'regions') : ''}
        ${region ? tab(base, '活動', 'events') + tab(base + '/new', '＋ 新增區活動', 'new') + tab(base + '/log', '操作紀錄', 'log') : ''}
      </nav>`;
  }

  function bindHead() {
    const b = view.querySelector('[data-act="logout"]');
    if (b) b.addEventListener('click', () => { Api.adminLogout(); renderLogin(); });
  }

  // ---------- 路由 ----------

  function show(el, sub) {
    view = el;
    const who = Api.who();
    if (!who) return renderLogin();
    const parts = (sub || '').split('/').map(decodeURIComponent);
    if (parts[0] === 'regions' && who.role === 'super') return renderRegions();
    if (parts[0] === 'r' && parts[1]) {
      const region = parts[1];
      if (who.role !== 'super' && who.account !== region) { location.hash = '#/admin/r/' + enc(who.account); return; }
      if (parts[2] === 'new') return renderForm(region, null, 'new');
      if ((parts[2] === 'edit' || parts[2] === 'copy') && parts[3]) return withEvent(region, parts[3], (ev) => renderForm(region, ev, parts[2]));
      if (parts[2] === 'roster' && parts[3]) return renderRoster(region, parts[3]);
      if (parts[2] === 'log') return renderLog(region);
      return renderEvents(region);
    }
    location.hash = who.role === 'super' ? '#/admin/regions' : '#/admin/r/' + enc(who.account);
  }

  // ---------- 登入 ----------

  async function renderLogin(message) {
    view.innerHTML = '<p class="panel-empty">載入中⋯</p>';
    let accounts = [window.SITE.superAccount];
    try { accounts = (await Api.loginAccounts()).accounts; } catch (e) { /* 讀不到：只列總管理者 */ }
    let last = '';
    try { last = localStorage.getItem('region-signup:last-account') || ''; } catch (e) { /* 忽略 */ }
    view.innerHTML = `
      <form class="admin-login" autocomplete="off">
        <div class="login-head"><img class="login-logo" src="icons/icon-192.png" alt="" width="72" height="72"><h1 class="login-title">管理後台</h1><p class="login-sub">${Fmt.esc(window.SITE.name)}</p></div>
        ${message ? `<p class="form-error">${Fmt.esc(message)}</p>` : ''}
        <label class="login-field"><span>帳號</span><select class="input login-input" name="account">${accounts.map((a) => `<option${a === last ? ' selected' : ''}>${Fmt.esc(a)}</option>`).join('')}</select></label>
        <label class="login-field"><span>密碼</span><span class="login-pw"><input class="input login-input" type="password" name="password" required autocomplete="current-password"><button type="button" class="login-eye">顯示</button></span></label>
        <p class="form-error" data-err hidden></p>
        <button type="submit" class="btn btn-primary btn-block login-submit">登入</button>
        <p class="login-foot">家人們報名不用登入</p>
      </form>`;
    const form = view.querySelector('form');
    form.querySelector('.login-eye').addEventListener('click', (e) => {
      const on = form.password.type === 'password';
      form.password.type = on ? 'text' : 'password';
      e.currentTarget.textContent = on ? '隱藏' : '顯示';
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = form.querySelector('[data-err]');
      err.hidden = true;
      busy(true, '登入中⋯');
      try {
        await Api.adminLogin(form.account.value, form.password.value);
        try { localStorage.setItem('region-signup:last-account', form.account.value); } catch (x) { /* 忽略 */ }
        busy(false);
        show(view, location.hash.replace(/^#\/admin\/?/, ''));
      } catch (x) {
        busy(false);
        err.textContent = x.message;
        err.hidden = false;
      }
    });
  }

  // ---------- 分壇總管理者：區 ----------

  async function renderRegions() {
    view.innerHTML = head('', 'regions') + '<p class="panel-empty">載入中⋯</p>';
    bindHead();
    let data;
    try { data = await Api.admin('superRegions'); } catch (err) { return failTo(err, renderRegions); }
    const byName = new Map(data.regions.map((r) => [r.name, r]));
    view.innerHTML = head('', 'regions') + `
      <h2 class="admin-sub">各區</h2>
      <p class="hint">開設一區要設定區管理者的密碼（至少 6 個字，請自己輸入、交給該區的管理者）。「開放」：家人看得到、分壇行事曆會讀；「測試」：隱藏，只有知道網址的人能打開。測試區永遠是測試。</p>
      <ul class="admin-list">${(data.ownSystem || []).map((name) => `<li class="admin-row"><div class="admin-row-main"><strong>${Fmt.esc(name)}</strong><span class="card-meta">用自己的${Fmt.esc(name)}行事曆，不用在這裡開設（之後再搬過來）</span></div></li>`).join('')}${data.names.map((name) => {
        const r = byName.get(name);
        return `<li class="admin-row">
          <div class="admin-row-main"><strong>${Fmt.esc(name)}</strong>
            <span class="card-meta">${r ? `${Fmt.esc(r.status)}${r.hasPassword ? '・已設密碼' : '・沒有密碼'}` : '還沒開設'}</span></div>
          <div class="admin-row-actions">
            ${r ? `<a class="btn btn-small" href="#/admin/r/${enc(name)}">管理</a><a class="btn btn-small" href="#/r/${enc(name)}">打開</a>` : ''}
            <button type="button" class="btn btn-small" data-edit="${Fmt.esc(name)}">${r ? '設定' : '開設'}</button>
          </div>
          <form class="region-form" data-form="${Fmt.esc(name)}" hidden>
            ${name === window.SITE.testRegion ? '<p class="hint">測試區只能是「測試」。</p>' : `<label class="radio-row"><input type="radio" name="status" value="開放"${r && r.status === '開放' ? ' checked' : ''}> 開放</label>
            <label class="radio-row"><input type="radio" name="status" value="測試"${!r || r.status !== '開放' ? ' checked' : ''}> 測試（隱藏）</label>`}
            <label class="form-row"><span>${r ? '新的管理者密碼（不改就留空）' : '管理者密碼'}</span><input class="input" type="password" name="password" autocomplete="new-password" minlength="6"></label>
            <p class="form-error" hidden></p>
            <button type="submit" class="btn btn-primary">儲存</button>
          </form>
        </li>`;
      }).join('')}</ul>`;
    bindHead();
    view.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
      const f = view.querySelector(`[data-form="${b.dataset.edit}"]`);
      f.hidden = !f.hidden;
    }));
    view.querySelectorAll('.region-form').forEach((f) => f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = f.querySelector('.form-error');
      const status = f.status ? (f.querySelector('[name="status"]:checked') || {}).value : '測試';
      busy(true, '儲存中⋯');
      try {
        await Api.admin('superSaveRegion', { name: f.dataset.form, status, password: f.password.value });
        busy(false);
        renderRegions();
      } catch (x) {
        busy(false);
        if (x.code === 'UNAUTHORIZED') return renderLogin(x.message);
        err.textContent = x.message;
        err.hidden = false;
      }
    }));
  }

  // ---------- 區：活動列表 ----------

  async function loadEvents(region) {
    st.events = { region, list: (await Api.admin('adminEvents', { region })).events };
    return st.events.list;
  }

  function withEvent(region, id, fn) {
    const go = async () => {
      try {
        const list = st.events && st.events.region === region ? st.events.list : await loadEvents(region);
        const ev = list.find((x) => x.id === id);
        if (!ev) { view.innerHTML = head(region, '') + '<div class="notice notice-error"><p>找不到這個活動，可能已經刪除</p></div>'; bindHead(); return; }
        fn(ev);
      } catch (err) { failTo(err, go); }
    };
    go();
  }

  async function renderEvents(region) {
    view.innerHTML = head(region, 'events') + '<p class="panel-empty">載入中⋯</p>';
    bindHead();
    let list;
    try { list = await loadEvents(region); } catch (err) { return failTo(err, () => renderEvents(region)); }
    const today = CalendarPage.today();
    const draw = () => {
      const shown = list.filter((e) => (st.filterPast ? e.end < today : e.end >= today));
      if (st.filterPast) shown.reverse();
      view.innerHTML = head(region, 'events') + `
        <p class="hint">「＋ 新增區活動」是<strong>區自己的活動</strong>。標「分壇分配」的是分壇派給本區的勤務，這裡只管報名（名單、幫人報名、取消、改期），內容由分壇在分壇行事曆修改。</p>
        <div class="admin-actions">
          <a class="btn btn-primary" href="#/admin/r/${enc(region)}/new">＋ 新增區活動</a>
          <a class="btn" href="#/r/${enc(region)}">看家人的畫面</a>
        </div>
        <div class="seg" role="group"><button type="button" data-past="0" class="${st.filterPast ? '' : 'is-active'}">今天起</button><button type="button" data-past="1" class="${st.filterPast ? 'is-active' : ''}">已過去的</button></div>
        ${shown.length ? `<ul class="admin-list">${shown.map((e) => `
          <li class="admin-row">
            <div class="admin-row-main">
              <span class="admin-row-date">${Fmt.esc(e.start === e.end ? Fmt.shortDate(e.start) : Fmt.shortDate(e.start) + ' – ' + Fmt.shortDate(e.end))}</span>
              <span class="tags">${e.assigned ? '<span class="unit-tag is-fentan">分壇分配</span>' : ''}<span class="cat-tag cat-${Fmt.esc(e.category)}">${Fmt.esc(Fmt.catLabel(e.category))}</span>${e.mode === '公告型' ? '<span class="unit-tag">公告</span>' : ''}</span>
              <strong>${Fmt.esc(e.name)}</strong>
              <span class="card-meta">${Fmt.esc([Fmt.timeRange(e), e.location].filter(Boolean).join('・'))}${e.mode === '報名型' ? `　報名 ${e.signups} 筆` : ''}</span>
            </div>
            <div class="admin-row-actions">
              ${e.mode === '報名型' ? `<a class="btn btn-small" href="#/admin/r/${enc(region)}/roster/${enc(e.id)}">名單</a>` : ''}
              ${e.assigned ? '<span class="muted assigned-note">分壇在分壇行事曆修改</span>' : `<a class="btn btn-small" href="#/admin/r/${enc(region)}/edit/${enc(e.id)}">修改</a>
              <a class="btn btn-small" href="#/admin/r/${enc(region)}/copy/${enc(e.id)}">另存新的</a>
              <button type="button" class="btn btn-small btn-quiet-danger" data-del="${Fmt.esc(e.id)}">刪除</button>`}
            </div>
          </li>`).join('')}</ul>` : `<p class="panel-empty">${st.filterPast ? '沒有已過去的活動' : '今天起沒有活動，按「＋ 新增活動」開始'}</p>`}`;
      bindHead();
      view.querySelectorAll('[data-past]').forEach((b) => b.addEventListener('click', () => { st.filterPast = b.dataset.past === '1'; draw(); }));
      view.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
        const ev = list.find((x) => x.id === b.dataset.del);
        if (!window.confirm(`確定要刪除「${ev.name}」（${md(ev.start)}）嗎？刪除後不能還原。`)) return;
        busy(true, '刪除中⋯');
        try {
          await Api.admin('adminDeleteEvent', { region, id: ev.id });
          busy(false);
          list = list.filter((x) => x.id !== ev.id);
          st.events = { region, list };
          CalendarPage.refresh();
          draw();
        } catch (err) {
          busy(false);
          if (err.code === 'UNAUTHORIZED') return renderLogin(err.message);
          window.alert(err.message);
        }
      }));
    };
    draw();
  }

  // ---------- 區：新增／修改／另存新的 ----------

  function renderForm(region, src, mode) {
    const ev = src ? JSON.parse(JSON.stringify(src)) : { category: '勤務', mode: '報名型', start: CalendarPage.today(), positions: [{ name: '', min: null, max: null }] };
    if (mode === 'copy') ev.positions = ev.positions.map((p) => ({ name: p.name, min: p.min, max: p.max }));
    const title = mode === 'edit' ? '修改區活動' : mode === 'copy' ? '另存成新的區活動' : '新增區活動';
    const opt = (list, v, label) => list.map((x) => `<option value="${Fmt.esc(x)}"${x === v ? ' selected' : ''}>${Fmt.esc(label ? label(x) : x)}</option>`).join('');
    const posRow = (p, i) => `
      <div class="pos-row" data-i="${i}">
        <input type="hidden" name="pid" value="${Fmt.esc(p.id || '')}">
        <label><span>了愿項目</span><input class="input" name="pname" maxlength="20" value="${Fmt.esc(p.name || '')}" placeholder="例：打掃"></label>
        <label><span>最少</span><input class="input" name="pmin" inputmode="numeric" value="${p.min === null || p.min === undefined ? '' : p.min}" placeholder="空白"></label>
        <label><span>最多</span><input class="input" name="pmax" inputmode="numeric" value="${p.max === null || p.max === undefined ? '' : p.max}" placeholder="不限"></label>
        <button type="button" class="btn btn-small btn-quiet-danger" data-rm="${i}" aria-label="拿掉這個項目">✕</button>
      </div>`;
    view.innerHTML = head(region, mode === 'new' ? 'new' : '') + `
      <form class="admin-form" novalidate>
        <h2 class="admin-sub">${title}</h2>
        ${mode === 'copy' ? `<p class="hint">從「${Fmt.esc(src.name)}」複製過來，改好日期再存，原本那筆不會變。</p>` : ''}
        <fieldset class="form-block"><legend>活動</legend>
          <div class="form-row-pair">
            <label><span>類別</span><select class="input" name="category">${opt(window.SITE.categories, ev.category, Fmt.catLabel)}</select></label>
            <label><span>要不要報名</span><select class="input" name="mode">${opt(window.SITE.modes, ev.mode, (m) => (m === '報名型' ? '要報名' : '公告（不用報名）'))}</select></label>
          </div>
          <label class="form-row"><span>活動名稱</span><input class="input" name="name" maxlength="60" value="${Fmt.esc(ev.name || '')}" placeholder="例：區中心打掃"></label>
          <div class="form-row-pair">
            <label><span>開始日期</span><input class="input" type="date" name="start" value="${Fmt.esc(ev.start || '')}"></label>
            <label><span>結束日期（一天的留空）</span><input class="input" type="date" name="end" value="${ev.end && ev.end !== ev.start ? Fmt.esc(ev.end) : ''}"></label>
          </div>
          <div class="form-row-pair">
            <label><span>開始時間（可以不填）</span><input class="input" type="time" name="startTime" value="${Fmt.esc(ev.startTime || '')}"></label>
            <label><span>結束時間（可以不填）</span><input class="input" type="time" name="endTime" value="${Fmt.esc(ev.endTime || '')}"></label>
          </div>
          <label class="form-row"><span>地點</span><input class="input" name="location" maxlength="60" value="${Fmt.esc(ev.location || '')}"></label>
          <label class="form-row"><span>說明（可以不填）</span><textarea class="input textarea" name="note" rows="3" maxlength="1000">${Fmt.esc(ev.note || '')}</textarea></label>
        </fieldset>
        <fieldset class="form-block" data-positions><legend>了愿項目與名額</legend>
          <p class="hint">「最少」留空：勤務預設 2 人，道務、教育不算缺人。「最多」留空＝不限，到了就額滿。</p>
          <div class="pos-list">${(ev.positions.length ? ev.positions : [{}]).map(posRow).join('')}</div>
          <button type="button" class="btn" data-act="add-pos">＋ 再加一個了愿項目</button>
        </fieldset>
        <p class="form-error" hidden></p>
        <button type="submit" class="btn btn-primary btn-block">${mode === 'edit' ? '儲存修改' : '新增'}</button>
        <a class="btn btn-block back-btn" href="#/admin/r/${enc(region)}">取消</a>
      </form>`;
    bindHead();
    const form = view.querySelector('form');
    const posBox = form.querySelector('[data-positions]');
    const syncMode = () => { posBox.hidden = form.mode.value !== '報名型'; };
    syncMode();
    form.mode.addEventListener('change', syncMode);
    form.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.act === 'add-pos') {
        const list = form.querySelector('.pos-list');
        if (list.children.length >= 10) return;
        list.insertAdjacentHTML('beforeend', posRow({}, list.children.length));
      }
      if (b.dataset.rm !== undefined) b.closest('.pos-row').remove();
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = form.querySelector('.form-error');
      const val = (k) => form[k].value.trim();
      const positions = [...form.querySelectorAll('.pos-row')].map((r) => ({
        id: r.querySelector('[name="pid"]').value || undefined,
        name: r.querySelector('[name="pname"]').value.trim(),
        min: r.querySelector('[name="pmin"]').value.trim(),
        max: r.querySelector('[name="pmax"]').value.trim()
      })).filter((p) => p.name || p.min || p.max);
      const data = { category: val('category'), mode: val('mode'), name: val('name'), start: val('start'), end: val('end') || val('start'), startTime: val('startTime'), endTime: val('endTime'), location: val('location'), note: form.note.value, positions };
      if (mode === 'edit') data.id = src.id;
      busy(true, '儲存中⋯');
      try {
        await Api.admin('adminSaveEvent', { region, event: data });
        busy(false);
        st.events = null;
        CalendarPage.refresh();
        location.hash = '#/admin/r/' + enc(region);
      } catch (x) {
        busy(false);
        if (x.code === 'UNAUTHORIZED') return renderLogin(x.message);
        err.textContent = x.message;
        err.hidden = false;
        err.scrollIntoView({ block: 'center' });
      }
    });
  }

  // ---------- 區：名單（取消、改期、幫人報名） ----------

  async function renderRoster(region, id, notice) {
    view.innerHTML = head(region, '') + '<p class="panel-empty">載入中⋯</p>';
    bindHead();
    let data;
    try { data = await Api.admin('adminRoster', { region, id }); } catch (err) { return failTo(err, () => renderRoster(region, id)); }
    const ev = data.event;
    const dayHtml = (d) => `
      <section class="roster-admin">
        <h3 class="roster-day">${Fmt.esc(Fmt.shortDate(d.date))}${Fmt.statusBadge(d.status)}</h3>
        ${d.positions.map((p) => `
          <div class="roster-pos-admin"><span class="roster-pos">${Fmt.esc(p.name)}</span><span class="muted">${p.count}${p.max !== null ? '／' + p.max : ''} 人</span>
            <ul class="roster-people">${p.people.map((x) => `<li><span>${Fmt.esc(x.name)}${x.by === '管理者' ? '<small>（管理者幫報）</small>' : ''}</span>
              <span class="roster-actions"><button type="button" class="btn btn-small" data-move="${Fmt.esc(x.id)}" data-name="${Fmt.esc(x.name)}" data-date="${d.date}" data-pos="${Fmt.esc(p.id)}">改期</button><button type="button" class="btn btn-small btn-quiet-danger" data-cancel="${Fmt.esc(x.id)}" data-name="${Fmt.esc(x.name)}" data-date="${d.date}">取消</button></span></li>`).join('') || '<li class="muted">還沒有人</li>'}</ul>
          </div>`).join('')}
      </section>`;
    const opts = (list, v, f) => list.map((x) => `<option value="${Fmt.esc(f(x)[0])}"${f(x)[0] === v ? ' selected' : ''}>${Fmt.esc(f(x)[1])}</option>`).join('');
    view.innerHTML = head(region, '') + `
      <h2 class="admin-sub">名單：${Fmt.esc(ev.name)}</h2>
      ${notice || ''}
      <details class="form-block admin-add"><summary>＋ 幫人報名（不受當天、名額、重複限制）</summary>
        <form class="admin-form" data-add novalidate>
          <div class="form-row-pair">
            <label><span>日期</span><select class="input" name="date">${opts(data.days, data.today, (d) => [d.date, Fmt.shortDate(d.date)])}</select></label>
            <label><span>了愿項目</span><select class="input" name="pos">${opts(ev.positions, '', (p) => [p.id, p.name])}</select></label>
          </div>
          <label class="form-row"><span>名字（好幾位用、或空白隔開）</span><input class="input" name="names" placeholder="例：王小明、測試甲"></label>
          <p class="form-error" hidden></p>
          <button type="submit" class="btn btn-primary">報名</button>
        </form>
      </details>
      ${data.days.map(dayHtml).join('')}
      <a class="btn btn-block back-btn" href="#/admin/r/${enc(region)}">‹ 回活動列表</a>`;
    bindHead();
    const addForm = view.querySelector('[data-add]');
    addForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const names = addForm.names.value.split(/[、,，\s　]+/).filter(Boolean);
      busy(true, '報名中⋯');
      try {
        const res = await Api.admin('adminSignup', { region, eventId: ev.id, dates: [addForm.date.value], positionId: addForm.pos.value, names });
        busy(false);
        CalendarPage.refresh();
        renderRoster(region, id, `<div class="notice notice-success"><p>已幫 ${Fmt.esc(names.join('、'))} 報名</p>${res.warnings.length ? `<p>⚠ 提醒：${res.warnings.map((w) => Fmt.esc(w.reason)).join('；')}</p>` : ''}</div>`);
      } catch (x) {
        busy(false);
        if (x.code === 'UNAUTHORIZED') return renderLogin(x.message);
        const err = addForm.querySelector('.form-error');
        err.textContent = x.message;
        err.hidden = false;
      }
    });
    view.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', async () => {
      if (!window.confirm(`確定取消 ${b.dataset.name}（${md(b.dataset.date)}）的報名？`)) return;
      busy(true, '取消中⋯');
      try {
        await Api.admin('adminCancel', { region, signupId: b.dataset.cancel });
        busy(false);
        CalendarPage.refresh();
        renderRoster(region, id, `<div class="notice notice-success"><p>已取消 ${Fmt.esc(b.dataset.name)}（${md(b.dataset.date)}）</p></div>`);
      } catch (x) { busy(false); if (x.code === 'UNAUTHORIZED') return renderLogin(x.message); window.alert(x.message); }
    }));
    view.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', () => {
      const li = b.closest('li');
      if (li.querySelector('.roster-move')) return;
      li.insertAdjacentHTML('beforeend', `<div class="roster-move form-row-pair">
        <label><span>改到</span><select class="input" data-f="date">${opts(data.days, b.dataset.date, (d) => [d.date, Fmt.shortDate(d.date)])}</select></label>
        <label><span>了愿項目</span><select class="input" data-f="pos">${opts(ev.positions, b.dataset.pos, (p) => [p.id, p.name])}</select></label>
        <button type="button" class="btn btn-primary" data-ok>確定改期</button></div>`);
      li.querySelector('[data-ok]').addEventListener('click', async () => {
        busy(true, '改期中⋯');
        try {
          const res = await Api.admin('adminReschedule', { region, signupId: b.dataset.move, date: li.querySelector('[data-f="date"]').value, positionId: li.querySelector('[data-f="pos"]').value });
          busy(false);
          CalendarPage.refresh();
          renderRoster(region, id, `<div class="notice notice-success"><p>已把 ${Fmt.esc(b.dataset.name)} 改到 ${md(res.signup.date)}（${Fmt.esc(res.signup.position)}）</p>${res.warnings.length ? `<p>⚠ 提醒：${res.warnings.map((w) => Fmt.esc(w.reason)).join('；')}</p>` : ''}</div>`);
        } catch (x) { busy(false); if (x.code === 'UNAUTHORIZED') return renderLogin(x.message); window.alert(x.message); }
      });
    }));
  }

  // ---------- 區：操作紀錄 ----------

  async function renderLog(region) {
    view.innerHTML = head(region, 'log') + '<p class="panel-empty">載入中⋯</p>';
    bindHead();
    let data;
    try { data = await Api.admin('adminLog', { region }); } catch (err) { return failTo(err, () => renderLog(region)); }
    view.innerHTML = head(region, 'log') + (data.log.length ? `<ul class="log-list">${data.log.map((l) => `
      <li class="log-item"><div class="log-head"><strong>${Fmt.esc(l.action)}</strong><span class="muted">${Fmt.esc(l.time)}・${Fmt.esc(l.by)}</span></div><div>${Fmt.esc(l.text)}</div></li>`).join('')}</ul>` : '<p class="panel-empty">還沒有操作紀錄</p>');
    bindHead();
  }

  window.AdminPage = { show };
})();
