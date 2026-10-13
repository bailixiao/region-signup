// 系統設定（後端）：名稱、可以開設的區、類別。和前端 js/site.js 的共同欄位要一致（tests/site.test.mjs 會檢查）。
export const SITE = {
  name: '各區報名系統',
  fentan: '宏教分壇',
  units: ['教真區', '教善區', '教美區', '教志區', '教孝區', '教仁區', '教勇區', '教定區',
    '教慧區', '教力區', '教發區', '教慈區', '教捨區', '教全區', '教振區', '教理區'],
  testRegion: '測試區', // 給管理者試用，家人看不到、分壇不讀
  superAccount: '分壇總管理者',
  categories: ['勤務', '道務', '教育'],
  // 分壇行事曆：分壇分配的勤務從這裡讀（規格第 5-1 節）
  fentanApi: 'https://fentan-calendar-api.duty-calendar-worker.workers.dev/',
  modes: ['報名型', '公告型']
};

/** 可以開設的區：16 區＋測試區 */
export const REGION_NAMES = SITE.units.concat(SITE.testRegion);
