import { getVideoConfig, isLoopbackUrl } from "./video-config.js";
import { getBeautyVideoPrompt } from "./opera-beauty.js";
import { getHandsomeVideoPrompt } from "./opera-handsome.js";

const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const MAX_JSON_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30000;

const ROLE_MOTION = Object.freeze({
  sheng: "以原圖生角人物為主角，完整保留原有五官、黑色書生帽、青藍色金色竹紋長袍、白色水袖及梅花摺扇。人物展現臺灣歌仔戲小生儒雅瀟灑的傳統戲曲身段。起初微微側頭，目光溫柔地望向遠方，接著右手優雅地將展開的摺扇輕輕抬高，在胸前緩慢搖動一次，另一隻手配合做出含蓄的戲曲手勢，白色長袖自然垂落輕輕擺動。人物露出淡淡微笑，身體輕微側轉，最後停留在俊雅的書生亮相姿勢。鏡頭平穩緩慢推近，柔和暖色舞台光線，寫實傳統戲曲電影質感。",
  dan: "以原圖旦角人物為主角，保持人物容貌、紫色傳統戲服、長髮造型、雙手鐵鍊及紅色舞台布幕一致。人物展現臺灣歌仔戲旦角優雅而哀傷的傳統表演，眼神緩緩望向斜上方，眉頭微蹙，眼眶帶著淚光，嘴唇輕輕開合，彷彿正在唱出哀怨婉轉的歌仔戲唱腔。雙手緩慢抬起，鐵鍊隨動作自然下垂並輕輕晃動，衣袖柔順飄動。人物姿態端莊，動作柔美細膩，鏡頭緩慢推近至上半身，戲劇舞台暖色聚光燈，寫實電影級畫質。",
  jing: "以原圖淨角人物為唯一主角，保留原有戲曲臉譜、官帽、黑色長鬍鬚、華麗刺繡戲服及手持油紙傘。人物展現臺灣歌仔戲淨角威武莊嚴的舞台身段。開場目光凌厲地注視前方，接著緩慢轉頭，雙眼有力地瞪視側前方，下巴微微抬起，呈現威嚴的英雄氣勢。持傘的手微微調整姿勢，油紙傘輕輕傾斜，長鬍鬚及寬大衣袖隨動作自然擺動，另一隻手保持叉腰姿勢。最後定格於威風凜凜的戲曲亮相動作。鏡頭由全身緩慢推近，莊嚴舞台燈光，電影級寫實影像。",
  chou: "以原圖人物為唯一主角，保持原有臉部五官、服裝、紅色聖誕帽、糕點禮盒及舞台背景完全一致。人物展現臺灣歌仔戲丑角詼諧逗趣的表演，先俏皮地挑起眉毛，眼珠靈活地向左右轉動，接著頭部輕輕歪向一側，露出調皮得意的笑容。雙手穩穩捧著九宮格糕點禮盒，身體輕微左右搖擺，彷彿正在向觀眾獻寶。動作自然連貫，具有傳統歌仔戲丑角幽默的舞台節奏。鏡頭緩慢推近，暖色舞台燈光，寫實戲曲表演質感。"
});

const ROLE_CONTINUITY = Object.freeze({
  sheng: "完整紙扇、扇骨與持扇的手始終清楚可見，不收扇、不更換道具。",
  dan: "旦角固定為《目連救母》中的母親；兩手之間醒目的 U 形鐵鍊、粗大橢圓金屬鏈環、雙手與前臂始終完整可見。推近時絕不可裁掉鐵鍊或雙手，不加入目連、鬼卒或其他人，不將鍊條套在頸部，無傷害或暴力。",
  jing: "圓形紙傘面、竹製傘骨、傘柄與持傘的手始終可見，不收傘、不遮臉，不替換道具。",
  chou: "維持原圖聖誕老人融合歌仔戲服裝、小白鼻妝及白毛邊，不增加白鬍鬚、不改變年齡或體型。禮盒必須始終呈現恰好 3 × 3 = 9 格，每格一件甜點；九格、九件甜點、托盤四邊與雙手完整入鏡，不增減、融化、飛散或交換甜點。"
});

export function getVideoPrompt({ mode, role, style, generateAudio = false }) {
  if (mode === "opera") {
    const beautyPrompt = getBeautyVideoPrompt(role, generateAudio);
    if (beautyPrompt) return beautyPrompt;
    const handsomePrompt = getHandsomeVideoPrompt(role, generateAudio);
    if (handsomePrompt) return handsomePrompt;
  }
  const common = "以輸入照片作為第一幀，製作自然連續的短影片。保持原圖人物數量、每個人的容貌、五官、年齡、服裝、髮型、畫面風格、道具與背景一致，不換臉、不新增人物或物件。保留人物與道具完整構圖，動作細微且符合人體結構，不裁切重要道具，不產生多餘手指或肢體。鏡頭平穩、沒有快速移動或切鏡，不新增文字、字幕、標誌、浮水印或邊框。";
  let action;
  if (mode === "opera") {
    if (typeof role !== "string" || !Object.hasOwn(ROLE_MOTION, role)) throw new Error("歌仔戲影片角色無效。");
    // Keep the user's approved motion paragraph verbatim; continuity rules are separate.
    action = `${ROLE_MOTION[role]}\n${ROLE_CONTINUITY[role]}`;
  } else {
    action = "保持原圖既有的美術風格與色彩，人物自然眨眼、微笑、輕輕呼吸與略微轉頭，服裝與頭髮小幅自然移動。鏡頭保持穩定，讓原本的照片溫柔地動起來。";
  }
  const audio = generateAudio
    ? "可配合畫面提供柔和自然的環境音，不新增旁白或字幕。"
    : "全片必須無聲：不要音樂、歌聲、對白、旁白、環境音或音效。嘴唇的微小動作僅作為無聲表演。";
  return `${common}\n${action}\n${audio}`;
}

function videoError(message, code = "VIDEO_GENERATION_FAILED") {
  return Object.assign(new Error(message), { code });
}

function safeVideoUrl(raw, allowLocalHttp) {
  let url;
  try { url = new URL(raw); } catch { throw videoError("影片服務回傳無效的下載網址。"); }
  if ((url.protocol !== "https:" && !(allowLocalHttp && url.protocol === "http:" && isLoopbackUrl(url))) ||
      url.username || url.password) throw videoError("影片下載網址必須使用 HTTPS。");
  return url.href;
}

async function readBounded(response, maxBytes) {
  const advertised = Number(response.headers.get("content-length"));
  if (Number.isFinite(advertised) && advertised > maxBytes) {
    await response.body?.cancel();
    throw videoError("影片服務回傳的資料超過大小限制。");
  }
  if (!response.body) throw videoError("影片服務回傳空白資料。");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw videoError("影片服務回傳的資料超過大小限制。");
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

/** Submit once, poll until done, and save the expiring CDN output locally. */
export async function generateVideo({
  image, mode, style, role, config = getVideoConfig(), apiKey, onProgress = () => {},
  fetchFn = fetch, sleepFn = ms => new Promise(resolve => setTimeout(resolve, ms)), nowFn = Date.now
}) {
  if (!config.enabled) throw videoError("照片轉影片功能尚未啟用。", "VIDEO_DISABLED");
  if (typeof apiKey !== "string" || !apiKey.trim()) throw videoError("啟用照片轉影片時必須設定 XAI_API_KEY。", "VIDEO_CONFIG_ERROR");
  if (!Buffer.isBuffer(image) || image.length === 0) throw videoError("照片轉影片需要有效的圖片資料。");
  const deadline = nowFn() + config.timeoutMs;
  const timeoutError = () => videoError("影片生成逾時，請稍後再試。", "VIDEO_TIMEOUT");
  const remaining = () => {
    const ms = deadline - nowFn();
    if (ms <= 0) throw timeoutError();
    return ms;
  };
  const emit = event => onProgress(event);
  const endpoint = `${config.baseUrl}/videos`;
  const headers = { Authorization: `Bearer ${apiKey.trim()}`, "Content-Type": "application/json" };
  const allowLocalHttp = isLoopbackUrl(new URL(config.baseUrl));

  async function bounded(operation) {
    const controller = new AbortController();
    const ms = Math.min(REQUEST_TIMEOUT_MS, remaining());
    let timer;
    const timedOut = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(timeoutError());
      }, ms);
    });
    try { return await Promise.race([operation(controller.signal), timedOut]); }
    finally { clearTimeout(timer); }
  }

  async function apiRequest(url, options = {}) {
    return bounded(async signal => {
      const response = await fetchFn(url, { ...options, headers, signal, redirect: "error" });
      if (!response.ok) {
        // Do not surface provider bodies: they can include prompts or signed URLs.
        await response.body?.cancel();
        throw Object.assign(videoError(`影片服務請求失敗（HTTP ${response.status}）。`), { status: response.status });
      }
      try { return JSON.parse((await readBounded(response, MAX_JSON_BYTES)).toString("utf8")); }
      catch (error) {
        if (error instanceof SyntaxError) throw videoError("影片服務回傳無效的 JSON 資料。");
        throw error;
      }
    });
  }

  const prompt = getVideoPrompt({ mode, style, role, generateAudio: config.generateAudio });
  remaining();
  emit({ stage: "submitting" });
  // Deliberately no POST retry: a lost response can still represent a billed job.
  const submitted = await apiRequest(`${endpoint}/generations`, {
    method: "POST",
    body: JSON.stringify({
      model: config.model,
      prompt,
      // I2V inherits this original frame's ratio. Preserve every source byte;
      // do not crop, pad, resize, or override aspect_ratio.
      image: { url: `data:image/jpeg;base64,${image.toString("base64")}` },
      duration: config.duration,
      resolution: config.resolution,
      generate_audio: config.generateAudio
    })
  });
  const requestId = submitted?.request_id;
  if (typeof requestId !== "string" || !requestId.trim() || requestId.length > 256) {
    throw videoError("影片服務未回傳有效的 request_id。");
  }
  emit({ stage: "generating", requestId, progress: 0 });

  let completed;
  while (!completed) {
    remaining();
    let result;
    try { result = await apiRequest(`${endpoint}/${encodeURIComponent(requestId)}`); }
    catch (error) {
      if (!(error.status === 429 || error.status >= 500)) throw error;
      await sleepFn(Math.min(config.pollIntervalMs, remaining()));
      continue;
    }
    if (result?.status === "done") {
      completed = result;
      break;
    }
    if (result?.status === "failed" || result?.status === "expired") {
      throw videoError("影片生成失敗或工作已過期，請稍後再試。");
    }
    if (result?.status !== "pending") throw videoError("影片服務回傳未知的工作狀態。");
    const progress = Number.isInteger(result.progress) ? Math.max(0, Math.min(99, result.progress)) : undefined;
    emit({ stage: "generating", requestId, ...(progress === undefined ? {} : { progress }) });
    await sleepFn(Math.min(config.pollIntervalMs, remaining()));
  }

  if (completed.video?.respect_moderation === false) throw videoError("影片未通過內容檢查，請更換照片後重試。", "VIDEO_MODERATION");
  if (typeof completed.video?.url !== "string" || !completed.video.url.trim()) {
    throw videoError("影片服務完成工作，但沒有回傳可下載的影片。");
  }
  if (completed.video.respect_moderation !== true) throw videoError("影片服務回傳的內容檢查狀態無效。");
  let videoUrl = safeVideoUrl(completed.video.url, allowLocalHttp);
  emit({ stage: "downloading", requestId, progress: 100 });
  const buffer = await bounded(async signal => {
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      // The API key is never sent to the CDN, including after redirects.
      const response = await fetchFn(videoUrl, { signal, redirect: "manual", headers: { Accept: "video/mp4, application/octet-stream" } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const next = response.headers.get("location");
        await response.body?.cancel();
        if (!next) throw videoError("影片下載重新導向缺少網址。");
        videoUrl = safeVideoUrl(new URL(next, videoUrl).href, allowLocalHttp);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw videoError(`影片下載失敗（HTTP ${response.status}）。`);
      }
      const data = await readBounded(response, MAX_VIDEO_BYTES);
      if (data.length < 12 || data.toString("ascii", 4, 8) !== "ftyp") throw videoError("下載的檔案不是有效的 MP4 影片。");
      return data;
    }
    throw videoError("影片下載重新導向次數過多。");
  });
  const ticks = completed.usage?.cost_in_usd_ticks;
  return {
    buffer,
    requestId,
    model: typeof completed.model === "string" && completed.model ? completed.model : config.model,
    duration: Number.isFinite(completed.video.duration) && completed.video.duration > 0 ? completed.video.duration : config.duration,
    resolution: config.resolution,
    generateAudio: config.generateAudio,
    usage: completed.usage ?? null,
    ...(Number.isFinite(ticks) && ticks >= 0 ? { costUsd: ticks / 10_000_000_000 } : {})
  };
}
