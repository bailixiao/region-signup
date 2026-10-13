// 不碰資料庫、不連網的邏輯：日期、欄位檢查、名字比對、報名狀態。測試直接呼叫這裡。
import { SITE } from './site.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const MAX_DAYS = 60; // 一個活動最長幾天
export const MAX_POSITIONS = 10;
export const MAX_NAMES = 10; // 一次最多幫幾個人報名
const LIMITS = { name: 60, location: 60, note: 1000 };
const DEFAULT_MIN_PEOPLE = 2;

export class AppError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export function taipeiDate(ms) {
  return new Date(ms + 8 * 3600e3).toISOString().slice(0, 10);
}
export function taipeiStamp(ms) {
  return new Date(ms + 8 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
}

export function isDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}
export function isTime(s) {
  return typeof s === 'string' && TIME_RE.test(s);
}
export function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400e3);
}
export function addDays(s, n) {
  return new Date(Date.parse(s + 'T00:00:00Z') + n * 86400e3).toISOString().slice(0, 10);
}
export function datesBetween(a, b) {
  const out = [];
  for (let s = a; s <= b; s = addDays(s, 1)) out.push(s);
  return out;
}

export function str(v) {
  return typeof v === 'string' ? v.trim() : v === undefined || v === null ? '' : String(v).trim();
}

/** 名字：去掉前後空白（含全形空白）與中間的空白 */
export function cleanName(s) {
  return str(s).replace(/[\s　]/g, '');
}

/**
 * 兩個名字是否視為同一人（同教全區 Rules.gs sameName_）：
 * 三個字以上先去掉第一個字（姓），剩下的部分只要有連續兩個字相同就算同一人；一個字的名字只比對完全相同。
 */
export function sameName(a, b) {
  a = cleanName(a);
  b = cleanName(b);
  if (!a || !b) return false;
  if (a === b) return true;
  const keys = (n) => {
    const s = n.length >= 3 ? n.slice(1) : n;
    const out = [];
    for (let i = 0; i + 1 < s.length; i++) out.push(s.substr(i, 2));
    return out;
  };
  const kb = keys(b);
  return keys(a).some((k) => kb.indexOf(k) !== -1);
}

function intOrNull(v, label, errs) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 999) { errs.push(`${label}要是 0～999 的整數`); return null; }
  return n;
}

/**
 * 檢查並整理區管理者送來的活動（不含 id、時間戳記）。有錯丟 AppError('BAD_REQUEST')，一次列出。
 * positions 沿用舊的 id（有帶 id 的），新的給新 id（newId()）。
 */
export function cleanEvent(input, newId) {
  if (!input || typeof input !== 'object') throw new AppError('BAD_REQUEST', '活動資料格式錯誤');
  const ev = {
    category: str(input.category),
    mode: str(input.mode) || '報名型',
    name: str(input.name),
    start: str(input.start),
    end: str(input.end) || str(input.start),
    startTime: str(input.startTime),
    endTime: str(input.endTime),
    location: str(input.location),
    note: str(input.note).replace(/\r\n?/g, '\n'),
    positions: []
  };
  const errs = [];
  if (SITE.categories.indexOf(ev.category) === -1) errs.push('請選擇類別');
  if (SITE.modes.indexOf(ev.mode) === -1) errs.push('請選擇報名型或公告型');
  if (!ev.name) errs.push('請填活動名稱');
  if (!isDate(ev.start)) errs.push('開始日期格式不對');
  if (!isDate(ev.end)) errs.push('結束日期格式不對');
  if (isDate(ev.start) && isDate(ev.end)) {
    if (ev.end < ev.start) errs.push('結束日期不能早於開始日期');
    else if (daysBetween(ev.start, ev.end) >= MAX_DAYS) errs.push(`一個活動最長 ${MAX_DAYS} 天`);
  }
  if (ev.startTime && !isTime(ev.startTime)) errs.push('開始時間格式不對（例：09:30）');
  if (ev.endTime && !isTime(ev.endTime)) errs.push('結束時間格式不對（例：17:00）');
  if (ev.endTime && !ev.startTime) errs.push('有結束時間就要填開始時間');
  Object.keys(LIMITS).forEach((k) => { if (ev[k].length > LIMITS[k]) errs.push(`${({ name: '活動名稱', location: '地點', note: '說明' })[k]}最多 ${LIMITS[k]} 字`); });
  if (ev.mode === '報名型') {
    const list = Array.isArray(input.positions) ? input.positions : [];
    if (!list.length) errs.push('報名型至少要有一個了愿項目');
    if (list.length > MAX_POSITIONS) errs.push(`了愿項目最多 ${MAX_POSITIONS} 個`);
    const names = new Set();
    list.slice(0, MAX_POSITIONS).forEach((p, i) => {
      const name = str(p && p.name);
      if (!name) { errs.push(`第 ${i + 1} 個了愿項目沒有名稱`); return; }
      if (name.length > 20) errs.push(`了愿項目「${name}」名稱最多 20 字`);
      if (names.has(name)) errs.push(`了愿項目「${name}」重複了`);
      names.add(name);
      const min = intOrNull(p.min, `「${name}」的最少人數`, errs);
      const max = intOrNull(p.max, `「${name}」的最多人數`, errs);
      if (min !== null && max !== null && max < min) errs.push(`「${name}」的最多人數不能少於最少人數`);
      if (max === 0) errs.push(`「${name}」的最多人數不能是 0`);
      const id = typeof p.id === 'string' && /^P-[\w-]{1,40}$/.test(p.id) ? p.id : newId();
      ev.positions.push({ id, name, min, max });
    });
  }
  if (errs.length) throw new AppError('BAD_REQUEST', errs.join('；'));
  return ev;
}

/** 「最少」留空：勤務預設 2 人（最多小於 2 時以最多為準）；道務、教育自由參加不算缺人 */
export function effectiveMin(ev, p) {
  if (p.min !== null && p.min !== undefined) return p.min;
  if (ev.category !== '勤務') return 0;
  return p.max !== null && p.max !== undefined ? Math.min(DEFAULT_MIN_PEOPLE, p.max) : DEFAULT_MIN_PEOPLE;
}

/** 某一天各了愿項目的人數：{ total, counts: { positionId: n } } */
export function dayCounts(signups, date) {
  const counts = {};
  let total = 0;
  signups.forEach((s) => {
    if (s.date !== date || s.status !== '有效') return;
    counts[s.positionId] = (counts[s.positionId] || 0) + 1;
    total++;
  });
  return { total, counts };
}

/** 某活動某天的狀態（同教全區的算法）：{ kind: notice|full|short|ok, label } */
export function dayStatus(ev, day) {
  if (ev.mode === '公告型') return { kind: 'notice', label: '公告' };
  const { total, counts } = day;
  const full = ev.positions.length > 0 && ev.positions.every((p) => p.max !== null && (counts[p.id] || 0) >= p.max);
  if (ev.category !== '勤務') return full ? { kind: 'full', label: '額滿' } : { kind: 'ok', label: `已報 ${total} 人` };
  const shortage = ev.positions.reduce((n, p) => n + Math.max(effectiveMin(ev, p) - (counts[p.id] || 0), 0), 0);
  if (full) return { kind: 'full', label: '額滿' };
  if (shortage > 0) return { kind: 'short', label: `缺 ${shortage} 人` };
  const unlimited = ev.positions.every((p) => p.max === null);
  return { kind: 'ok', label: unlimited ? `已報 ${total} 人` : `人數足・${total} 人` };
}

/** 讀取區間的檢查 */
export function checkRange(from, to, maxDays) {
  if (!isDate(from) || !isDate(to)) throw new AppError('BAD_REQUEST', 'from、to 要是 yyyy-MM-dd');
  if (to < from) throw new AppError('BAD_REQUEST', 'to 不能早於 from');
  if (daysBetween(from, to) > maxDays) throw new AppError('BAD_REQUEST', `一次最多讀 ${maxDays} 天`);
}
