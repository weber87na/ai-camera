# 映像間｜AI 風格照相館

手機直式優先的活動用 AI 肖像網站。前端與 Node.js API 部署在同一個 Azure App Service，不需要 Azure Functions、Blob Storage 或外部 Queue。

## 網頁入口

執行 `npm start` 後，以下連結可直接開啟本機頁面（預設埠號為 `3000`）。部署到 Azure App Service 時，將 `http://localhost:3000` 替換成實際的 App Service 網址即可。

| 入口 | 用途 |
| --- | --- |
| [AI 風格照相館](http://localhost:3000/) | 選擇風格、拍照並生成 AI 肖像 |
| [作品藝廊](http://localhost:3000/gallery) | 瀏覽當日生成作品 |
| [膠捲抽選](http://localhost:3000/lottery) | 以膠捲形式展示當日作品並進行抽選 |
| [顏料吸收](http://localhost:3000/painter) | 顏料吸收動畫與中獎圖片展示 |
| [中華一番／小當家魔法](http://localhost:3000/chinese-magic) | 3D 魔法展示與抽選體驗 |
| [辛普森魔法抽卡](http://localhost:3000/simpsons-magic) | 辛普森主題 3D 抽卡體驗 |
| [HUNTER × HUNTER 鎖鏈抽卡](http://localhost:3000/hunterxhunter) | 酷拉皮卡鎖鏈抽卡體驗 |
| [迪士尼魔法](http://localhost:3000/disney) | 迪士尼主題 3D 魔法展示 |
| [月面航線](http://localhost:3000/starship) | 駕駛艙視角飛向月球的太空體驗 |

### API 入口

| 入口 | 用途 |
| --- | --- |
| [健康檢查](http://localhost:3000/api/health) | 查看服務狀態、生成中與排隊中的工作數量 |
| `/api/photos/YYYY-MM-DD` | 取得指定日期已儲存圖片的公開 URL，例如 `/api/photos/2026-08-09` |

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

## 世紀廳 LED 顯示

世紀廳 LED 原生畫布為 `3008 × 1376`。現場模式使用固定邏輯畫布，並在控制器要求 `1920 × 1080` 訊號時預先壓縮；LED 控制器拉回原生尺寸後，畫面會恢復正確比例。

1. 執行 `npm start`。
2. Windows 顯示模式選擇「延伸」，不要使用「同步顯示」。
3. 將外接顯示器設為 `1920 × 1080`，Windows 縮放與瀏覽器縮放都設為 `100%`。
4. 在 Chrome 開啟 `http://localhost:3000/starship?display=century`。
5. 把 Chrome 視窗移到外接顯示器，按 `F11` 進入全螢幕。

在電腦的 `1920 × 1080` 預覽上，月球、人物照片與按鈕會刻意呈現水平壓窄；經 LED 控制器拉伸至 `3008 × 1376` 後才會恢復正常比例。若 Windows 可直接輸出 `3008 × 1376`，同一網址會自動改用 1:1 顯示，不需更換參數。

獵人、迪士尼、顏料、辛普森與道士頁面都支援相同參數；從 Starship 進入體驗或返回大廳時會自動保留 `display=century`。

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
