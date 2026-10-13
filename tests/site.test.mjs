// 前後端設定一致、Service Worker 快取名稱、版本號、公開檔案裡沒有手機號碼。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { SITE } from '../worker/src/site.js';

const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('前後端的名稱、區名、類別一致', () => {
  const ctx = { window: {} };
  vm.runInNewContext(read('js/site.js'), ctx);
  const f = ctx.window.SITE;
  ['name', 'fentan', 'testRegion', 'superAccount'].forEach((k) => assert.equal(f[k], SITE[k], k));
  assert.deepEqual([...f.units], SITE.units);
  assert.deepEqual([...f.categories], SITE.categories);
  assert.deepEqual([...f.modes], SITE.modes);
});

test('Service Worker：快取名稱帶網站路徑，只清自己的', () => {
  const sw = read('sw.js');
  assert.match(sw, /const PREFIX = 'region-signup:' \+ new URL\('\.\/', self\.location\)\.pathname/);
  assert.match(sw, /k\.indexOf\(PREFIX\) === 0 && k !== CACHE/);
});

test('index.html 的版本號都一樣', () => {
  const versions = new Set([...read('index.html').matchAll(/\?v=(\w+)/g)].map((m) => m[1]));
  assert.equal(versions.size, 1, [...versions].join(', '));
});

test('公開檔案裡沒有手機號碼', () => {
  ['index.html', 'js/help.js', 'docs/spec.md', 'tools/dev-server.js', 'tests/worker.test.mjs'].forEach((f) => assert.doesNotMatch(read(f), /09\d{2}-?\d{3}-?\d{3}/, f));
});
