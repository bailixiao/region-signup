// 活動頁（#/r/<區>/e/<id>?date=，規格第 6、9 節）：資訊、每天的名單、報名表。
// 報名：選日期（多天的可以選好幾天）、選了愿項目、加名字（最多 10 人）→ 確認報名；有人報不了就整批不送，列出原因。
(function () {
  'use strict';

  let token = 0;
  const st = { region: '', data: null, date: '', dates: new Set(), positionId: '', names: [] };

  const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

  function dayOf(date) {
    return st.data.days.find((d) => d.date === date);
  }

  /** 這個項目在選的日期裡是不是已經滿了 */
  function fullOn(p, dates) {
    if (p.max === null) return false;
    return [...dates].some((d) => { const day = dayOf(d); const q = day && day.positions.find((x) => x.id === p.id); return q && q.count >= p.max; });
  }

  function rosterBlock(day) {
    return `<p class="roster-day"><strong>${Fmt.esc(Fmt.shortDate(day.date))}</strong>${Fmt.statusBadge(day.status)}</p>${Fmt.rosterHtml(day)}`;
  }

  function infoHtml() {
    const { event: ev, days } = st.data;
    const day = dayOf(st.date) || days[0];
    const others = days.filter((d) => d !== day && d.total > 0);
    const time = ev.start === ev.end ? Fmt.timeRange(ev) : [ev.startTime ? `第一天 ${ev.startTime} 開始` : '', ev.endTime ? `最後一天 ${ev.endTime} 結束` : ''].filter(Boolean).join('，');
    return `
      <div class="detail-head">
        <span class="tags">${ev.assigned ? '<span class="unit-tag is-fentan">分壇分配</span>' : ''}<span class="cat-tag cat-${Fmt.esc(ev.category)}">${Fmt.esc(Fmt.catLabel(ev.category))}</span>${ev.mode === '公告型' ? '<span class="unit-tag">公告</span>' : ''}</span>
        <h1 class="detail-title">${Fmt.esc(ev.name)}</h1>
      </div>
      <dl class="detail-info">
        <div><dt>日期</dt><dd>${ev.start === ev.end ? `${Fmt.esc(Fmt.rocDate(ev.start))}　<span class="muted">農曆${Fmt.esc(LunarUtil.lunarOf(ev.start).full)}</span>` : `${Fmt.esc(Fmt.rocDate(ev.start))} – ${Fmt.esc(Fmt.shortDate(ev.end))}，共 ${days.length} 天`}</dd></div>
        ${time ? `<div><dt>時間</dt><dd>${Fmt.esc(time)}</dd></div>` : ''}
        ${ev.location ? `<div><dt>地點</dt><dd>${Fmt.esc(ev.location)}</dd></div>` : ''}
      </dl>
      ${ev.assigned ? '<p class="hint">這是宏教分壇分配給本區的勤務，內容由分壇安排；報名後分壇就看得到名單。</p>' : ''}
      ${ev.note ? `<section class="detail-section"><h2>說明</h2><p class="detail-desc">${Fmt.esc(ev.note).replace(/\n/g, '<br>')}</p></section>` : ''}
      ${ev.mode === '報名型' ? `<section class="detail-section"><h2>報名名單</h2>${day ? rosterBlock(day) : ''}
        ${others.length ? `<details class="roster-more"><summary>其他 ${others.length} 天的名單</summary>${others.map(rosterBlock).join('')}</details>` : ''}</section>` : ''}`;
  }

  function formHtml() {
    const { event: ev, days, today } = st.data;
    if (ev.mode !== '報名型') return '';
    const open = days.filter((d) => d.date > today);
    if (!open.length) return '<section class="detail-section"><h2>報名</h2><p class="notice">已經過了報名時間（活動當天和之後不能自己報名，請聯絡區管理者）。</p></section>';
    const dateChoices = ev.start === ev.end ? '' : `
      <fieldset class="field"><legend><span class="step">1</span>選日期 <small>可以選好幾天</small></legend>
        <div class="choices choices-dates">${open.map((d) => `
          <label class="choice${st.dates.has(d.date) ? ' is-checked' : ''}"><input type="checkbox" data-date="${d.date}"${st.dates.has(d.date) ? ' checked' : ''}>
            <span class="choice-main">${Fmt.esc(md(d.date))}（${Fmt.esc(Fmt.weekday(d.date))}）</span><span class="choice-sub">${Fmt.esc(d.status.label)}</span></label>`).join('')}</div>
      </fieldset>`;
    const n = ev.start === ev.end ? 1 : 2;
    const posChoices = ev.positions.map((p) => {
      const full = fullOn(p, st.dates);
      const day = dayOf([...st.dates][0] || open[0].date);
      const q = day && day.positions.find((x) => x.id === p.id);
      const sub = st.dates.size === 1 && q ? `已報 ${q.count}${p.max !== null ? `／最多 ${p.max}` : ''} 人` : p.max !== null ? `最多 ${p.max} 人` : '不限人數';
      return `<label class="choice${st.positionId === p.id ? ' is-checked' : ''}${full ? ' is-disabled' : ''}"><input type="radio" name="pos" value="${Fmt.esc(p.id)}"${st.positionId === p.id ? ' checked' : ''}${full ? ' disabled' : ''}>
        <span class="choice-main">${Fmt.esc(p.name)}</span><span class="choice-sub">${full ? '額滿' : Fmt.esc(sub)}</span></label>`;
    }).join('');
    return `
      <section class="detail-section" id="signup"><h2>報名</h2>
        <form class="signup-form" novalidate>
          ${dateChoices}
          <fieldset class="field"><legend><span class="step">${n}</span>選了愿項目</legend><div class="choices">${posChoices}</div></fieldset>
          <fieldset class="field"><legend><span class="step">${n + 1}</span>填名字 <small>可以幫別人報，一次最多 10 位</small></legend>
            <div class="name-row"><input class="input" name="name" maxlength="20" placeholder="例：王小明" autocomplete="off"><button type="button" class="btn" data-act="add">＋ 加入</button></div>
            <ul class="name-list">${st.names.map((x, i) => `<li><span>${Fmt.esc(x)}</span><button type="button" class="link-btn" data-del="${i}">拿掉</button></li>`).join('')}</ul>
          </fieldset>
          <p class="form-error" hidden></p>
          <button type="submit" class="btn btn-primary btn-block">確認報名</button>
        </form>
        <p class="hint">要取消或改期，請到「查我的報名」。活動當天和之後不能自己報名、取消、改期，請聯絡區管理者。</p>
        <a class="btn btn-block" href="#/r/${encodeURIComponent(st.region)}/mine">查我的報名（取消／改期）</a>
      </section>`;
  }

  function render(view, notice) {
    view.innerHTML = (notice || '') + infoHtml() + formHtml() + `<a class="btn btn-block back-btn" href="#/r/${encodeURIComponent(st.region)}">‹ 回${Fmt.esc(st.region)}行事曆</a>`;
    bind(view);
  }

  function addName(form) {
    const input = form.name;
    const v = input.value.replace(/[\s　]/g, '');
    if (!v) return;
    if (st.names.length >= 10) return showError(form, '一次最多 10 位');
    if (st.names.indexOf(v) === -1) st.names.push(v);
    input.value = '';
    const view = form.closest('section').parentNode;
    render(view);
    view.querySelector('.signup-form').name.focus();
  }

  function showError(form, msg, details) {
    const box = form.querySelector('.form-error');
    box.innerHTML = Fmt.esc(msg) + (details && details.length ? `<ul>${details.map((d) => `<li>${Fmt.esc(d.name)}：${Fmt.esc(d.reason)}</li>`).join('')}</ul>` : '');
    box.hidden = false;
    box.scrollIntoView({ block: 'center' });
  }

  function bind(view) {
    const form = view.querySelector('.signup-form');
    if (!form) return;
    form.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.date) { if (t.checked) st.dates.add(t.dataset.date); else st.dates.delete(t.dataset.date); render(view); }
      if (t.name === 'pos') { st.positionId = t.value; render(view); }
    });
    form.name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addName(form); } });
    form.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.act === 'add') addName(form);
      if (b.dataset.del !== undefined) { st.names.splice(Number(b.dataset.del), 1); render(view); }
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (form.name.value.trim()) addName(form);
      const f = view.querySelector('.signup-form');
      if (!st.dates.size) return showError(f, '請選日期');
      if (!st.positionId) return showError(f, '請選了愿項目');
      if (!st.names.length) return showError(f, '請填名字，按「＋ 加入」');
      const ev = st.data.event;
      const pos = ev.positions.find((p) => p.id === st.positionId);
      const dates = [...st.dates].sort();
      if (!window.confirm(`確認報名？\n\n${ev.name}\n日期：${dates.map(md).join('、')}\n了愿項目：${pos.name}\n名字：${st.names.join('、')}`)) return;
      busy(true, '報名中⋯');
      try {
        const res = await Api.signup({ region: st.region, eventId: ev.id, dates, positionId: st.positionId, names: st.names });
        busy(false);
        const names = [...new Set(res.created.map((x) => x.name))];
        st.names = [];
        await reload(view, `<div class="notice notice-big" role="status"><p><strong>報名成功 🙏</strong>${Fmt.esc(names.join('、'))}：${Fmt.esc(dates.map(md).join('、'))}　${Fmt.esc(pos.name)}</p></div>`);
        CalendarPage.refresh();
        window.scrollTo(0, 0);
      } catch (err) {
        busy(false);
        showError(f, err.message, err.details);
      }
    });
  }

  function busy(on, text) {
    const box = document.getElementById('busy');
    box.hidden = !on;
    box.querySelector('.busy-text').textContent = text || '';
  }

  async function reload(view, notice) {
    const data = await Api.getEvent(st.region, st.data.event.id);
    st.data = data;
    render(view, notice);
  }

  async function show(view, region, id, date) {
    const t = ++token;
    view.innerHTML = '<p class="panel-empty">載入中⋯</p>';
    try {
      const data = await Api.getEvent(region, id);
      if (t !== token) return;
      Object.assign(st, { region, data, date: date || data.event.start, positionId: '', names: [] });
      const open = data.days.filter((d) => d.date > data.today).map((d) => d.date);
      st.dates = new Set(data.event.start === data.event.end ? open : open.indexOf(date) !== -1 ? [date] : []);
      if (data.event.positions.length === 1) st.positionId = data.event.positions[0].id;
      render(view);
    } catch (err) {
      if (t !== token) return;
      view.innerHTML = `<div class="notice notice-error"><p>${Fmt.esc(err.message || '無法載入')}</p></div><a class="btn btn-block back-btn" href="#/r/${encodeURIComponent(region)}">‹ 回行事曆</a>`;
    }
  }

  window.EventPage = { show };
})();
