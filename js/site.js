// 系統設定（前端）。和後端 worker/src/site.js 的共同欄位要一致（tests/site.test.mjs 會檢查）。
(function () {
  window.SITE = {
    name: '各區報名系統',
    fentan: '宏教分壇',
    units: ['教真區', '教善區', '教美區', '教志區', '教孝區', '教仁區', '教勇區', '教定區',
      '教慧區', '教力區', '教發區', '教慈區', '教捨區', '教全區', '教振區', '教理區'],
    testRegion: '測試區',
    superAccount: '分壇總管理者',
    categories: ['勤務', '道務', '教育'],
    modes: ['報名型', '公告型'],
    categoryLabels: { 勤務: '總務・勤務', 道務: '道務', 教育: '教育' }
  };
})();
