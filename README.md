# 各區報名系統

宏教分壇第二階段：一套系統放很多區，每區自己的行事曆與報名；分壇行事曆自動讀各區的報名。

- 規格書：[docs/spec.md](docs/spec.md)
- 本機預覽：`node tools/dev-server.js --mock`
- 測試：`node --test`
- 部署：`cd worker`，再 `npx.cmd wrangler deploy`；分壇總管理者密碼 `npx.cmd wrangler secret put SUPER_PASSWORD`
