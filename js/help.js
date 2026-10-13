// 常見問題（#/help）。每次加新功能或畫面改變，都要同時更新這裡。
(function () {
  'use strict';

  const ITEMS = [
    { cat: '報名', q: '怎麼報名？', a: `
      <ol class="help-steps">
        <li><span class="help-num">1</span><span>打開您的區的行事曆，點要報名的活動。</span></li>
        <li><span class="help-num">2</span><span>多天的活動先勾日期，再選了愿項目（滿了的會變灰、寫「額滿」）。</span></li>
        <li><span class="help-num">3</span><span>填名字按「＋ 加入」，可以幫家人一起報（一次最多 10 位）。</span></li>
        <li><span class="help-num">4</span><span>按「確認報名」，看到「報名成功」就好了。</span></li>
      </ol>
      <p>同一個人同一天、同一個活動只能報一個了愿項目；名字很像的（例如「小明」和「王小明」）會當成同一個人。一次報好幾位時，只要有一位報不了，這次都不會送出，畫面會寫原因。</p>` },
    { cat: '報名', q: '怎麼取消或改期？', a: `
      <p>按「查我的報名（取消／改期）」，輸入報名時的名字（要一模一樣），就會列出今天起的報名，可以取消或改到同一個活動的其他天、換了愿項目。</p>
      <p><strong>活動當天和之後</strong>不能自己報名、取消、改期，請聯絡區管理者。</p>` },
    { cat: '報名', q: '「缺 2 人」「額滿」「已報 5 人」是什麼意思？', a: `
      <ul class="help-bullets">
        <li><span class="badge badge-short">缺 2 人</span>：勤務還需要人手。</li>
        <li><span class="badge badge-full">額滿</span>：名額滿了，不能再報。</li>
        <li><span class="badge badge-ok">已報 5 人</span>：自由參加的活動（道務、教育），或不限名額的勤務。</li>
      </ul>` },
    { cat: '報名', q: '名單誰看得到？會給分壇嗎？', a: `
      <p>活動頁的報名名單大家都看得到（只有名字）。各區的報名會自動彙整到<strong>宏教分壇行事曆</strong>的「報名統計」，不用另外回報。</p>` },
    { cat: '手機', q: '怎麼換區？', a: '<p>行事曆上方按「換區」，選別的區。</p>' },
    { cat: '手機', q: '怎麼加到手機主畫面？', a: `
      <p><strong>iPhone（Safari）</strong>：按下面的「分享」→「加入主畫面」→「加入」。</p>
      <p><strong>Android（Chrome）</strong>：按右上角「⋮」→「加到主畫面」或「安裝應用程式」。</p>
      <p>加之前先打開您的區，這樣從主畫面打開就直接是您的區。</p>` },
    { cat: '管理者', q: '區管理者怎麼新增活動、看名單？', a: `
      <ol class="help-steps">
        <li><span class="help-num">1</span><span>按最下面的「管理者」，帳號選您的區，輸入分壇給您的密碼。</span></li>
        <li><span class="help-num">2</span><span>「＋ 新增活動」：填名稱、日期、時間、地點；要報名的活動加上了愿項目和最少、最多人數。</span></li>
        <li><span class="help-num">3</span><span>活動列表按「名單」：看每天誰報了，可以取消、改期、幫人報名（不受當天和名額限制）。</span></li>
      </ol>` },
    { cat: '報名', q: '「分壇分配」是什麼？', a: `
      <p>標「分壇分配」的是宏教分壇派給本區的勤務（例如統班烹飪、宏宗獻供拜香）。家人照樣在這裡報名，分壇就看得到本區報了誰。</p>
      <p>這些勤務的時間、地點、名額由分壇安排，區管理者不能改；有問題請聯絡分壇。</p>` },
    { cat: '管理者', q: '分壇怎麼開設新的區？', a: `
      <p>分壇總管理者登入後，在「區」分頁按那一區的「開設」，設定區管理者的密碼（至少 6 個字），選「開放」或「測試」。「測試」的區家人看不到、分壇行事曆也不會讀，可以先試用。</p>` }
  ];

  let open = null;

  function show(view) {
    const cats = [...new Set(ITEMS.map((x) => x.cat))];
    const draw = () => {
      view.innerHTML = `<h1 class="admin-title">常見問題</h1>${cats.map((cat) => `
        <h2 class="help-cat-title">${Fmt.esc(cat)}</h2>
        ${ITEMS.filter((x) => x.cat === cat).map((it) => {
          const i = ITEMS.indexOf(it);
          return `<div class="help-item${open === i ? ' is-open' : ''}"><button type="button" class="help-qbtn" data-i="${i}" aria-expanded="${open === i}"><span class="help-qtext">${Fmt.esc(it.q)}</span><span class="help-chev" aria-hidden="true">${open === i ? '−' : '＋'}</span></button>${open === i ? `<div class="help-answer">${it.a}</div>` : ''}</div>`;
        }).join('')}`).join('')}<button type="button" class="btn btn-block back-btn" data-back>‹ 回上一頁</button>`;
      view.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => { const i = Number(b.dataset.i); open = open === i ? null : i; draw(); }));
      view.querySelector('[data-back]').addEventListener('click', () => history.back());
    };
    draw();
  }

  window.HelpPage = { show };
})();
