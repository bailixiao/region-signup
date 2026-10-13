// 資料存放：Durable Object 內建的 SQLite（正式）或記憶體（測試、本機預覽），用法相同。
// 一張 docs 表放所有資料：table（events／signups／log／regions／accounts⋯）、id、k（查詢用的次要鍵）、data（JSON）。
//   - 每區一個 Durable Object：events（k＝空）、signups（k＝活動 id）、log（k＝空，id 遞增）。
//   - registry：regions、accounts（k＝空）、sessions（k＝到期時間）、fails（登入失敗）。

/** 測試、本機預覽用：全部放記憶體 */
export function createMemoryStore() {
  const tables = new Map(); // table → Map(id → { k, data })
  const t = (name) => { if (!tables.has(name)) tables.set(name, new Map()); return tables.get(name); };
  const copy = (x) => JSON.parse(JSON.stringify(x));
  return {
    get: (table, id) => { const r = t(table).get(id); return r ? copy(r.data) : null; },
    put: (table, id, data, k) => { t(table).set(id, { k: k === undefined ? '' : String(k), data: copy(data) }); },
    del: (table, id) => { t(table).delete(id); },
    all: (table) => [...t(table).entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, r]) => copy(r.data)),
    byK: (table, k) => [...t(table).entries()].filter(([, r]) => r.k === String(k)).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, r]) => copy(r.data)),
    delKBelow: (table, k) => { t(table).forEach((r, id) => { if (r.k < String(k)) t(table).delete(id); }); },
    count: (table) => t(table).size,
    ids: (table) => [...t(table).keys()].sort(),
    /** 一組寫入：記憶體版直接執行（SQLite 版包成交易，要嘛全寫要嘛全不寫） */
    tx: (fn) => fn()
  };
}

/** 正式：Durable Object 的 SQLite */
export function createSqlStore(storage) {
  const sql = storage.sql;
  sql.exec('CREATE TABLE IF NOT EXISTS docs (tbl TEXT NOT NULL, id TEXT NOT NULL, k TEXT NOT NULL DEFAULT \'\', data TEXT NOT NULL, PRIMARY KEY (tbl, id))');
  sql.exec('CREATE INDEX IF NOT EXISTS docs_k ON docs (tbl, k)');
  const rows = (cursor) => cursor.toArray().map((r) => JSON.parse(r.data));
  return {
    get: (table, id) => { const r = rows(sql.exec('SELECT data FROM docs WHERE tbl = ? AND id = ?', table, id)); return r.length ? r[0] : null; },
    put: (table, id, data, k) => {
      sql.exec('INSERT INTO docs (tbl, id, k, data) VALUES (?, ?, ?, ?) ON CONFLICT(tbl, id) DO UPDATE SET k = excluded.k, data = excluded.data',
        table, id, k === undefined ? '' : String(k), JSON.stringify(data));
    },
    del: (table, id) => { sql.exec('DELETE FROM docs WHERE tbl = ? AND id = ?', table, id); },
    all: (table) => rows(sql.exec('SELECT data FROM docs WHERE tbl = ? ORDER BY id', table)),
    byK: (table, k) => rows(sql.exec('SELECT data FROM docs WHERE tbl = ? AND k = ? ORDER BY id', table, String(k))),
    delKBelow: (table, k) => { sql.exec('DELETE FROM docs WHERE tbl = ? AND k < ?', table, String(k)); },
    count: (table) => sql.exec('SELECT COUNT(*) AS n FROM docs WHERE tbl = ?', table).toArray()[0].n,
    ids: (table) => sql.exec('SELECT id FROM docs WHERE tbl = ? ORDER BY id', table).toArray().map((r) => r.id),
    tx: (fn) => storage.transactionSync(fn)
  };
}
