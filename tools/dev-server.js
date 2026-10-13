// 本機預覽用的靜態伺服器（不需安裝套件）。執行：node tools/dev-server.js --mock，連接埠用環境變數 PORT（沒有就 5190）。
// --mock：跑和正式相同的 Worker 程式（資料放記憶體）。總管理者密碼 test-super；測試區 test-pass、教真區 zhen-pass。
// 示範活動與報名都是假資料（假名）。
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const mock = process.argv.includes('--mock');
const port = Number(process.env.PORT) || 5190;
const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

const day = (n) => new Date(Date.now() + 8 * 3600e3 + n * 86400e3).toISOString().slice(0, 10);

let front = null;
async function startMock() {
  const { createFront } = await import('../worker/src/front.js');
  const { createRegistryApp } = await import('../worker/src/registry-app.js');
  const { createRegionApp } = await import('../worker/src/region-app.js');
  const { createMemoryStore } = await import('../worker/src/store.js');
  const registry = createRegistryApp(createMemoryStore(), { superPassword: () => 'test-super' });
  const regions = new Map();
  const region = (name) => { if (!regions.has(name)) regions.set(name, createRegionApp(createMemoryStore(), { region: name })); return regions.get(name); };
  // 假的分壇行事曆：派給測試區的勤務（分壇分配）
  const fentanFake = [
    { id: 'E-demo1', source: 'local', unit: '測試區', kind: '分壇分配', category: '勤務', name: '統班烹飪（範例）', start: day(11), end: day(11), startTime: '07:00', endTime: '', location: '彌勒山', note: '每區 15 位，煮 150 人以上用餐。', positions: [{ id: 'P-cook', name: '烹飪', min: 15, max: null }] },
    { id: 'E-demo2', source: 'local', unit: '測試區', kind: '分壇分配', category: '道務', name: '宏宗獻供拜香（範例）', start: day(4), end: day(4), startTime: '', endTime: '', location: '宏宗', note: '', positions: [] },
    { id: 'E-demo3', source: 'local', unit: '測試區', kind: '區活動', category: '道務', name: '這筆不會出現（區活動）', start: day(4), end: day(4), startTime: '', endTime: '', location: '', note: '', positions: [] }
  ];
  front = createFront({
    registry: (b) => registry.call(b),
    region: (name, b, who) => region(name).call(b, who),
    fentan: async (year) => fentanFake.filter((e) => e.start.slice(0, 4) === String(year)),
    ttl: { regions: 0, events: 0, feed: 0, verify: 0, fentan: 0 }
  });

  // 示範資料
  const post = async (body) => (await front.handle(new Request('http://x/', { method: 'POST', body: JSON.stringify(body) }))).json();
  const sup = (await post({ action: 'adminLogin', account: '分壇總管理者', password: 'test-super' })).data.token;
  await post({ action: 'superSaveRegion', token: sup, name: '測試區', password: 'test-pass' });
  await post({ action: 'superSaveRegion', token: sup, name: '教真區', status: '開放', password: 'zhen-pass' });
  const tok = (await post({ action: 'adminLogin', account: '測試區', password: 'test-pass' })).data.token;
  const demo = [
    { category: '勤務', name: '區中心打掃（範例）', start: day(3), startTime: '08:00', endTime: '10:00', location: '區中心', positions: [{ name: '打掃', min: 3, max: 6 }, { name: '茶水', min: 1, max: 1 }] },
    { category: '道務', name: '研究班（範例）', start: day(5), startTime: '19:30', endTime: '21:30', location: '佛堂', positions: [{ name: '參加' }] },
    { category: '勤務', name: '彌勒山志工輪值（範例）', start: day(8), end: day(10), startTime: '09:00', endTime: '17:00', location: '彌勒山', positions: [{ name: '志工', max: 2 }] },
    { category: '道務', mode: '公告型', name: '初一拜香輪值（範例）', start: day(6), startTime: '07:30', location: '宏宗' }
  ];
  const evs = [];
  for (const e of demo) evs.push((await post({ action: 'adminSaveEvent', token: tok, region: '測試區', event: e })).data.event);
  await post({ action: 'signup', region: '測試區', eventId: evs[0].id, dates: [day(3)], positionId: evs[0].positions[0].id, names: ['王小明', '測試甲'] });
  await post({ action: 'signup', region: '測試區', eventId: evs[1].id, dates: [day(5)], positionId: evs[1].positions[0].id, names: ['測試乙', '測試丙', '李小華'] });
  await post({ action: 'signup', region: '測試區', eventId: evs[2].id, dates: [day(8), day(9)], positionId: evs[2].positions[0].id, names: ['陳大同'] });
  await post({ action: 'adminLogout', token: tok });
  await post({ action: 'adminLogout', token: sup });
}

async function handleApi(req, res, url) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const r = await front.handle(new Request('http://localhost/' + url.search, req.method === 'POST' ? { method: 'POST', body: Buffer.concat(chunks) } : { method: req.method }));
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = decodeURIComponent(url.pathname);
  if (mock && p === '/api') return handleApi(req, res, url);
  if (mock && p === '/js/config.js') {
    res.writeHead(200, { 'Content-Type': types['.js'], 'Cache-Control': 'no-store' });
    res.end("window.APP_CONFIG = { API_URL: '/api' };");
    return;
  }
  const file = path.join(root, p === '/' ? 'index.html' : p);
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
});
(mock ? startMock() : Promise.resolve()).then(() => server.listen(port, () => console.log(`http://localhost:${port}${mock ? '（模擬 API）' : ''}`)));
