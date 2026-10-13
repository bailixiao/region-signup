// 後端測試：記憶體版的資料存放，不連網。名字都是假名。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFront } from '../worker/src/front.js';
import { createRegistryApp } from '../worker/src/registry-app.js';
import { createRegionApp } from '../worker/src/region-app.js';
import { createMemoryStore } from '../worker/src/store.js';
import { sameName, dayStatus, cleanEvent } from '../worker/src/logic.js';

function setup(fentanEvents) {
  let t = Date.parse('2026-10-13T02:00:00Z'); // 台北 10/13 10:00
  const fentan = { list: fentanEvents || [] };
  const clock = { now: () => t, add: (ms) => { t += ms; } };
  const registry = createRegistryApp(createMemoryStore(), { superPassword: () => 'test-super', now: clock.now });
  const stores = new Map();
  const regionApp = (name) => {
    if (!stores.has(name)) stores.set(name, createRegionApp(createMemoryStore(), { region: name, now: clock.now }));
    return stores.get(name);
  };
  const front = createFront({
    registry: (b) => registry.call(JSON.parse(JSON.stringify(b))),
    region: (name, b, who) => regionApp(name).call(JSON.parse(JSON.stringify(b)), who),
    now: clock.now,
    fentan: async (year) => fentan.list.filter((e) => e.start.slice(0, 4) === String(year)),
    ttl: { regions: 0, events: 0, feed: 0, verify: 0, fentan: 0 }
  });
  const post = async (body) => (await front.handle(new Request('http://x/', { method: 'POST', body: JSON.stringify(body) }))).json();
  const get = async (q) => (await front.handle(new Request('http://x/?' + q))).json();
  const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.data; };
  return { clock, post, get, ok, fentan };
}

/** 開好測試區與教真區，回傳兩個管理者的通行碼與一個活動 */
async function ready(env, eventOver) {
  const sup = env.ok(await env.post({ action: 'adminLogin', account: '分壇總管理者', password: 'test-super' })).token;
  env.ok(await env.post({ action: 'superSaveRegion', token: sup, name: '測試區', password: 'test-pass' }));
  env.ok(await env.post({ action: 'superSaveRegion', token: sup, name: '教真區', status: '開放', password: 'zhen-pass' }));
  const tok = env.ok(await env.post({ action: 'adminLogin', account: '測試區', password: 'test-pass' })).token;
  const ev = env.ok(await env.post({ action: 'adminSaveEvent', token: tok, region: '測試區', event: Object.assign({
    category: '勤務', name: '宏宗打掃', start: '2026-10-20', end: '2026-10-21', startTime: '08:00', location: '宏宗',
    positions: [{ name: '打掃', min: 2, max: 3 }, { name: '茶水', min: '', max: 1 }]
  }, eventOver) })).event;
  return { sup, tok, ev, P1: ev.positions[0].id, P2: ev.positions[1] && ev.positions[1].id };
}

test('名字相近視為同一人', () => {
  assert.ok(sameName('王小明', '小明'));
  assert.ok(sameName(' 王小明 ', '王小明'));
  assert.ok(sameName('王小明', '李小明'));
  assert.ok(!sameName('王小明', '王大同'));
  assert.ok(!sameName('明', '小明'));
  assert.ok(sameName('明', '明'));
});

test('活動欄位檢查：了愿項目、人數、公告型', () => {
  let n = 0;
  const id = () => 'P-new-' + (++n);
  const ev = cleanEvent({ category: '勤務', name: '打掃', start: '2026-10-20', positions: [{ name: '打掃', min: '2', max: '' }] }, id);
  assert.deepEqual(ev.positions, [{ id: 'P-new-1', name: '打掃', min: 2, max: null }]);
  assert.equal(ev.end, '2026-10-20');
  assert.throws(() => cleanEvent({ category: '勤務', name: 'x', start: '2026-10-20', positions: [] }, id), /至少要有一個了愿項目/);
  assert.throws(() => cleanEvent({ category: '勤務', name: 'x', start: '2026-10-20', positions: [{ name: 'a', min: 3, max: 2 }] }, id), /不能少於最少/);
  assert.throws(() => cleanEvent({ category: '勤務', name: 'x', start: '2026-10-20', positions: [{ name: 'a' }, { name: 'a' }] }, id), /重複/);
  assert.throws(() => cleanEvent({ category: '勤務', name: 'x', start: '2026-10-20', positions: [{ name: 'a', max: 1.5 }] }, id), /整數/);
  assert.deepEqual(cleanEvent({ category: '道務', mode: '公告型', name: 'x', start: '2026-10-20', positions: [{ name: 'a' }] }, id).positions, []);
});

test('狀態：勤務缺人／人數足／額滿；道務只算已報；公告', () => {
  const ev = { category: '勤務', mode: '報名型', positions: [{ id: 'A', min: 2, max: null }, { id: 'B', min: null, max: 1 }] };
  assert.deepEqual(dayStatus(ev, { total: 1, counts: { A: 1 } }), { kind: 'short', label: '缺 2 人' });
  assert.deepEqual(dayStatus(ev, { total: 3, counts: { A: 2, B: 1 } }), { kind: 'ok', label: '人數足・3 人' });
  assert.deepEqual(dayStatus({ category: '勤務', positions: [{ id: 'A', min: 1, max: 2 }] }, { total: 2, counts: { A: 2 } }), { kind: 'full', label: '額滿' });
  assert.deepEqual(dayStatus({ category: '道務', positions: [{ id: 'A', min: null, max: null }] }, { total: 0, counts: {} }), { kind: 'ok', label: '已報 0 人' });
  assert.deepEqual(dayStatus({ mode: '公告型', positions: [] }, { total: 0, counts: {} }), { kind: 'notice', label: '公告' });
});

test('開設區、登入：測試區家人看不到；區管理者只能管自己的區；沒設密碼的不能登入', async () => {
  const env = setup();
  let r = await env.post({ action: 'adminLogin', account: '分壇總管理者', password: 'wrong' });
  assert.equal(r.error.code, 'UNAUTHORIZED');
  const { sup, tok } = await ready(env);
  assert.deepEqual(env.ok(await env.get('action=regions')).regions, [{ name: '教真區', status: '開放' }]);
  assert.deepEqual(env.ok(await env.get('action=loginAccounts')).accounts, ['分壇總管理者', '教真區', '測試區']);
  r = await env.post({ action: 'adminEvents', token: tok, region: '教真區' });
  assert.equal(r.error.code, 'UNAUTHORIZED');
  r = await env.post({ action: 'adminEvents', token: sup, region: '教真區' });
  assert.equal(r.ok, true); // 總管理者可以管任何一區
  r = await env.post({ action: 'superRegions', token: tok });
  assert.equal(r.error.code, 'UNAUTHORIZED');
  r = await env.post({ action: 'adminLogin', account: '教善區', password: 'x' });
  assert.match(r.error.message, /還沒有設定管理者密碼/);
  r = await env.get('action=getEvents&region=教善區&from=2026-10-01&to=2026-10-31');
  assert.equal(r.error.code, 'NOT_FOUND');
  r = await env.post({ action: 'superSaveRegion', token: sup, name: '台北區', password: 'abcdef' });
  assert.equal(r.error.code, 'BAD_REQUEST');
  // 改密碼：舊的登入失效
  env.ok(await env.post({ action: 'superSaveRegion', token: sup, name: '測試區', password: 'new-pass' }));
  r = await env.post({ action: 'adminEvents', token: tok, region: '測試區' });
  assert.equal(r.error.code, 'UNAUTHORIZED');
});

test('登入：連續輸錯 10 次暫停 15 分鐘（每個帳號分開算）', async () => {
  const env = setup();
  await ready(env);
  for (let i = 0; i < 10; i++) await env.post({ action: 'adminLogin', account: '測試區', password: 'x' });
  let r = await env.post({ action: 'adminLogin', account: '測試區', password: 'test-pass' });
  assert.equal(r.error.code, 'LOCKED');
  r = await env.post({ action: 'adminLogin', account: '教真區', password: 'zhen-pass' });
  assert.equal(r.ok, true);
  env.clock.add(15 * 60e3 + 1);
  r = await env.post({ action: 'adminLogin', account: '測試區', password: 'test-pass' });
  assert.equal(r.ok, true);
});

test('報名：一次多人多天、狀態、名單只有名字', async () => {
  const env = setup();
  const { ev, P1 } = await ready(env);
  const r = env.ok(await env.post({ action: 'signup', region: '測試區', eventId: ev.id, dates: ['2026-10-20', '2026-10-21'], positionId: P1, names: ['王小明', ' 測試甲 '] }));
  assert.equal(r.created.length, 4);
  const evs = env.ok(await env.get('action=getEvents&region=測試區&from=2026-10-01&to=2026-10-31'));
  assert.deepEqual(evs.events[0].days['2026-10-20'], { total: 2, status: { kind: 'short', label: '缺 1 人' } }); // 茶水最少（最多 1）＝1
  const one = env.ok(await env.get(`action=getEvent&region=測試區&id=${ev.id}`));
  assert.deepEqual(one.days[0].positions[0].people, [{ name: '王小明' }, { name: '測試甲' }]);
  assert.equal(one.days[0].positions[0].count, 2);
});

test('報名：當天和過去不能報、額滿、名字相近、同一批相近 → 整批都不寫入', async () => {
  const env = setup();
  const { ev, P1, P2 } = await ready(env, { start: '2026-10-13', end: '2026-10-21' });
  let r = await env.post({ action: 'signup', region: '測試區', eventId: ev.id, dates: ['2026-10-13'], positionId: P1, names: ['測試甲'] });
  assert.equal(r.error.code, 'BLOCKED');
  assert.match(r.error.details[0].reason, /當天或過去/);
  env.ok(await env.post({ action: 'signup', region: '測試區', eventId: ev.id, dates: ['2026-10-20'], positionId: P1, names: ['王小明', '測試乙'] }));
  r = await env.post({ action: 'signup', region: '測試區', eventId: ev.id, dates: ['2026-10-20'], positionId: P1, names: ['測試丙', '測試丁'] });
  assert.match(r.error.details.map((x) => x.reason).join(), /只剩 1 個名額/);
  r = await env.post({ action: 'signup', region: '測試區', eventId: ev.id, dates: ['2026-10-20'], positionId: P2, names: ['小明'] });
  assert.match(r.error.details[0].reason, /已經有「王小明」報了「打掃」/);
  r = await env.post({ action: 'signup', region: '測試區', eventId: ev.id, dates: ['2026-10-21'], positionId: P1, names: ['陳大同', '大同'] });
  assert.match(r.error.details[0].reason, /同一批/);
  const one = env.ok(await env.get(`action=getEvent&region=測試區&id=${ev.id}`));
  assert.equal(one.days.find((d) => d.date === '2026-10-21').total, 0); // 整批都沒寫入
  r = await env.post({ action: 'signup', region: '測試區', eventId: ev.id, dates: ['2026-11-01'], positionId: P1, names: ['測試戊'] });
  assert.match(r.error.message, /不在活動期間/);
});

test('查我的報名、取消、改期；當天不能自己取消', async () => {
  const env = setup();
  const { ev, P1, P2 } = await ready(env);
  env.ok(await env.post({ action: 'signup', region: '測試區', eventId: ev.id, dates: ['2026-10-20'], positionId: P1, names: ['王小明'] }));
  let mine = env.ok(await env.post({ action: 'mySignups', region: '測試區', name: ' 王小明' })).items;
  assert.equal(mine.length, 1);
  assert.equal(mine[0].position, '打掃');
  assert.equal(env.ok(await env.post({ action: 'mySignups', region: '測試區', name: '小明' })).items.length, 0); // 查詢要完全相同
  const moved = env.ok(await env.post({ action: 'reschedule', region: '測試區', signupId: mine[0].id, date: '2026-10-21', positionId: P2 }));
  assert.equal(moved.signup.position, '茶水');
  mine = env.ok(await env.post({ action: 'mySignups', region: '測試區', name: '王小明' })).items;
  assert.deepEqual(mine.map((x) => x.date + x.position), ['2026-10-21茶水']);
  // 改期到額滿的地方不行
  env.ok(await env.post({ action: 'signup', region: '測試區', eventId: ev.id, dates: ['2026-10-20'], positionId: P2, names: ['測試甲'] }));
  let r = await env.post({ action: 'reschedule', region: '測試區', signupId: mine[0].id, date: '2026-10-20', positionId: P2 });
  assert.match(r.error.details[0].reason, /已額滿/);
  // 當天不能自己取消；管理者可以
  env.clock.add(8 * 86400e3); // 10/21
  r = await env.post({ action: 'cancel', region: '測試區', signupId: mine[0].id });
  assert.equal(r.error.code, 'TOO_LATE');
});

test('管理者：幫人報名（不受當天、名額、重複限制，回警告）、取消、改期、名單有代號、操作紀錄', async () => {
  const env = setup();
  const { tok, ev, P2 } = await ready(env, { start: '2026-10-13', end: '2026-10-21' });
  const r = env.ok(await env.post({ action: 'adminSignup', token: tok, region: '測試區', eventId: ev.id, dates: ['2026-10-13'], positionId: P2, names: ['測試甲', '測試乙'] }));
  assert.equal(r.created.length, 2);
  assert.ok(r.warnings.some((w) => /只剩 1 個名額/.test(w.reason)));
  const roster = env.ok(await env.post({ action: 'adminRoster', token: tok, region: '測試區', id: ev.id }));
  const p = roster.days[0].positions.find((x) => x.id === P2).people;
  assert.equal(p[0].by, '管理者');
  assert.ok(p[0].id.startsWith('S-'));
  env.ok(await env.post({ action: 'adminCancel', token: tok, region: '測試區', signupId: p[0].id }));
  const log = env.ok(await env.post({ action: 'adminLog', token: tok, region: '測試區' })).log;
  assert.deepEqual(log.slice(0, 3).map((l) => l.action), ['管理者取消', '管理者幫人報名', '新增活動']);
});

test('修改活動：有人報的項目不能刪、有報名的日期不能移出、有人報不能改公告型、有人報不能刪活動', async () => {
  const env = setup();
  const { tok, ev, P1 } = await ready(env);
  env.ok(await env.post({ action: 'signup', region: '測試區', eventId: ev.id, dates: ['2026-10-21'], positionId: P1, names: ['王小明'] }));
  const base = Object.assign({}, ev);
  let r = await env.post({ action: 'adminSaveEvent', token: tok, region: '測試區', event: Object.assign({}, base, { positions: [ev.positions[1]] }) });
  assert.match(r.error.message, /「打掃」已經有人報名，不能刪除/);
  r = await env.post({ action: 'adminSaveEvent', token: tok, region: '測試區', event: Object.assign({}, base, { end: '2026-10-20' }) });
  assert.match(r.error.message, /不能移出活動期間/);
  r = await env.post({ action: 'adminSaveEvent', token: tok, region: '測試區', event: Object.assign({}, base, { mode: '公告型' }) });
  assert.match(r.error.message, /不能改成公告型/);
  r = await env.post({ action: 'adminDeleteEvent', token: tok, region: '測試區', id: ev.id });
  assert.match(r.error.message, /還有人報名/);
  // 改名、加項目可以；項目的 id 不變
  r = env.ok(await env.post({ action: 'adminSaveEvent', token: tok, region: '測試區', event: Object.assign({}, base, { name: '宏宗打掃（改）', positions: ev.positions.concat({ name: '交通', max: 2 }) }) }));
  assert.equal(r.event.positions[0].id, P1);
  assert.equal(r.event.positions.length, 3);
});

test('給分壇的 feed：只有開放的區（測試區不算），名單只有名字；寫入後馬上看到', async () => {
  const env = setup();
  const { sup } = await ready(env);
  const zhen = env.ok(await env.post({ action: 'adminLogin', account: '教真區', password: 'zhen-pass' })).token;
  const ev = env.ok(await env.post({ action: 'adminSaveEvent', token: zhen, region: '教真區', event: { category: '道務', name: '研究班', start: '2026-10-22', startTime: '19:30', positions: [{ name: '參加' }] } })).event;
  env.ok(await env.post({ action: 'signup', region: '教真區', eventId: ev.id, dates: ['2026-10-22'], positionId: ev.positions[0].id, names: ['王小明'] }));
  let f = env.ok(await env.get('action=feed&from=2026-10-13&to=2026-11-12'));
  assert.deepEqual(f.regions.map((x) => x.region), ['教真區']);
  assert.deepEqual(f.regions[0].events[0].days[0], { date: '2026-10-22', status: { kind: 'ok', label: '已報 1 人' }, positions: [{ name: '參加', people: [{ name: '王小明' }] }] });
  // 教真區改成測試 → feed 沒有它
  env.ok(await env.post({ action: 'superSaveRegion', token: sup, name: '教真區', status: '測試' }));
  f = env.ok(await env.get('action=feed&from=2026-10-13&to=2026-11-12'));
  assert.deepEqual(f.regions, []);
  // test=1：連測試的區一起
  f = env.ok(await env.get('action=feed&from=2026-10-13&to=2026-11-12&test=1'));
  assert.deepEqual(f.regions.map((x) => x.region).sort(), ['教真區', '測試區'].sort());
  const r = await env.get('action=feed&from=2026-10-01&to=2026-12-31');
  assert.equal(r.error.code, 'BAD_REQUEST');
  const bad = await env.post({ action: 'adminLogin', account: '不存在', password: 'x' });
  assert.equal(bad.error.message, '沒有這個帳號');
});

test('分壇分配的勤務：從分壇行事曆讀進來、只收報名、不能在這裡改（規格第 5-1 節）', async () => {
  const F = (o) => Object.assign({ source: 'local', category: '勤務', start: '2026-10-24', end: '2026-10-24', startTime: '', endTime: '', location: '宏宗', note: '', positions: [] }, o);
  const env = setup([
    F({ id: 'E-1', unit: '測試區', kind: '分壇分配', name: '統班烹飪', positions: [{ id: 'P-a', name: '烹飪', min: 15, max: null }] }),
    F({ id: 'E-2', unit: '測試區', kind: '分壇分配', name: '宏宗獻供拜香' }),
    F({ id: 'E-3', unit: '測試區', kind: '區活動', name: '研究班（範例）' }),
    F({ id: 'E-4', unit: '教真區', kind: '分壇分配', name: '別區的勤務' }),
    F({ id: 'E-5', unit: '分壇', kind: '', name: '分壇法會' }),
    F({ id: 'jq-D-1', source: 'jiaoquan', unit: '教全區', name: '教全區的' })
  ]);
  const { tok } = await ready(env);
  let evs = env.ok(await env.get('action=getEvents&region=測試區&from=2026-10-01&to=2026-10-31')).events;
  const names = evs.map((e) => e.name);
  assert.ok(names.includes('統班烹飪') && names.includes('宏宗獻供拜香') && names.includes('宏宗打掃'));
  assert.ok(!names.includes('研究班（範例）') && !names.includes('別區的勤務') && !names.includes('分壇法會') && !names.includes('教全區的'));
  const cook = evs.find((e) => e.name === '統班烹飪');
  assert.equal(cook.id, 'F-E-1');
  assert.equal(cook.assigned, true);
  assert.deepEqual(cook.days['2026-10-24'].status, { kind: 'short', label: '缺 15 人' });
  const incense = evs.find((e) => e.name === '宏宗獻供拜香');
  assert.deepEqual(incense.positions, [{ id: 'P-fentan-join', name: '參加', min: 0, max: null }]);
  assert.deepEqual(incense.days['2026-10-24'].status, { kind: 'ok', label: '已報 0 人' }); // 不限人數、不算缺人
  // 家人報名分壇分配的勤務
  env.ok(await env.post({ action: 'signup', region: '測試區', eventId: 'F-E-1', dates: ['2026-10-24'], positionId: 'P-a', names: ['王小明', '測試甲'] }));
  const one = env.ok(await env.get('action=getEvent&region=測試區&id=F-E-1'));
  assert.deepEqual(one.days[0].positions[0].people, [{ name: '王小明' }, { name: '測試甲' }]);
  const mine = env.ok(await env.post({ action: 'mySignups', region: '測試區', name: '王小明' })).items;
  assert.equal(mine[0].eventName, '統班烹飪');
  // 分壇的 feed 讀得到（test=1）
  const f = env.ok(await env.get('action=feed&from=2026-10-13&to=2026-11-12&test=1'));
  const t = f.regions.find((r) => r.region === '測試區');
  assert.ok(t.events.some((e) => e.id === 'F-E-1' && e.days[0].positions[0].people.length === 2));
  // 區管理者不能改、不能刪；列表看得到（標分壇分配）
  let r = await env.post({ action: 'adminSaveEvent', token: tok, region: '測試區', event: Object.assign({}, cook, { name: '改名' }) });
  assert.equal(r.error.code, 'FORBIDDEN');
  r = await env.post({ action: 'adminDeleteEvent', token: tok, region: '測試區', id: 'F-E-1' });
  assert.equal(r.error.code, 'FORBIDDEN');
  const list = env.ok(await env.post({ action: 'adminEvents', token: tok, region: '測試區' })).events;
  assert.equal(list.find((e) => e.id === 'F-E-1').assigned, true);
  assert.equal(list.find((e) => e.id === 'F-E-1').signups, 2);
  // 分壇刪掉了：不再顯示，但報名還能取消
  env.fentan.list = env.fentan.list.filter((e) => e.id !== 'E-1');
  evs = env.ok(await env.get('action=getEvents&region=測試區&from=2026-10-01&to=2026-10-31')).events;
  assert.ok(!evs.some((e) => e.id === 'F-E-1'));
  r = await env.post({ action: 'cancel', region: '測試區', signupId: mine[0].id });
  assert.equal(r.ok, true, JSON.stringify(r));
});
