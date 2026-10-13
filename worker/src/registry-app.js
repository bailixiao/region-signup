// registry Durable Object：區清單、帳號（密碼只存加鹽雜湊）、登入通行碼、登入失敗次數（規格第 3、4 節）。
import { SITE, REGION_NAMES } from './site.js';
import { AppError, str, taipeiStamp } from './logic.js';

const SESSION_TTL_MS = 12 * 3600e3;
const MAX_FAILS = 10;
const LOCK_MS = 15 * 60e3;
const PBKDF2_ITER = 100000; // Workers 的 PBKDF2 上限

const enc = (s) => new TextEncoder().encode(s);
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const randomHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async (s) => hex(await crypto.subtle.digest('SHA-256', enc(s)));

async function pbkdf2(password, salt) {
  const key = await crypto.subtle.importKey('raw', enc(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc(salt), iterations: PBKDF2_ITER, hash: 'SHA-256' }, key, 256));
}

/** 長度固定再比，避免逐字比較洩漏時間 */
async function sameSecret(a, b) {
  return (await sha256('x' + a)) === (await sha256('x' + b));
}

/**
 * @param opts.superPassword () => 分壇總管理者密碼（Worker secret SUPER_PASSWORD）
 */
export function createRegistryApp(store, opts) {
  const now = opts.now || (() => Date.now());

  const regionsAll = () => store.all('regions').sort((a, b) => REGION_NAMES.indexOf(a.name) - REGION_NAMES.indexOf(b.name));

  async function newSession(role, region) {
    const token = randomHex(32);
    const exp = now() + SESSION_TTL_MS;
    store.delKBelow('sessions', String(now()).padStart(15, '0'));
    store.put('sessions', await sha256(token), { role, region: region || '', exp }, String(exp).padStart(15, '0'));
    return { token, expiresInSec: SESSION_TTL_MS / 1000, account: role === 'super' ? SITE.superAccount : region, role };
  }

  async function verify(token) {
    if (typeof token !== 'string' || !token) throw new AppError('UNAUTHORIZED', '請先登入');
    const s = store.get('sessions', await sha256(token));
    if (!s || s.exp <= now()) throw new AppError('UNAUTHORIZED', '登入已過期，請重新登入');
    return { role: s.role, region: s.region };
  }

  function requireSuper(who) {
    if (!who || who.role !== 'super') throw new AppError('UNAUTHORIZED', '只有分壇總管理者可以做這件事');
  }

  const actions = {
    regions: () => ({ regions: regionsAll().map(({ name, status }) => ({ name, status })) }),

    loginAccounts: () => ({ accounts: [SITE.superAccount].concat(regionsAll().filter((r) => store.get('accounts', r.name)).map((r) => r.name)) }),

    async login(body) {
      const account = str(body.account) || SITE.superAccount;
      const password = typeof body.password === 'string' ? body.password : '';
      const fails = store.get('fails', account) || { count: 0, lockUntil: 0 };
      if (fails.lockUntil > now()) throw new AppError('LOCKED', `密碼輸錯太多次，請 ${Math.ceil((fails.lockUntil - now()) / 60e3)} 分鐘後再試`);
      let ok = false;
      let role = 'region';
      if (account === SITE.superAccount) {
        const pw = opts.superPassword();
        if (!pw) throw new AppError('NOT_CONFIGURED', '分壇總管理者的密碼還沒設定（Worker secret SUPER_PASSWORD）');
        ok = !!password && await sameSecret(password, pw);
        role = 'super';
      } else {
        if (REGION_NAMES.indexOf(account) === -1) throw new AppError('UNAUTHORIZED', '沒有這個帳號');
        const acc = store.get('accounts', account);
        if (!acc) throw new AppError('UNAUTHORIZED', '這一區還沒有設定管理者密碼，請聯絡分壇');
        ok = !!password && (await pbkdf2(password, acc.salt)) === acc.hash;
      }
      if (!ok) {
        fails.count += 1;
        if (fails.count >= MAX_FAILS) { fails.count = 0; fails.lockUntil = now() + LOCK_MS; }
        store.put('fails', account, fails);
        throw new AppError('UNAUTHORIZED', '密碼不對');
      }
      store.del('fails', account);
      return newSession(role, role === 'super' ? '' : account);
    },

    async logout(body) {
      if (typeof body.token === 'string' && body.token) store.del('sessions', await sha256(body.token));
      return {};
    },

    async verify(body) {
      return verify(body.token);
    },

    // ---------- 分壇總管理者 ----------

    async superRegions(body) {
      requireSuper(await verify(body.token));
      return { regions: regionsAll().map((r) => Object.assign({}, r, { hasPassword: !!store.get('accounts', r.name) })), names: REGION_NAMES };
    },

    async superSaveRegion(body) {
      requireSuper(await verify(body.token));
      const name = str(body.name);
      if (REGION_NAMES.indexOf(name) === -1) throw new AppError('BAD_REQUEST', '區名不對');
      const status = name === SITE.testRegion ? '測試' : body.status === '開放' ? '開放' : '測試';
      const old = store.get('regions', name);
      const password = typeof body.password === 'string' ? body.password : '';
      if (!old && !password) throw new AppError('BAD_REQUEST', '開設新的區要設定管理者密碼');
      if (password && password.length < 6) throw new AppError('BAD_REQUEST', '密碼至少 6 個字');
      const region = { name, status, createdAt: old ? old.createdAt : taipeiStamp(now()), updatedAt: taipeiStamp(now()) };
      store.put('regions', name, region);
      if (password) {
        const salt = randomHex(16);
        store.put('accounts', name, { salt, hash: await pbkdf2(password, salt) });
        purgeRegionSessions(name); // 改密碼：這一區已經登入的都登出
      }
      return { region: Object.assign({}, region, { hasPassword: !!store.get('accounts', name) }) };
    }
  };

  function purgeRegionSessions(name) {
    store.ids('sessions').forEach((id) => {
      const s = store.get('sessions', id);
      if (s && s.region === name) store.del('sessions', id);
    });
  }

  async function call(body) {
    try {
      const fn = body && actions[body.action];
      if (!fn) throw new AppError('BAD_REQUEST', '未知的 action：' + str(body && body.action).slice(0, 30));
      return { ok: true, data: await fn(body) };
    } catch (err) {
      if (err instanceof AppError) return { ok: false, error: { code: err.code, message: err.message } };
      console.error(err);
      return { ok: false, error: { code: 'INTERNAL', message: '伺服器發生錯誤，請稍後再試' } };
    }
  }

  return { call };
}
