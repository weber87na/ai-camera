# 映像間｜AI 風格照相館

手機直式優先的活動用 AI 肖像網站。前端與 Node.js API 部署在同一個 Azure App Service，不需要 Azure Functions、Blob Storage 或外部 Queue。

## 網頁入口

執行 `npm start` 後，以下連結可直接開啟本機頁面（預設埠號為 `3000`）。部署到 Azure App Service 時，將 `http://localhost:3000` 替換成實際的 App Service 網址即可。

| 入口 | 用途 |
| --- | --- |
| [AI 風格照相館](http://localhost:3000/) | 選擇風格、拍照並生成 AI 肖像 |
| [作品藝廊](http://localhost:3000/gallery) | 瀏覽當日生成作品 |
| [歌仔戲抽獎](http://localhost:3000/opera) | 紙扇、紙傘、鎖鏈與九宮格 3D 抽獎舞台，僅歌仔戲模式可用 |
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

## 歌仔戲拍照模式

在 `.env`（或 Azure App Service 的 Environment variables）設定：

```dotenv
PHOTO_MODE=opera
```

儲存後重新啟動伺服器，並重新整理拍照頁面。也接受 `PHOTO_MODE=歌仔戲`。設為 `standard` 或不設定時，會使用原有十種風格；未知值會在啟動時報錯，避免活動現場意外顯示錯誤模式。

歌仔戲模式首頁提供四大角色，選定角色、輸入姓名後即可沿用拍照、確認、生成與分享流程：

| 角色 | 固定道具／對應禮品 | 造型方向 |
| --- | --- | --- |
| 生 | 紙扇 | 清俊文生、戲帽與繡紋長袍，手持展開的紙扇 |
| 旦 | 鐵鍊 | 《目連救母》的母親，灰紫／淡紫素戲服、散落黑髮及悲切戲妝；雙手／前臂持著清楚可見的大型金屬鐵鍊 |
| 淨 | 紙傘 | 鮮明戲曲臉譜、厚重戲服及威武神韻，手持可辨認紙面與竹骨的紙傘 |
| 丑 | 甜點九宮格 | 聖誕老人融合歌仔戲：紅色金繡戲袍、白毛邊、聖誕戲帽與鼻樑白色丑妝，雙手端著 3×3、九格各放一份甜點的禮盒 |

歌仔戲使用獨立的真人舞台肖像提示詞，保留上傳人物的臉型、辨識度、年齡感及人數，並允許戲服、假髮、戲妝與舞台背景取代原造型。旦角固定為母親，不套用一般仕女造型；提示詞要求鐵鍊有清晰的連續金屬鏈節、橫過前景並垂落，近距離自拍可略微放寬構圖以容納雙手與鐵鍊。首頁是角色造型示意，實際生成仍由圖片模型決定。

拍照的選角、相機、確認、生成中與結果畫面，以及 `/gallery` 藝廊，使用深酒紅舞台、米金紙色的歌仔戲主題。首頁與藝廊加入 CSS／JS 紅色花瓣飄落效果；花瓣數量固定且不攔截點擊，頁面隱藏時暫停，減少動態效果設定啟用時關閉。拍攝、照片確認與燈箱預覽時也會暫停花瓣。其他體驗頁不受影響。

歌仔戲藝廊依實際照片數量動態建立三欄三列的九宮格，逐組往下排列，不分頁、不限制為 200 張。至少顯示一組九格，末組不足九張時留空位；例如 10 張顯示兩組共 18 格。沒有作品時先顯示首頁的生、旦、淨、丑四張角色示意圖，另外五格留空；有實際作品後自動替換示意圖，示意圖不會寫入照片清單或抽獎資料。圖片延遲載入並非同步解碼，每 10 秒差異更新，保留既有圖片與燈箱狀態，新增或刪除照片時自動增減完整九宮格。手機會縮小間距，作品與燈箱完整保留照片，不裁掉鐵鍊。

首頁使用單張大照片輪播，左右滑動、拖曳或按方向鍵切換角色，照片下方只顯示「生、旦、淨、丑」單字。目前顯示的角色即為選擇，預設為「生」。四張直式角色預覽（`public/images/opera-*-portrait.png`）及專案中的透明道具素材皆由內建 imagegen 生成，完整提示詞保存在 [`docs/opera-image-prompts.json`](docs/opera-image-prompts.json)。這些是選角示意；拍照生成仍使用參與者上傳照片及 `opera.js` 的角色提示詞。

`GET /api/config` 提供目前模式、可選角色與固定道具，不含提示詞或金鑰。`POST /api/generate` 在歌仔戲模式須傳 `style=opera` 及 `role=sheng|dan|jing|chou`；後端會拒絕不符合目前模式的選項。工作狀態與 `storage/results.jsonl` 會記錄 `mode`、`style`、`role`、`propId` 及 `propName`，方便後續對應禮品。道具由後端依角色決定，不能由前端任意更換。角色設定與提示詞在 `opera.js`，模式切換與驗證在 `camera-mode.js`。

### 歌仔戲抽獎頁

設定 `PHOTO_MODE=opera` 並重新啟動後，開啟 [`/opera`](http://localhost:3000/opera)。`PHOTO_MODE=歌仔戲` 也可使用；其他模式下，`/opera`、`/opera/` 與 `/opera.html` 均由伺服器回傳 404。

Three.js 舞台參考 riddle 的黑色展台：紙扇、紙傘、鎖鏈與九宮格繞成有前後深度的環形，前方道具放大，搭配暖金霧光與 riddle 原版透明落葉素材及飄動效果。左右拖曳、滾輪或方向鍵可環繞切換，點選任一道具或按 Enter／空白鍵即可抽獎。頁面沒有可見的標題、道具標籤、說明與名單數字，結果只保留中獎姓名；播放與關閉操作使用無文字圖示，狀態訊息僅供輔助閱讀器。四個道具共用台北時間當日的作品池，不依拍照時所選角色分組；每次獨立隨機抽選，同一位參與者可能重複中獎。

扇面與傘面使用內建 imagegen 依提供的戲曲人物參考圖繪製的高解析圖案，保留 Three.js 實際摺痕、扇骨及傘內竹肋。貼圖為 `public/images/opera-fan-art-v1.png`、`public/images/opera-umbrella-art-v1.png`，完整提示詞見 `docs/opera-fan-art-prompt.json`、`docs/opera-umbrella-art-prompt.json`。扇骨、傘架、傘柄及空的九宮格木箱使用有方向性的木紋與竹紋；鎖鏈由 29 個交錯金屬環組成。木頭與金屬材質皆包含色彩、凹凸與粗糙度貼圖，由 `public/opera-materials.js` 管理。自然木紋 `public/images/opera-wood-grain-v1.png` 由內建 imagegen 生成，提示詞見 `docs/opera-wood-grain-prompt.json`；原版落葉素材及來源見 `public/images/opera-yellow-leaves/SOURCE.json`。

- `VIDEO_ENABLED=true`：僅抽選已完成且有配對 MP4 的參與者，播放中獎人的影片；生成中、失敗或僅有照片的作品不會加入影片抽獎。
- `VIDEO_ENABLED=false`：從當日照片抽選，顯示中獎人的圖片。

抽獎沿用 `GET /api/config` 的公開設定及 `GET /api/photos/:date` 的照片、影片與姓名資料；沒有符合條件的作品時提供無文字重新整理圖示。影片失敗時顯示同一位中獎人的照片，不重新抽選。

## 照片轉影片（選用）

在 `.env` 設定下列選項，儲存後重新啟動伺服器。預設關閉，啟用時必須有 `XAI_API_KEY`：

```dotenv
XAI_API_KEY=你的_xAI_API_金鑰
VIDEO_ENABLED=true
VIDEO_MODEL=grok-imagine-video-1.5-lite
VIDEO_DURATION=3
VIDEO_RESOLUTION=720p
VIDEO_GENERATE_AUDIO=false
VIDEO_TIMEOUT_MS=600000
VIDEO_POLL_INTERVAL_MS=5000
```

`VIDEO_DURATION` 接受 1～15 秒，解析度可選 `480p`、`720p`、`1080p`。`VIDEO_GENERATE_AUDIO=false` 會傳送 `generate_audio: false` 要求無聲影片。照片轉影片會直接使用完成的 AI 照片作為第一幀，原始圖片資料保持不變、不裁切、不補邊，也不傳送比例參數，影片比例沿用照片。模型須支援所選解析度；詳見 [xAI 影片生成文件](https://docs.x.ai/developers/model-capabilities/video/generation)。

啟用後，原本的圖片工作會接續提交 xAI 非同步影片工作、查詢進度並下載成品。影片提示詞在 `video-generation.js`，歌仔戲四個角色分別使用指定的生、旦、淨、丑表演文字，並保留各自固定道具與無聲條件。`XAI_BASE_URL` 預設為 `https://api.x.ai/v1`，通常不需修改。API 金鑰只在伺服器使用。

完成畫面會播放影片，分享／下載也會使用 MP4。gallery 九宮格仍載入照片縮圖，點開有影片的作品才載入單一影片燈箱，關閉時停止播放並卸載；原有純照片與示意圖仍可正常瀏覽。影片失敗或逾時時保留照片，完成畫面會顯示提示，避免重新生成已完成的照片。關閉功能後恢復圖片展示流程。

JPEG 與 MP4 保存在 `storage/YYYY-MM-DD/`，使用相同檔名主體；影片不依賴會過期的 xAI 下載網址。`results.jsonl` 另存 `videoFile`、`videoMetadata` 與影像／影片費用。`GET /api/photos/:date` 保留既有 `images` 圖片陣列與抽獎候選，僅在啟用功能且有配對影片時，在 `photos` 項目中加入 `video`。示意圖不會送入影片 API 或抽獎資料。

顯示費用會合計圖片估算與 xAI 回傳的影片用量費用；若影片服務未提供費用，總額顯示「依帳單為準」，不將圖片費用冒充為完整影片費用。模擬 API 測試不會呼叫正式服務或產生生成費用。

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

可選環境變數請參考 `.env.example`。部署時請將既有的 `IMAGE_QUALITY` 設為 `high`，避免舊環境的 `low` 覆蓋新預設。

## 圖片模型與成本

圖片編輯使用 `gpt-image-2.5-flare`，預設品質 `high`，輸出維持 `1024x1536` JPEG。模型與品質依據 [OpenAI 模型文件](https://developers.openai.com/api/docs/models/gpt-image-2.5-flare)。

依 [OpenAI 官方價格](https://developers.openai.com/api/docs/pricing)（2026-09-09 查核），每百萬 tokens 的美元費率如下：

| 類別 | 一般 | 快取 |
| --- | ---: | ---: |
| 文字輸入 | $5 | $1.25 |
| 圖片輸入 | $8 | $2 |
| 圖片輸出 | $30 | — |

`image-config.js` 依回傳的 `usage` 計算文字輸入、圖片輸入及圖片輸出費用，再以 `USD_TO_TWD` 換算新台幣。品質影響 token 用量，不能沿用舊模型的固定每張價格。若提供 `output_tokens_details.image_tokens`，只計入圖片輸出；缺少必要 usage 時回傳未知成本，前端顯示「依帳單為準」。

[Images API 文件](https://developers.openai.com/api/reference/resources/images/methods/edit) 尚未列出文字與圖片各自的快取 token 明細，因此輸入成本以一般費率估算，未扣快取折扣，可能高於帳單。價格可用既有環境變數覆寫，實際費用以 OpenAI 帳單為準；匯率是本機設定，並非 OpenAI 官方匯率。

執行 `npm test` 驗證成本計算、模式切換、角色提示詞及 API 驗證；測試使用空白 API 金鑰，不會呼叫 OpenAI。`npm run check` 檢查程式語法。
