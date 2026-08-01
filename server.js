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

/**
 * 將完成的 job 存到 storage/YYYY-MM-DD/<timestamp>-<jobId8>.jpg
 * 並 append 一行 metadata 到 results.jsonl
 */
function persistResult(job) {
  try {
    // 建立日期子目錄
    const dateStr  = new Date(job.createdAt).toISOString().slice(0, 10); // YYYY-MM-DD
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

/**
 * 讀取 results.jsonl，回傳陣列（最新在前）
 */
function loadResults() {
  try {
    return fs.readFileSync(RESULTS_LOG, "utf8")
      .split("\n")
      .filter(Boolean)
      .map(line => JSON.parse(line))
      .reverse();
  } catch {
    return [];
  }
}

// ── In-memory state ────────────────────────────────────────
const jobs      = new Map();
const requestIds = new Map();
const queue     = [];
let activeJobs  = 0;

app.disable("x-powered-by");
app.use(express.static("public", { maxAge: 0, etag: true }));

// 提供 storage 目錄的靜態存取（圖片）
app.use("/storage", express.static(STORAGE_ROOT, { maxAge: "7d" }));

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
      quality:            "medium",
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
 * GET /api/results?page=1&limit=20&style=simpsons&date=2025-07-31
 * 列出所有已儲存的生成記錄（最新在前）
 */
app.get("/api/results", (req, res) => {
  const page   = Math.max(1, Number(req.query.page)  || 1);
  const limit  = Math.min(100, Number(req.query.limit) || 20);
  const style  = req.query.style  || null;
  const date   = req.query.date   || null;   // YYYY-MM-DD

  let results = loadResults();

  // 篩選
  if (style) results = results.filter(r => r.style === style);
  if (date)  results = results.filter(r => r.file.startsWith(date));

  const total   = results.length;
  const pages   = Math.ceil(total / limit);
  const records = results.slice((page - 1) * limit, page * limit);

  // 附上圖片的公開 URL
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  const data = records.map(r => ({
    ...r,
    imageUrl: `${baseUrl}/storage/${r.file}`
  }));

  res.json({ total, page, pages, limit, data });
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
