import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import multer from "multer";
import OpenAI, { toFile } from "openai";
import { getCameraMode, getCameraConfig, getPhotoPrompt } from "./camera-mode.js";
import { OPERA_ROLES } from "./opera.js";
import { IMAGE_MODEL, DEFAULT_IMAGE_QUALITY, estimateCost } from "./image-config.js";
import { getVideoConfig } from "./video-config.js";
import { generateVideo } from "./video-generation.js";

const app = express();
const photoMode = getCameraMode();
const videoConfig = getVideoConfig();
const port = Number(process.env.PORT) || 3000;
const maxConcurrent = Number(process.env.MAX_CONCURRENT) || 3;
const maxQueue = Number(process.env.MAX_QUEUE) || 30;
const maxParticipantNameLength = 30;
const exchangeRate = Number(process.env.USD_TO_TWD) || 32.5;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "missing-key" });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 }
});

// ── Storage setup ──────────────────────────────────────────
const STORAGE_ROOT = process.env.STORAGE_DIR || "./storage";
const RESULTS_LOG  = path.join(STORAGE_ROOT, "results.jsonl");

fs.mkdirSync(STORAGE_ROOT, { recursive: true });

function taipeiDateString(timestamp = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(timestamp));

  const values = Object.fromEntries(
    parts
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function normalizeParticipantName(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function participantNameFilenamePart(value) {
  return normalizeParticipantName(value)
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001F\u007F]/g, "_")
    .replace(/\s+/g, "-")
    .replace(/\.+$/g, "")
    .slice(0, 60) || "unnamed";
}

function readStoredNamesByFile() {
  const names = new Map();

  try {
    const lines = fs.readFileSync(RESULTS_LOG, "utf8").split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const record = JSON.parse(line);
        const name = normalizeParticipantName(record?.name);
        if (typeof record?.file === "string" && name) {
          const normalizedFile = record.file.replaceAll("\\", "/");
          const filename = path.posix.basename(normalizedFile);
          names.set(normalizedFile, name);

          // A photo can be copied or moved to another date directory while
          // keeping its original filename. The filename and job id remain
          // stable, so keep those indexes as fallbacks for name lookup.
          names.set(`filename:${filename}`, name);
          const jobIdPrefix = filename.match(/^\d+-([0-9a-f]{8})-/i)?.[1];
          if (jobIdPrefix) names.set(`job:${jobIdPrefix.toLowerCase()}`, name);
        }
      } catch {
        // 略過損壞的單行紀錄，避免整份抽獎名單無法讀取。
      }
    }
  } catch {
    // results.jsonl 尚未建立時，照片 API 仍可正常回傳圖片。
  }

  return names;
}

function participantNameFromFilename(filename) {
  const match = String(filename || "").match(
    /^\d+-[0-9a-f]{8}-(.+)\.(?:jpe?g|png|webp|gif)$/i
  );
  if (!match) return "";

  const namePart = match[1].trim();
  if (!namePart || namePart.toLowerCase() === "unnamed") return "";
  return normalizeParticipantName(namePart.replace(/-/g, " "));
}

function findStoredPhotoName(date, filename, namesByFile) {
  const exactPathName = namesByFile.get(`${date}/${filename}`);
  if (exactPathName) return exactPathName;

  const filenameName = namesByFile.get(`filename:${filename}`);
  if (filenameName) return filenameName;

  const jobIdPrefix = filename.match(/^\d+-([0-9a-f]{8})-/i)?.[1];
  const jobName = jobIdPrefix && namesByFile.get(`job:${jobIdPrefix.toLowerCase()}`);
  return jobName || participantNameFromFilename(filename);
}

/**
 * 將完成的 job 存到 storage/YYYY-MM-DD/<timestamp>-<jobId8>-<name>.jpg
 * 並 append 一行 metadata 到 results.jsonl
 */
function resultFileInfo(job) {
  const date = taipeiDateString(job.createdAt);
  const directory = path.join(STORAGE_ROOT, date);
  const stem = `${job.createdAt}-${job.id.slice(0, 8)}-${participantNameFilenamePart(job.name)}`;
  fs.mkdirSync(directory, { recursive: true });
  return { date, directory, stem };
}

function persistImage(job) {
  if (job.file) return;
  const { date, directory, stem } = resultFileInfo(job);
  const filename = `${stem}.jpg`;
  const base64 = job.image.replace(/^data:image\/\w+;base64,/, "");
  fs.writeFileSync(path.join(directory, filename), Buffer.from(base64, "base64"));
  job.file = `${date}/${filename}`;
}

function persistVideo(job, buffer) {
  const { date, directory, stem } = resultFileInfo(job);
  const filename = `${stem}.mp4`;
  const temporary = path.join(directory, `${filename}.tmp`);
  try {
    fs.writeFileSync(temporary, buffer);
    fs.renameSync(temporary, path.join(directory, filename));
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  job.videoFile = `${date}/${filename}`;
  job.video = `/storage/${date}/${encodeURIComponent(filename)}`;
}

function persistResult(job) {
  try {
    persistImage(job);

    // Append metadata
    const record = {
      id:        job.id,
      name:      job.name,
      style:     job.style,
      mode:      job.mode,
      role:      job.role,
      propId:    job.propId,
      propName:  job.propName,
      deviceId:  job.deviceId,
      createdAt: job.createdAt,
      savedAt:   Date.now(),
      file:      job.file,
      videoFile: job.videoFile,
      videoMetadata: job.videoMetadata,
      videoWarning: job.videoWarning,
      imageCost: job.imageCost,
      videoCost: job.videoCost,
      usage:     job.usage,
      cost:      { usd: job.cost?.usd, twd: job.cost?.twd }
    };
    fs.appendFileSync(RESULTS_LOG, JSON.stringify(record) + "\n");

    console.log(`[${job.id}] 已儲存 ${record.file}`);
  } catch (err) {
    console.error(`[${job.id}] persistResult 失敗:`, err.message);
  }
}


// ── In-memory state ────────────────────────────────────────
const jobs      = new Map();
const requestIds = new Map();
const queue     = [];
let activeJobs  = 0;

app.disable("x-powered-by");
// Gate the page before express.static, which also serves .html URLs and decodes
// URL-encoded paths. Normalize Windows separators/case, NTFS stream suffixes,
// and trailing dots/spaces too, so aliases cannot expose it in standard mode.
app.use((req, res, next) => {
  let pathname;
  try {
    pathname = path.posix.normalize(decodeURIComponent(req.path).replaceAll("\\", "/"))
      .split("/").map(segment => segment.split(":")[0].replace(/[ .]+$/, "")).join("/")
      .replace(/\/+$/, "").toLowerCase();
  } catch {
    return next();
  }

  if (pathname !== "/opera" && pathname !== "/opera.html") return next();
  res.setHeader("Cache-Control", "no-store");
  if (photoMode !== "opera") return res.sendStatus(404);
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  return res.sendFile(path.resolve("public", "opera.html"));
});
app.use(express.static("public", { maxAge: 0, etag: true, extensions: ["html"] }));

// Three.js browser build for WebGL experiences such as painter.
app.use("/vendor/three", express.static(path.join(process.cwd(), "node_modules", "three", "build"), { maxAge: "7d" }));
app.use("/vendor/three-addons", express.static(path.join(process.cwd(), "node_modules", "three", "examples", "jsm"), { maxAge: "7d" }));

// 提供 storage 目錄的靜態存取（圖片）
app.use("/storage", express.static(STORAGE_ROOT, { maxAge: "7d" }));

app.get(["/chinese-magic", "/chinese-magic/"], (_req, res) => {
  res.sendFile(path.resolve("public", "chinese-magic.html"));
});

app.get(["/simpsons-magic", "/simpsons-magic/"], (_req, res) => {
  res.sendFile(path.resolve("public", "simpsons-magic.html"));
});

app.get(["/hunterxhunter", "/hunterxhunter/"], (_req, res) => {
  res.sendFile(path.resolve("public", "hunterxhunter.html"));
});

app.get(["/disney", "/disney/"], (_req, res) => {
  res.sendFile(path.resolve("public", "disney.html"));
});

app.get(["/painter", "/painter/"], (_req, res) => {
  res.sendFile(path.resolve("public", "painter.html"));
});

app.get(["/gallery", "/gallery/"], (_req, res) => {
  res.sendFile(path.resolve("public", "gallery.html"));
});

app.get(["/starship", "/starship/"], (_req, res) => {
  res.sendFile(path.resolve("public", "starship.html"));
});

function queuePosition(jobId) {
  const index = queue.indexOf(jobId);
  return index < 0 ? 0 : index;
}

function publicJob(job) {
  const common = { jobId: job.id, status: job.status, position: queuePosition(job.id), mode: job.mode, style: job.style, role: job.role, propId: job.propId, propName: job.propName, stage: job.stage, videoProgress: job.videoProgress };
  if (job.status === "completed") return { ...common, image: job.image, usage: job.usage, cost: job.cost, video: job.video, videoMetadata: job.videoMetadata, videoWarning: job.videoWarning, imageCost: job.imageCost, videoCost: job.videoCost };
  if (job.status === "failed")   return { ...common, error: job.error };
  return common;
}

async function runJob(job) {
  job.status = "processing";
  job.stage = "image";
  activeJobs += 1;
  try {
    if (!process.env.OPENAI_API_KEY) throw new Error("伺服器尚未設定 OPENAI_API_KEY");
    const image  = await toFile(job.photo, "photo.jpg", { type: job.mimeType });
    const result = await openai.images.edit({
      model:              IMAGE_MODEL,
      image,
      prompt:             getPhotoPrompt({ mode: job.mode, style: job.style, role: job.role }),
      quality:            process.env.IMAGE_QUALITY || DEFAULT_IMAGE_QUALITY,
      size:               "1024x1536",
      output_format:      "jpeg",
      output_compression: 85
    });
    const encoded = result.data?.[0]?.b64_json;
    if (!encoded) throw new Error("OpenAI 沒有回傳圖片");
    const usage = {
      inputTokens:       result.usage?.input_tokens        || 0,
      outputTokens:      result.usage?.output_tokens       || 0,
      totalTokens:       result.usage?.total_tokens        || 0,
      inputTokenDetails: result.usage?.input_tokens_details || null
    };
    job.image  = `data:image/jpeg;base64,${encoded}`;
    job.usage  = usage;
    job.cost   = estimateCost(result.usage, exchangeRate);
    job.photo  = null;

    if (videoConfig.enabled) {
      job.stage = "video";
      job.videoProgress = 0;
      job.imageCost = job.cost;
      job.videoCost = { model: videoConfig.model, usd: null, twd: null };
      try {
        // Keep the finished photo even if the optional video request fails.
        persistImage(job);
        const video = await generateVideo({
          image: Buffer.from(encoded, "base64"),
          mode: job.mode, style: job.style, role: job.role,
          config: videoConfig,
          apiKey: process.env.XAI_API_KEY,
          onProgress: ({ progress }) => {
            if (Number.isFinite(progress)) job.videoProgress = Math.max(0, Math.min(99, progress));
          }
        });
        persistVideo(job, video.buffer);
        job.videoMetadata = {
          requestId: video.requestId, model: video.model, duration: video.duration,
          resolution: video.resolution,
          generateAudio: video.generateAudio, usage: video.usage
        };
        if (Number.isFinite(video.costUsd) && video.costUsd >= 0) {
          job.videoCost = { model: video.model, usd: video.costUsd, twd: video.costUsd * exchangeRate };
        }
      } catch (error) {
        console.error(`[${job.id}] Video generation failed:`, error.message);
        job.videoWarning = "影片製作未完成，已保留照片，可先下載或分享照片。";
      }
      const knownTotal = Number.isFinite(job.imageCost.usd) && Number.isFinite(job.videoCost.usd);
      job.cost = {
        usd: knownTotal ? job.imageCost.usd + job.videoCost.usd : null,
        twd: knownTotal ? job.imageCost.twd + job.videoCost.twd : null,
        exchangeRate, estimated: true
      };
    }
    job.status = "completed";
    job.stage = "completed";
    job.completedAt = Date.now();

    // ★ 儲存結果到磁碟
    persistResult(job);

  } catch (error) {
    console.error(`[${job.id}]`, error?.request_id || "", error);
    job.status = "failed";
    job.completedAt = Date.now();
    job.error  = error?.message || "圖片生成失敗，請重新嘗試";
    job.photo  = null;
  } finally {
    activeJobs -= 1;
    processQueue();
  }
}

function processQueue() {
  while (activeJobs < maxConcurrent && queue.length) {
    const jobId = queue.shift();
    const job   = jobs.get(jobId);
    if (job?.status === "queued") void runJob(job);
  }
}

// ── API Routes ─────────────────────────────────────────────

app.get("/api/config", (_req, res) => {
  res.set("Cache-Control", "no-store");
  const { enabled, model, duration, resolution, generateAudio } = videoConfig;
  res.json({ ...getCameraConfig(photoMode), video: { enabled, model, duration, resolution, generateAudio } });
});

app.post("/api/generate", upload.single("photo"), (req, res) => {
  const { style, role, deviceId, requestId } = req.body || {};
  const name = normalizeParticipantName(req.body?.name);
  const prompt = getPhotoPrompt({ mode: photoMode, style, role });
  if (!req.file)                               return res.status(400).json({ error: "沒有收到照片" });
  if (!req.file.mimetype.startsWith("image/")) return res.status(400).json({ error: "只接受圖片檔案" });
  if (!prompt)                                 return res.status(400).json({ error: photoMode === "opera" ? "請選擇歌仔戲角色：生、旦、淨、丑；若模式已切換，請重新整理頁面" : "不支援這個風格或角色，請重新整理頁面後再選擇" });
  if (!name)                                   return res.status(400).json({ error: "請輸入姓名後再拍照" });
  if ([...name].length > maxParticipantNameLength)
    return res.status(400).json({ error: `姓名不可超過 ${maxParticipantNameLength} 個字` });
  if (!deviceId || !requestId)                 return res.status(400).json({ error: "缺少裝置或請求編號" });
  const existingId = requestIds.get(requestId);
  if (existingId) return res.status(202).json(publicJob(jobs.get(existingId)));
  if (videoConfig.enabled && !process.env.XAI_API_KEY?.trim())
    return res.status(503).json({ error: "影片功能已啟用，但伺服器尚未設定 XAI_API_KEY" });
  if (queue.length >= maxQueue) return res.status(503).json({ error: "目前等候人數已滿，請稍後再試" });

  const id  = crypto.randomUUID();
  const selectedRole = photoMode === "opera" ? OPERA_ROLES.find(option => option.id === role) : undefined;
  const job = { id, requestId, deviceId, name, style, role, mode: photoMode, propId: selectedRole?.propId, propName: selectedRole?.propName, status: "queued", photo: req.file.buffer, mimeType: req.file.mimetype, createdAt: Date.now() };
  jobs.set(id, job);
  requestIds.set(requestId, id);
  queue.push(id);
  processQueue();
  res.status(202).json(publicJob(job));
});

app.get("/api/jobs/:id", (req, res) => {
  res.set("Cache-Control", "no-store");
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "找不到這個生成工作，服務可能已重新啟動" });
  res.json(publicJob(job));
});


/**
 * GET /api/photos/:date
 * 直接掃描 storage/YYYY-MM-DD/ 資料夾，回傳所有圖片的公開 URL；
 * results.jsonl 僅用來補上姓名 metadata，不影響圖片候選的掃描。
 */
app.get("/api/photos/:date", (req, res) => {
  res.set("Cache-Control", "no-store");
  const date = req.params.date;
  // 基本格式驗證 YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "日期格式須為 YYYY-MM-DD" });
  }

  const dateDir = path.join(STORAGE_ROOT, date);
  let files = [];
  let storedFiles = new Set();
  try {
    storedFiles = new Set(fs.readdirSync(dateDir));
    files = [...storedFiles]
      .filter(f => /\.(jpe?g|png|webp|gif)$/i.test(f))
      .sort();
  } catch {
    // 資料夾不存在，回傳空陣列
  }

  // Azure terminates HTTPS before forwarding HTTP to this app. Keep media URLs
  // same-origin so the browser preserves HTTPS regardless of proxy headers.
  const storagePath = `/storage/${date}/`;
  const images = files.map(f => `${storagePath}${encodeURIComponent(f)}`);
  const namesByFile = readStoredNamesByFile();
  const photos = files.map((file, index) => {
    const videoFilename = `${path.parse(file).name}.mp4`;
    return {
      url: images[index],
      name: findStoredPhotoName(date, file, namesByFile),
      ...(videoConfig.enabled && storedFiles.has(videoFilename)
        ? { video: `${storagePath}${encodeURIComponent(videoFilename)}` }
        : {})
    };
  });

  res.json({ date, total: images.length, images, photos });
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, photoMode, videoEnabled: videoConfig.enabled, activeJobs, waitingJobs: queue.length, maxConcurrent });
});

app.use((error, _req, res, _next) => {
  // 用戶在上傳途中斷線，靜默忽略
  if (error.message === "Request aborted") return;
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE")
    return res.status(413).json({ error: "照片不可超過 5MB" });
  console.error(error);
  if (!res.headersSent) res.status(500).json({ error: "伺服器發生未預期錯誤" });
});

// 定期清理 in-memory job 快取（storage 不受影響）
setInterval(() => {
  const expiresBefore = Date.now() - 10 * 60 * 1000;
  for (const [id, job] of jobs) {
    if ((job.completedAt ?? job.createdAt) < expiresBefore && ["completed", "failed"].includes(job.status)) {
      jobs.delete(id);
      requestIds.delete(job.requestId);
    }
  }
}, 60_000).unref();

app.listen(port, () => console.log(`AI Camera listening on http://localhost:${port} (PHOTO_MODE=${photoMode})`));
