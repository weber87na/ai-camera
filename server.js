import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import multer from "multer";
import OpenAI, { toFile } from "openai";
import { getStylePrompt } from "./styles.js";

const app = express();
const port = Number(process.env.PORT) || 3000;
const maxConcurrent = Number(process.env.MAX_CONCURRENT) || 3;
const maxQueue = Number(process.env.MAX_QUEUE) || 30;
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

/**
 * 將完成的 job 存到 storage/YYYY-MM-DD/<timestamp>-<jobId8>.jpg
 * 並 append 一行 metadata 到 results.jsonl
 */
function persistResult(job) {
  try {
    // 建立日期子目錄
    const dateStr  = taipeiDateString(job.createdAt); // YYYY-MM-DD (Asia/Taipei)
    const dateDir  = path.join(STORAGE_ROOT, dateStr);
    fs.mkdirSync(dateDir, { recursive: true });

    // 寫入 JPEG 檔案
    const filename = `${job.createdAt}-${job.id.slice(0, 8)}.jpg`;
    const filepath = path.join(dateDir, filename);
    const base64   = job.image.replace(/^data:image\/\w+;base64,/, "");
    fs.writeFileSync(filepath, Buffer.from(base64, "base64"));

    // Append metadata
    const record = {
      id:        job.id,
      style:     job.style,
      deviceId:  job.deviceId,
      createdAt: job.createdAt,
      savedAt:   Date.now(),
      file:      `${dateStr}/${filename}`,
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
app.use(express.static("public", { maxAge: 0, etag: true }));

// Three.js browser build for WebGL experiences such as painter.
app.use("/vendor/three", express.static(path.join(process.cwd(), "node_modules", "three", "build"), { maxAge: "7d" }));
app.use("/vendor/three-addons", express.static(path.join(process.cwd(), "node_modules", "three", "examples", "jsm"), { maxAge: "7d" }));

// 提供 storage 目錄的靜態存取（圖片）
app.use("/storage", express.static(STORAGE_ROOT, { maxAge: "7d" }));

// lottery 膠捲使用的範例圖片
app.use("/example-images", express.static(path.join(process.cwd(), "example-images"), { maxAge: "7d" }));

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

app.get(["/lottery", "/lottery/"], (_req, res) => {
  res.sendFile(path.resolve("public", "lottery.html"));
});

function queuePosition(jobId) {
  const index = queue.indexOf(jobId);
  return index < 0 ? 0 : index;
}

function publicJob(job) {
  const common = { jobId: job.id, status: job.status, position: queuePosition(job.id) };
  if (job.status === "completed") return { ...common, image: job.image, usage: job.usage, cost: job.cost };
  if (job.status === "failed")   return { ...common, error: job.error };
  return common;
}

function estimateCost(usage) {
  const details = usage?.input_tokens_details || {};
  const textRate        = Number(process.env.TEXT_INPUT_USD_PER_MILLION)  || 5;
  const imageInputRate  = Number(process.env.IMAGE_INPUT_USD_PER_MILLION) || 8;
  const imageOutputRate = Number(process.env.IMAGE_OUTPUT_USD_PER_MILLION)|| 30;
  const usd = (
    (details.text_tokens  || 0) * textRate +
    (details.image_tokens || 0) * imageInputRate +
    (usage?.output_tokens || 0) * imageOutputRate
  ) / 1_000_000;
  return { usd, twd: usd * exchangeRate, exchangeRate, estimated: true };
}

async function runJob(job) {
  job.status = "processing";
  activeJobs += 1;
  try {
    if (!process.env.OPENAI_API_KEY) throw new Error("伺服器尚未設定 OPENAI_API_KEY");
    const image  = await toFile(job.photo, "photo.jpg", { type: job.mimeType });
    const result = await openai.images.edit({
      model:              "gpt-image-2",
      image,
      prompt:             getStylePrompt(job.style),
      quality:            process.env.IMAGE_QUALITY || "low",
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
    job.cost   = estimateCost(result.usage);
    job.status = "completed";
    job.photo  = null;

    // ★ 儲存結果到磁碟
    persistResult(job);

  } catch (error) {
    console.error(`[${job.id}]`, error?.request_id || "", error);
    job.status = "failed";
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

app.post("/api/generate", upload.single("photo"), (req, res) => {
  const { style, deviceId, requestId } = req.body || {};
  const prompt = getStylePrompt(style);
  if (!req.file)                               return res.status(400).json({ error: "沒有收到照片" });
  if (!req.file.mimetype.startsWith("image/")) return res.status(400).json({ error: "只接受圖片檔案" });
  if (!prompt)                                 return res.status(400).json({ error: "不支援這個風格" });
  if (!deviceId || !requestId)                 return res.status(400).json({ error: "缺少裝置或請求編號" });
  const existingId = requestIds.get(requestId);
  if (existingId) return res.status(202).json(publicJob(jobs.get(existingId)));
  if (queue.length >= maxQueue) return res.status(503).json({ error: "目前等候人數已滿，請稍後再試" });

  const id  = crypto.randomUUID();
  const job = { id, requestId, deviceId, style, status: "queued", photo: req.file.buffer, mimeType: req.file.mimetype, createdAt: Date.now() };
  jobs.set(id, job);
  requestIds.set(requestId, id);
  queue.push(id);
  processQueue();
  res.status(202).json(publicJob(job));
});

app.get("/api/jobs/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "找不到這個生成工作，服務可能已重新啟動" });
  res.json(publicJob(job));
});


/**
 * GET /api/photos/:date
 * 直接掃描 storage/YYYY-MM-DD/ 資料夾，回傳所有圖片的公開 URL
 * 不依賴 results.jsonl，方便測試
 */
app.get("/api/photos/:date", (req, res) => {
  const date = req.params.date;
  // 基本格式驗證 YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "日期格式須為 YYYY-MM-DD" });
  }

  const dateDir = path.join(STORAGE_ROOT, date);
  let files = [];
  try {
    files = fs.readdirSync(dateDir)
      .filter(f => /\.(jpe?g|png|webp|gif)$/i.test(f))
      .sort();
  } catch {
    // 資料夾不存在，回傳空陣列
  }

  const baseUrl = `${req.protocol}://${req.get("host")}`;
  const images = files.map(f => `${baseUrl}/storage/${date}/${f}`);

  res.json({ date, total: images.length, images });
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, activeJobs, waitingJobs: queue.length, maxConcurrent });
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
    if (job.createdAt < expiresBefore && ["completed", "failed"].includes(job.status)) {
      jobs.delete(id);
      requestIds.delete(job.requestId);
    }
  }
}, 60_000).unref();

app.listen(port, () => console.log(`AI Camera listening on http://localhost:${port}`));
