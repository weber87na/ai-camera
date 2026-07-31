# 映像間｜AI 風格照相館

手機直式優先的活動用 AI 肖像網站。前端與 Node.js API 部署在同一個 Azure App Service，不需要 Azure Functions、Blob Storage 或外部 Queue。

## 專案結構

```text
ai-camera/
├─ public/
│  ├─ index.html
│  ├─ style.css
│  └─ app.js
├─ server.js
├─ styles.js
├─ package.json
└─ .env.example
```

## 本機啟動

使用 Node.js 20 以上版本：

```bash
npm install
copy .env.example .env
```

在 `.env` 填入 `OPENAI_API_KEY`，再執行：

```bash
npm start
```

開啟 `http://localhost:3000`。相機 API 需要 localhost 或 HTTPS。

## 活動保護

- 照片在前端壓縮為 JPEG，最長邊不超過 1536px。
- 上傳檔案上限 5MB。
- 預設最多同時生成 3 張，等候上限 30 張。
- 每台裝置最多成功生成 2 張。
- `requestId` 重複時不會再次呼叫 OpenAI。
- 排隊工作、裝置次數與結果只保存在 Node.js 記憶體。
- 完成或失敗的工作 10 分鐘後自動清除。

記憶體狀態會在 App Service 重啟或多執行個體時失效。因此 Azure App Service 第一版請固定使用單一執行個體；若日後需要水平擴充，再把工作與次數移至外部儲存。

## Azure App Service

1. 建立 Linux Node.js 20 App Service。
2. 將專案部署至 App Service。
3. 在 Configuration / Environment variables 設定 `OPENAI_API_KEY`。
4. Startup Command 留空，平台會執行 `npm start`。
5. 將 Always On 開啟，並保持單一執行個體。

可選環境變數請參考 `.env.example`。價格參數是估算用途，應按活動當天的 OpenAI 官方價格更新；實際費用以 OpenAI 帳單為準。
