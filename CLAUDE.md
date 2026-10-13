# CLAUDE.md

## 每次工作前

- **每次工作前先讀 `docs/spec.md`，所有開發以它為準。**
- 需求有變動時，先更新 `docs/spec.md`，再改程式。

## 公開儲存庫規則

- **本儲存庫是公開的，不可放任何人名、電話。** 程式碼、測試資料、範例、註解、文件、commit 訊息都一樣。測試用明顯的假名（測試甲、王小明）。
- 密碼（`SUPER_PASSWORD`、各區管理者密碼）由人自己輸入，不寫進程式碼；Claude 不經手真的密碼。

## 相關專案

- `D:\Projects\教全區行事曆\duty-calendar`：教全區的報名系統（報名規則的來源）。**只能讀，不可修改。**
- `D:\Projects\分壇行事曆`：分壇行事曆，會讀本系統的 `feed`。要改分壇那邊的程式，照分壇專案自己的 CLAUDE.md 和規格書。

## 開發流程

- 每完成一個段落就 commit 並 push。大功能先討論再做。
- `node --test` 全部通過才 commit。
- 改了 js、css 後把 `index.html` 裡 `?v=` 的日期換新。
- 每次加新功能或畫面改變，都要同時更新常見問題。
- 同網域（bailixiao.github.io）有好幾個網站：Service Worker 的快取名稱要帶網站路徑、只清自己的快取。
- 本機預覽用 `.claude/launch.json`（autoPort），不要固定連接埠。
- 使用者的終端機是 Windows PowerShell 5.1：給指令時一行一個、不用 `&&`，用 `npx.cmd`。
