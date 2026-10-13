// Worker 前門：接 HTTP 請求，轉給 registry 或該區的 Durable Object（規格第 7、8 節）。
//   - 讀取有記憶體快取：區清單 60 秒、各區活動 30 秒、給分壇的 feed 2 分鐘；寫入後這個 Worker 的該區快取馬上失效。
//   - 管理動作：先向 registry 驗證通行碼（記 60 秒），再把「誰」交給該區。
import { SITE, REGION_NAMES } from './site.js';
import { AppError, checkRange, str } from './logic.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};
const MAX_BODY = 100000;
const REGION_PUBLIC_POST = { signup: 1, mySignups: 1, cancel: 1, reschedule: 1 };
const REGION_ADMIN = { adminEvents: 1, adminSaveEvent: 1, adminDeleteEvent: 1, adminRoster: 1, adminSignup: 1, adminCancel: 1, adminReschedule: 1, adminLog: 1 };
const REGISTRY_POST = { adminLogin: 'login', adminLogout: 'logout', superRegions: 'superRegions', superSaveRegion: 'superSaveRegion' };
const WRITES = { signup: 1, cancel: 1, reschedule: 1, adminSaveEvent: 1, adminDeleteEvent: 1, adminSignup: 1, adminCancel: 1, adminReschedule: 1 };

function json(obj) {
  return new Response(JSON.stringify(obj), { headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, CORS) });
}

function fail(err) {
  if (err instanceof AppError) return json({ ok: false, error: { code: err.code, message: err.message, details: err.details } });
  console.error(err);
  return json({ ok: false, error: { code: 'INTERNAL', message: '伺服器發生錯誤，請稍後再試' } });
}

/**
 * @param opts.registry (body) => Promise<{ ok, data | error }>
 * @param opts.region (name, body, who) => Promise<{ ok, data | error }>
 * @param opts.now () => 毫秒
 */
export function createFront(opts) {
  const now = opts.now || (() => Date.now());
  const ttl = Object.assign({ regions: 60e3, events: 30e3, feed: 120e3, verify: 60e3 }, opts.ttl || {});
  const cache = new Map(); // key → { at, data }

  const unwrap = (res) => {
    if (!res || !res.ok) throw new AppError(res && res.error ? res.error.code : 'INTERNAL', res && res.error ? res.error.message : '伺服器發生錯誤', res && res.error ? res.error.details : undefined);
    return res.data;
  };

  async function cached(key, maxAge, fn) {
    const hit = cache.get(key);
    if (hit && now() - hit.at < maxAge) return hit.data;
    const data = await fn();
    if (cache.size > 2000) cache.clear();
    cache.set(key, { at: now(), data });
    return data;
  }
  const forget = (prefix) => { [...cache.keys()].forEach((k) => { if (k.startsWith(prefix)) cache.delete(k); }); };

  const allRegions = () => cached('regions', ttl.regions, async () => unwrap(await opts.registry({ action: 'regions' })).regions);
  const publicRegions = async () => (await allRegions()).filter((r) => r.status === '開放' && r.name !== SITE.testRegion);

  /** 區要已經開設（測試區也可以用網址打開） */
  async function checkRegion(name) {
    if (REGION_NAMES.indexOf(name) === -1) throw new AppError('BAD_REQUEST', '沒有這個區');
    if (!(await allRegions()).some((r) => r.name === name)) throw new AppError('NOT_FOUND', `${name}還沒有開設報名系統`);
    return name;
  }

  async function verify(token) {
    if (typeof token !== 'string' || !token) throw new AppError('UNAUTHORIZED', '請先登入');
    return cached('verify:' + token, ttl.verify, async () => unwrap(await opts.registry({ action: 'verify', token })));
  }

  async function regionCall(name, body, who) {
    const data = unwrap(await opts.region(name, body, who));
    if (WRITES[body.action]) { forget('ev:' + name + ':'); forget('feed'); }
    return data;
  }

  async function handleGet(p) {
    const action = p.get('action') || '';
    if (action === 'ping') return { ok: true };
    if (action === 'regions') return { regions: await publicRegions() };
    if (action === 'loginAccounts') return unwrap(await opts.registry({ action: 'loginAccounts' }));
    if (action === 'getEvents') {
      const name = await checkRegion(p.get('region'));
      const from = p.get('from');
      const to = p.get('to');
      checkRange(from, to, 400);
      const info = (await allRegions()).find((r) => r.name === name);
      return cached(`ev:${name}:${from}:${to}`, ttl.events, async () => Object.assign({ region: name, status: info.status }, await regionCall(name, { action: 'events', from, to })));
    }
    if (action === 'getEvent') {
      const name = await checkRegion(p.get('region'));
      return regionCall(name, { action: 'event', id: p.get('id') || '' });
    }
    if (action === 'feed') {
      const from = p.get('from');
      const to = p.get('to');
      const test = p.get('test') === '1'; // 測試用：連「測試」狀態的區（含測試區）一起
      checkRange(from, to, 62);
      return cached(`feed:${from}:${to}:${test ? 1 : 0}`, ttl.feed, async () => {
        const regions = test ? await allRegions() : await publicRegions();
        const parts = await Promise.all(regions.map((r) => opts.region(r.name, { action: 'feed', from, to }, null).then(unwrap)));
        return { from, to, regions: parts };
      });
    }
    throw new AppError('BAD_REQUEST', '未知的 action：' + action.slice(0, 30));
  }

  async function handlePost(body) {
    const action = str(body.action);
    if (REGISTRY_POST[action]) {
      const res = unwrap(await opts.registry(Object.assign({}, body, { action: REGISTRY_POST[action] })));
      if (action === 'adminLogout') forget('verify:');
      if (action === 'superSaveRegion') { forget('regions'); forget('verify:'); forget('feed'); }
      return res;
    }
    if (REGION_PUBLIC_POST[action]) {
      const name = await checkRegion(body.region);
      return regionCall(name, body, null);
    }
    if (REGION_ADMIN[action]) {
      const who = await verify(body.token);
      const name = await checkRegion(body.region);
      if (who.role !== 'super' && who.region !== name) throw new AppError('UNAUTHORIZED', '只能管理自己的區');
      const clean = Object.assign({}, body);
      delete clean.token;
      return regionCall(name, clean, who);
    }
    throw new AppError('BAD_REQUEST', '未知的 action：' + action.slice(0, 30));
  }

  async function handle(request) {
    try {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      if (request.method === 'GET') return json({ ok: true, data: await handleGet(new URL(request.url).searchParams) });
      if (request.method !== 'POST') throw new AppError('BAD_REQUEST', '不支援的方法');
      const text = await request.text();
      if (text.length > MAX_BODY) throw new AppError('BAD_REQUEST', '資料太大');
      let body;
      try { body = JSON.parse(text); } catch (e) { throw new AppError('BAD_REQUEST', '資料格式錯誤'); }
      if (!body || typeof body !== 'object') throw new AppError('BAD_REQUEST', '資料格式錯誤');
      return json({ ok: true, data: await handlePost(body) });
    } catch (err) {
      return fail(err);
    }
  }

  return { handle };
}
