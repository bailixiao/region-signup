// 每區一個 Durable Object 裡跑的部分：活動、報名、取消、改期、名單、操作紀錄（規格第 5、6 節）。
// call(body, who)：who＝null（家人）或 { role: 'super'|'region', region }（已由 registry 驗證過的管理者）。
// body.external：前門附上的「分壇分配」勤務（從分壇行事曆讀來，代號 F- 開頭，規格第 5-1 節）：只收報名，不能在這裡改內容。
import {
  AppError, cleanEvent, cleanName, dayCounts, dayStatus, datesBetween, sameName, str, taipeiDate, taipeiStamp, MAX_NAMES
} from './logic.js';

const LOG_KEEP = 2000;

function randomHex(bytes) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function createRegionApp(store, opts) {
  const now = opts.now || (() => Date.now());
  const region = opts.region;
  const today = () => taipeiDate(now());
  const newId = (prefix) => `${prefix}-${taipeiDate(now()).replace(/-/g, '')}-${randomHex(3)}`;
  /** 一直往上加的序號（存在資料裡，重開也接著算）：報名代號、操作紀錄照它排就是先後順序 */
  function seq() {
    const m = store.get('meta', 'seq') || { n: 0 };
    m.n += 1;
    store.put('meta', 'seq', m);
    return String(m.n).padStart(10, '0');
  }

  // ---------- 小工具 ----------

  function getEvent(id) {
    const ev = typeof id === 'string' ? store.get('events', id) : null;
    if (!ev) throw new AppError('NOT_FOUND', '找不到這個活動，可能已經刪除');
    return ev;
  }
  const signupsOf = (evId) => store.byK('signups', evId);
  const isAssigned = (id) => typeof id === 'string' && id.indexOf('F-') === 0;

  /** 區活動從資料庫找；分壇分配的從前門附上的 external 找 */
  function getEventAny(id, body) {
    if (!isAssigned(id)) return getEvent(id);
    const ev = (body && Array.isArray(body.external) ? body.external : []).find((x) => x.id === id);
    if (!ev) throw new AppError('NOT_FOUND', '找不到這個活動，可能分壇已經刪除或改了');
    return ev;
  }
  const allEvents = (body) => store.all('events').concat(body && Array.isArray(body.external) ? body.external : []);
  const valid = (list) => list.filter((s) => s.status === '有效');

  /** 操作紀錄：id 是序號（排序＝先後順序）；超過 LOG_KEEP＋200 筆時刪掉最舊的 200 筆 */
  function log(action, text, who) {
    const t = now();
    const id = seq();
    store.put('log', id, { id, time: taipeiStamp(t), action, text, by: who ? (who.role === 'super' ? '分壇總管理者' : '區管理者') : '家人' });
    if (store.count('log') > LOG_KEEP + 200) store.all('log').slice(0, 200).forEach((l) => store.del('log', l.id));
  }

  /** 一天的狀態與名單（名單只有名字；admin 時附報名代號、時間、誰報的） */
  function dayView(ev, list, date, admin) {
    const day = dayCounts(list, date);
    const out = { date, total: day.total, status: dayStatus(ev, day) };
    out.positions = ev.positions.map((p) => ({
      id: p.id, name: p.name, min: p.min, max: p.max, count: day.counts[p.id] || 0,
      people: list.filter((s) => s.status === '有效' && s.date === date && s.positionId === p.id)
        .map((s) => (admin ? { id: s.id, name: s.name, createdAt: s.createdAt, by: s.by } : { name: s.name }))
    }));
    return out;
  }

  function publicEvent(ev) {
    const { id, category, mode, name, start, end, startTime, endTime, location, note } = ev;
    return { id, assigned: isAssigned(id), category, mode, name, start, end, startTime, endTime, location, note, positions: ev.positions.map(({ id: pid, name: pn, min, max }) => ({ id: pid, name: pn, min, max })) };
  }

  function inRange(from, to, body) {
    return allEvents(body).filter((e) => e.start <= to && e.end >= from)
      .sort((a, b) => a.start.localeCompare(b.start) || (a.startTime || '').localeCompare(b.startTime || '') || a.name.localeCompare(b.name));
  }

  // ---------- 報名的檢查（家人與管理者共用；管理者不受當天、名額、重複限制，只回警告） ----------

  function checkSignup(ev, dates, positionId, names, who, ignoreId) {
    if (ev.mode !== '報名型') throw new AppError('BAD_REQUEST', '這個活動不用報名');
    const pos = ev.positions.find((p) => p.id === positionId);
    if (!pos) throw new AppError('BAD_REQUEST', '請選擇了愿項目');
    const ds = [...new Set(Array.isArray(dates) ? dates : [])];
    if (!ds.length) throw new AppError('BAD_REQUEST', '請選擇日期');
    ds.forEach((d) => { if (typeof d !== 'string' || d < ev.start || d > ev.end) throw new AppError('BAD_REQUEST', '日期不在活動期間'); });
    const ns = (Array.isArray(names) ? names : []).map(cleanName).filter(Boolean);
    if (!ns.length) throw new AppError('BAD_REQUEST', '請填名字');
    if (ns.length > MAX_NAMES) throw new AppError('BAD_REQUEST', `一次最多 ${MAX_NAMES} 個人`);
    ns.forEach((n) => { if (n.length > 20) throw new AppError('BAD_REQUEST', `名字「${n.slice(0, 20)}⋯」太長了`); });
    const problems = [];
    // 同一批裡名字相近的
    ns.forEach((n, i) => ns.slice(0, i).forEach((m) => { if (sameName(n, m)) problems.push({ name: n, reason: `和同一批的「${m}」名字相近，視為同一人` }); }));
    if (!who) ds.forEach((d) => { if (d <= today()) problems.push({ name: ns.join('、'), reason: `${d.slice(5).replace('-', '/')} 已經是當天或過去了，不能自己報名，請聯絡區管理者` }); });
    const list = valid(signupsOf(ev.id)).filter((s) => s.id !== ignoreId);
    ds.forEach((d) => {
      const count = list.filter((s) => s.date === d && s.positionId === pos.id).length;
      if (pos.max !== null && count + ns.length > pos.max) {
        problems.push({ name: ns.join('、'), reason: `${d.slice(5).replace('-', '/')} 的「${pos.name}」${count >= pos.max ? '已額滿' : `只剩 ${pos.max - count} 個名額`}` });
      }
      ns.forEach((n) => {
        const dup = list.find((s) => s.date === d && sameName(s.name, n));
        if (dup) problems.push({ name: n, reason: `${d.slice(5).replace('-', '/')} 已經有「${dup.name}」報了「${(ev.positions.find((p) => p.id === dup.positionId) || {}).name || ''}」` });
      });
    });
    return { pos, dates: ds.sort(), names: ns, problems };
  }

  function createSignups(ev, c, who) {
    const stamp = taipeiStamp(now());
    const created = [];
    store.tx(() => {
      c.dates.forEach((d) => c.names.forEach((n) => {
        const s = { id: `S-${seq()}-${randomHex(2)}`, eventId: ev.id, date: d, positionId: c.pos.id, name: n, status: '有效', createdAt: stamp, by: who ? '管理者' : '家人' };
        store.put('signups', s.id, s, ev.id);
        created.push(s);
      }));
    });
    log(who ? '管理者幫人報名' : '報名', `${ev.name}／${c.pos.name}／${c.dates.join('、')}：${c.names.join('、')}`, who);
    return created.map((s) => ({ id: s.id, date: s.date, name: s.name, position: c.pos.name }));
  }

  // ---------- 家人們 ----------

  const actions = {
    events(body) {
      return {
        today: today(),
        events: inRange(body.from, body.to, body).map((ev) => {
          const list = valid(signupsOf(ev.id));
          const days = {};
          datesBetween(ev.start > body.from ? ev.start : body.from, ev.end < body.to ? ev.end : body.to).forEach((d) => {
            const c = dayCounts(list, d);
            days[d] = { total: c.total, status: dayStatus(ev, c) };
          });
          return Object.assign(publicEvent(ev), { days });
        })
      };
    },

    event(body) {
      const ev = getEventAny(body.id, body);
      const list = signupsOf(ev.id);
      return { today: today(), event: publicEvent(ev), days: datesBetween(ev.start, ev.end).map((d) => dayView(ev, list, d, false)) };
    },

    signup(body, who) {
      const ev = getEventAny(body.eventId, body);
      const c = checkSignup(ev, body.dates, body.positionId, body.names, who);
      if (c.problems.length && !who) throw new AppError('BLOCKED', '有人報不了，這次都沒有送出', c.problems);
      return { created: createSignups(ev, c, who), warnings: c.problems };
    },

    mySignups(body) {
      const name = cleanName(body.name);
      if (!name) throw new AppError('BAD_REQUEST', '請填名字');
      const out = [];
      allEvents(body).forEach((ev) => {
        valid(signupsOf(ev.id)).filter((s) => s.name === name && s.date >= today()).forEach((s) => {
          out.push({ id: s.id, date: s.date, eventId: ev.id, eventName: ev.name, positionId: s.positionId, position: (ev.positions.find((p) => p.id === s.positionId) || {}).name || '', startTime: ev.startTime, location: ev.location, canChange: s.date > today() });
        });
      });
      return { today: today(), items: out.sort((a, b) => a.date.localeCompare(b.date)) };
    },

    cancel(body, who) {
      const s = typeof body.signupId === 'string' ? store.get('signups', body.signupId) : null;
      if (!s || s.status !== '有效') throw new AppError('NOT_FOUND', '找不到這筆報名，可能已經取消了');
      if (!who && s.date <= today()) throw new AppError('TOO_LATE', '活動當天（含）之後不能自己取消，請聯絡區管理者');
      let ev;
      try { ev = getEventAny(s.eventId, body); } catch (e) { ev = { name: '（已刪除的活動）' }; } // 分壇刪掉的也能取消
      s.status = '已取消';
      s.canceledAt = taipeiStamp(now());
      store.put('signups', s.id, s, s.eventId);
      log(who ? '管理者取消' : '取消', `${ev.name}／${s.date}：${s.name}`, who);
      return {};
    },

    reschedule(body, who) {
      const s = typeof body.signupId === 'string' ? store.get('signups', body.signupId) : null;
      if (!s || s.status !== '有效') throw new AppError('NOT_FOUND', '找不到這筆報名，可能已經取消了');
      if (!who && s.date <= today()) throw new AppError('TOO_LATE', '活動當天（含）之後不能自己改期，請聯絡區管理者');
      const ev = getEventAny(s.eventId, body);
      const positionId = typeof body.positionId === 'string' && body.positionId ? body.positionId : s.positionId;
      if (body.date === s.date && positionId === s.positionId) throw new AppError('BAD_REQUEST', '日期和了愿項目都沒有改');
      const c = checkSignup(ev, [body.date], positionId, [s.name], who, s.id);
      // 自己同一天報的那筆就是要改的這筆，不算重複
      if (c.problems.length && !who) throw new AppError('BLOCKED', '不能改到這一天', c.problems);
      const stamp = taipeiStamp(now());
      const fresh = { id: `S-${seq()}-${randomHex(2)}`, eventId: ev.id, date: c.dates[0], positionId: c.pos.id, name: s.name, status: '有效', createdAt: stamp, by: who ? '管理者' : '家人', movedFrom: s.id };
      store.tx(() => {
        s.status = '已取消';
        s.canceledAt = stamp;
        s.movedTo = fresh.id;
        store.put('signups', s.id, s, s.eventId);
        store.put('signups', fresh.id, fresh, ev.id);
      });
      log(who ? '管理者改期' : '改期', `${ev.name}：${s.name} ${s.date} → ${fresh.date}（${c.pos.name}）`, who);
      return { signup: { id: fresh.id, date: fresh.date, position: c.pos.name }, warnings: c.problems };
    },

    /** 給分壇行事曆讀：活動、每天的狀態和名單（只有名字） */
    feed(body) {
      return {
        region,
        events: inRange(body.from, body.to, body).map((ev) => {
          const list = signupsOf(ev.id);
          const days = datesBetween(ev.start > body.from ? ev.start : body.from, ev.end < body.to ? ev.end : body.to).map((d) => {
            const v = dayView(ev, list, d, false);
            return { date: d, status: v.status, positions: v.positions.map((p) => ({ name: p.name, people: p.people })) };
          });
          return Object.assign(publicEvent(ev), { days });
        })
      };
    },

    // ---------- 區管理者 ----------

    adminEvents(body) {
      return {
        today: today(),
        events: allEvents(body).sort((a, b) => a.start.localeCompare(b.start) || (a.startTime || '').localeCompare(b.startTime || ''))
          .map((ev) => Object.assign(publicEvent(ev), { signups: valid(signupsOf(ev.id)).length, createdAt: ev.createdAt, updatedAt: ev.updatedAt }))
      };
    },

    adminSaveEvent(body, who) {
      const input = body.event || {};
      if (isAssigned(input.id)) throw new AppError('FORBIDDEN', '分壇分配的勤務只能由分壇在分壇行事曆後台修改');
      const clean = cleanEvent(input, () => newId('P'));
      const stamp = taipeiStamp(now());
      if (input.id) {
        const old = getEvent(input.id);
        const list = valid(signupsOf(old.id));
        const errs = [];
        if (list.length && clean.mode === '公告型') errs.push('已經有人報名，不能改成公告型');
        old.positions.forEach((p) => {
          if (!clean.positions.find((q) => q.id === p.id) && list.some((s) => s.positionId === p.id)) errs.push(`「${p.name}」已經有人報名，不能刪除`);
        });
        const outside = list.filter((s) => s.date < clean.start || s.date > clean.end);
        if (outside.length) errs.push(`${[...new Set(outside.map((s) => s.date))].join('、')} 已經有人報名，不能移出活動期間`);
        if (errs.length) throw new AppError('BAD_REQUEST', errs.join('；'));
        const saved = Object.assign({ id: old.id, createdAt: old.createdAt }, clean, { updatedAt: stamp });
        store.put('events', saved.id, saved);
        log('修改活動', `${saved.name}（${saved.start}）`, who);
        return { event: saved };
      }
      const saved = Object.assign({ id: newId('E') }, clean, { createdAt: stamp, updatedAt: stamp });
      store.put('events', saved.id, saved);
      log('新增活動', `${saved.name}（${saved.start}）`, who);
      return { event: saved };
    },

    adminDeleteEvent(body, who) {
      if (isAssigned(body.id)) throw new AppError('FORBIDDEN', '分壇分配的勤務只能由分壇在分壇行事曆後台刪除');
      const ev = getEvent(body.id);
      if (valid(signupsOf(ev.id)).length) throw new AppError('BAD_REQUEST', '還有人報名，要先取消報名才能刪除');
      store.tx(() => {
        signupsOf(ev.id).forEach((s) => store.del('signups', s.id));
        store.del('events', ev.id);
      });
      log('刪除活動', `${ev.name}（${ev.start}）`, who);
      return {};
    },

    adminRoster(body) {
      const ev = getEventAny(body.id, body);
      const list = signupsOf(ev.id);
      return { today: today(), event: publicEvent(ev), days: datesBetween(ev.start, ev.end).map((d) => dayView(ev, list, d, true)) };
    },

    adminSignup: (body, who) => actions.signup(body, who),
    adminCancel: (body, who) => actions.cancel(body, who),
    adminReschedule: (body, who) => actions.reschedule(body, who),

    adminLog() {
      const all = store.all('log');
      return { log: all.slice(-200).reverse() };
    }
  };

  const ADMIN = { adminEvents: 1, adminSaveEvent: 1, adminDeleteEvent: 1, adminRoster: 1, adminSignup: 1, adminCancel: 1, adminReschedule: 1, adminLog: 1 };
  const PUBLIC = { events: 1, event: 1, signup: 1, mySignups: 1, cancel: 1, reschedule: 1, feed: 1 };

  async function call(body, who) {
    try {
      const action = body && body.action;
      if (!actions[action] || !(ADMIN[action] || PUBLIC[action])) throw new AppError('BAD_REQUEST', '未知的 action：' + str(action).slice(0, 30));
      if (ADMIN[action] && !(who && (who.role === 'super' || who.region === region))) throw new AppError('UNAUTHORIZED', '請先登入這一區的管理者');
      return { ok: true, data: await actions[action](body, ADMIN[action] ? who : null) };
    } catch (err) {
      if (err instanceof AppError) return { ok: false, error: { code: err.code, message: err.message, details: err.details } };
      console.error(err);
      return { ok: false, error: { code: 'INTERNAL', message: '伺服器發生錯誤，請稍後再試' } };
    }
  }

  return { call };
}
