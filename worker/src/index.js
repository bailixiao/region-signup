// Cloudflare Worker 入口（規格第 7 節）。
//   - 前門（front.js）在每個 Worker 裡跑，讀取有記憶體快取。
//   - registry Durable Object：區清單、帳號、登入。
//   - 每區一個 Durable Object（RegionStore，idFromName(區名)）：活動、報名、操作紀錄，各區分開存、分開排隊。
import { DurableObject } from 'cloudflare:workers';
import { createFront } from './front.js';
import { createRegistryApp } from './registry-app.js';
import { createRegionApp } from './region-app.js';
import { createSqlStore } from './store.js';
import { SITE } from './site.js';

export class Registry extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.app = createRegistryApp(createSqlStore(ctx.storage), { superPassword: () => env.SUPER_PASSWORD || '' });
  }
  call(body) {
    return this.app.call(body);
  }
}

export class RegionStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.store = createSqlStore(ctx.storage);
    this.apps = new Map(); // 區名 → app（同一個物件只會是同一區）
  }
  call(name, body, who) {
    if (!this.apps.has(name)) this.apps.set(name, createRegionApp(this.store, { region: name }));
    return this.apps.get(name).call(body, who);
  }
}

const apac = { locationHint: 'apac' }; // 第一次建立時放在亞太區（離台灣近）

let front = null;
export default {
  fetch(request, env) {
    if (!front) {
      front = createFront({
        registry: (body) => env.REGISTRY.get(env.REGISTRY.idFromName('main'), apac).call(body),
        region: (name, body, who) => env.REGION.get(env.REGION.idFromName(name), apac).call(name, body, who),
        // 分壇行事曆的公開 getEvents（一整年）
        fentan: async (year) => {
          const url = SITE.fentanApi + '?' + new URLSearchParams({ action: 'getEvents', from: year + '-01-01', to: year + '-12-31' });
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 8000);
          try {
            const body = await (await fetch(url, { signal: ctrl.signal })).json();
            if (!body || !body.ok) throw new Error('分壇行事曆回錯誤');
            return body.data.events;
          } finally {
            clearTimeout(timer);
          }
        }
      });
    }
    return front.handle(request);
  }
};
