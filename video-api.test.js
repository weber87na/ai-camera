import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const imageKey = "local-openai-test-key";
const videoKey = "local-xai-test-key";
// Valid JPEG fixtures: blue 24 × 32 camera upload, red 24 × 36 (2:3) output.
// xAI must receive the generated portrait unchanged, with no resize or padding.
const sourceImage = Buffer.from("/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAgABgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAYH/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AgAGipgAAAAAB/9k=", "base64");
const generatedImage = Buffer.from("/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAkABgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAUH/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AiAEhsAAAAAAAAAAD/9k=", "base64");
// The integration stub only exercises transport/storage. No remote generation.
const mp4 = Buffer.from("000000186674797069736f6d0000020069736f6d6d703432", "hex");

async function availablePort() {
  const listener = net.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const { port } = listener.address();
  await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  return port;
}

async function startServer(t, env = {}, existingStorage) {
  const storage = existingStorage || await fs.mkdtemp(path.join(os.tmpdir(), "ai-camera-video-test-"));
  const port = await availablePort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: projectRoot,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PORT: String(port),
      STORAGE_DIR: storage,
      PHOTO_MODE: "opera",
      OPENAI_API_KEY: imageKey,
      OPENAI_BASE_URL: "http://127.0.0.1:1/v1",
      OPENAI_ORG_ID: "",
      OPENAI_PROJECT_ID: "",
      VIDEO_ENABLED: "false",
      VIDEO_MODEL: "grok-imagine-video-1.5-lite",
      VIDEO_DURATION: "3",
      VIDEO_RESOLUTION: "720p",
      VIDEO_GENERATE_AUDIO: "false",
      VIDEO_POLL_INTERVAL_MS: "250",
      VIDEO_TIMEOUT_MS: "10000",
      XAI_API_KEY: videoKey,
      XAI_BASE_URL: "http://127.0.0.1:1/v1",
      MAX_CONCURRENT: "1",
      MAX_QUEUE: "1",
      // Never load credentials or runtime settings from the developer's .env.
      DOTENV_CONFIG_PATH: path.join(storage, "absent-test-env"),
      DOTENV_CONFIG_OVERRIDE: "false",
      DOTENV_CONFIG_QUIET: "true",
      ...env
    }
  });
  let output = "";
  let spawnError;
  child.on("error", error => { spawnError = error; });
  child.stdout.on("data", chunk => { output = (output + chunk).slice(-10000); });
  child.stderr.on("data", chunk => { output = (output + chunk).slice(-10000); });
  const closed = new Promise(resolve => child.once("close", resolve));
  async function stop() {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await closed;
  }
  t.after(async () => {
    await stop();
    if (!existingStorage) {
      assert.equal(path.dirname(path.resolve(storage)), path.resolve(os.tmpdir()));
      assert.ok(path.basename(storage).startsWith("ai-camera-video-test-"));
      await fs.rm(storage, { recursive: true, force: true });
    }
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) throw new Error(`Isolated test server exited: ${output}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return { baseUrl, storage, stop };
    } catch (error) {
      if (["EACCES", "EPERM"].includes(error.cause?.code)) throw error;
    }
    await delay(30);
  }
  throw new Error(`Isolated test server did not start: ${output}`);
}

async function startStub(t, handler) {
  const requests = [];
  const stub = http.createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const entry = { method: req.method, url: req.url, headers: req.headers, body };
      requests.push(entry);
      await handler(entry, res, requests);
    } catch (error) {
      requests.push({ error });
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: error.message } }));
    }
  });
  stub.listen(0, "127.0.0.1");
  await once(stub, "listening");
  t.after(() => new Promise((resolve, reject) => {
    stub.close(error => error ? reject(error) : resolve());
    stub.closeAllConnections();
  }));
  return { url: `http://127.0.0.1:${stub.address().port}/v1`, requests };
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function startImageStub(t) {
  return startStub(t, async (request, res) => {
    assert.equal(request.url, "/v1/images/edits");
    assert.equal(request.headers.authorization, `Bearer ${imageKey}`);
    const form = await new Request("http://127.0.0.1/", {
      method: "POST", headers: request.headers, body: request.body
    }).formData();
    request.form = form;
    json(res, 200, { data: [{ b64_json: generatedImage.toString("base64") }] });
  });
}

async function submit(baseUrl, requestId = randomUUID()) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ name: "影片測試", deviceId: "video-test", requestId, style: "opera", role: "dan" })) {
    form.set(key, value);
  }
  form.set("photo", new Blob([sourceImage], { type: "image/jpeg" }), "source.jpg");
  const response = await fetch(`${baseUrl}/api/generate`, {
    method: "POST", body: form, signal: AbortSignal.timeout(5000)
  });
  return { status: response.status, body: await response.json() };
}

async function waitForJob(baseUrl, id, accept = job => ["completed", "failed"].includes(job.status)) {
  const deadline = Date.now() + 15000;
  let job;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/api/jobs/${id}`, { signal: AbortSignal.timeout(2000) });
    assert.equal(response.status, 200);
    job = await response.json();
    if (accept(job)) return job;
    await delay(20);
  }
  assert.fail(`Local test job did not reach the expected state: ${JSON.stringify(job)}`);
}

async function records(storage) {
  return (await fs.readFile(path.join(storage, "results.jsonl"), "utf8")).trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

async function photos(baseUrl, record) {
  const date = record.file.replaceAll("\\", "/").split("/")[0];
  const response = await fetch(`${baseUrl}/api/photos/${date}`);
  assert.equal(response.status, 200);
  const listing = await response.json();
  assert.ok(listing.images.every(url => url.startsWith("/storage/")));
  assert.ok(listing.photos.every(photo => photo.url.startsWith("/storage/") && (!photo.video || photo.video.startsWith("/storage/"))));
  return listing;
}

function assertStillImage(job) {
  assert.equal(job.status, "completed", job.error);
  assert.equal(job.image, `data:image/jpeg;base64,${generatedImage.toString("base64")}`);
  assert.equal(job.video, undefined);
}

test("disabled video keeps the original image workflow and never calls xAI", { timeout: 25000 }, async t => {
  const image = await startImageStub(t);
  const video = await startStub(t, (_request, res) => json(res, 500, { error: "Unexpected video request" }));
  const { baseUrl, storage } = await startServer(t, {
    OPENAI_BASE_URL: image.url, XAI_BASE_URL: video.url, XAI_API_KEY: ""
  });
  const config = await (await fetch(`${baseUrl}/api/config`)).json();
  assert.equal(config.video.enabled, false);
  assert.doesNotMatch(JSON.stringify(config), /local-openai-test-key|local-xai-test-key|XAI_API_KEY|OPENAI_API_KEY/);
  const submitted = await submit(baseUrl);
  assert.equal(submitted.status, 202);
  const job = await waitForJob(baseUrl, submitted.body.jobId);
  assertStillImage(job);
  assert.equal(job.videoWarning, undefined);
  assert.equal(image.requests.length, 1);
  assert.equal(video.requests.length, 0);
  const saved = await records(storage);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].videoFile, undefined);
  const gallery = await photos(baseUrl, saved[0]);
  assert.equal(gallery.total, 1);
  assert.equal(gallery.photos[0].video, undefined);
  assert.equal(gallery.images[0], gallery.photos[0].url);
});

test("enabled video without a key is rejected before spending on image generation", { timeout: 25000 }, async t => {
  const image = await startImageStub(t);
  const { baseUrl, storage } = await startServer(t, {
    VIDEO_ENABLED: "true", XAI_API_KEY: "", OPENAI_BASE_URL: image.url
  });
  const result = await submit(baseUrl);
  assert.equal(result.status, 503);
  assert.match(result.body.error, /XAI_API_KEY/);
  assert.equal(image.requests.length, 0);
  await assert.rejects(fs.stat(path.join(storage, "results.jsonl")), { code: "ENOENT" });
  const health = await (await fetch(`${baseUrl}/api/health`)).json();
  assert.equal(health.activeJobs, 0);
  assert.equal(health.waitingJobs, 0);
});

test("video uses the generated portrait, preserves queue bounds and deduplication, and survives restart", { timeout: 40000 }, async t => {
  const image = await startImageStub(t);
  let release = false;
  const video = await startStub(t, (request, res, requests) => {
    if (request.method === "POST" && request.url === "/v1/videos/generations") {
      request.json = JSON.parse(request.body.toString("utf8"));
      const id = requests.filter(entry => entry.method === "POST").length;
      json(res, 200, { request_id: `video-${id}` });
    } else if (request.url.startsWith("/v1/videos/video-")) {
      json(res, 200, release
        ? { status: "done", model: "grok-imagine-video-1.5-lite", video: { url: `${video.url}/output.mp4`, duration: 3, respect_moderation: true }, usage: { cost_in_usd_ticks: 250000000 } }
        : { status: "pending", progress: 37 });
    } else if (request.url === "/v1/output.mp4") {
      res.writeHead(200, { "content-type": "video/mp4" });
      res.end(mp4);
    } else {
      json(res, 404, { error: "Unexpected mock endpoint" });
    }
  });
  const env = { VIDEO_ENABLED: "true", OPENAI_BASE_URL: image.url, XAI_BASE_URL: video.url };
  const server = await startServer(t, env);
  const { baseUrl, storage } = server;
  const configResponse = await fetch(`${baseUrl}/api/config`);
  assert.match(configResponse.headers.get("cache-control") || "", /no-store/);
  const config = await configResponse.json();
  assert.deepEqual(config.video, {
    enabled: true, model: "grok-imagine-video-1.5-lite", duration: 3,
    resolution: "720p", generateAudio: false
  });
  assert.doesNotMatch(JSON.stringify(config), /local-openai-test-key|local-xai-test-key|XAI_API_KEY|OPENAI_API_KEY|127\.0\.0\.1|timeoutMs|pollIntervalMs/);

  const requestId = randomUUID();
  const submitted = await submit(baseUrl, requestId);
  assert.equal(submitted.status, 202);
  const processing = await waitForJob(baseUrl, submitted.body.jobId, job => job.stage === "video" && job.videoProgress === 37);
  assert.equal(processing.status, "processing");
  assert.equal(image.requests.length, 1);
  const pendingReplay = await submit(baseUrl, requestId);
  assert.equal(pendingReplay.status, 202);
  assert.equal(pendingReplay.body.jobId, submitted.body.jobId);

  const queued = await submit(baseUrl);
  assert.equal(queued.status, 202);
  assert.equal(queued.body.status, "queued");
  const overloaded = await submit(baseUrl);
  assert.equal(overloaded.status, 503);
  const health = await (await fetch(`${baseUrl}/api/health`)).json();
  assert.equal(health.activeJobs, 1);
  assert.equal(health.waitingJobs, 1);
  assert.equal(image.requests.length, 1, "video generation must keep its concurrency slot");
  assert.equal(video.requests.filter(entry => entry.method === "POST").length, 1);

  const upstream = video.requests.find(entry => entry.method === "POST");
  assert.equal(upstream.headers.authorization, `Bearer ${videoKey}`);
  assert.equal(upstream.json.model, "grok-imagine-video-1.5-lite");
  assert.equal(upstream.json.duration, 3);
  assert.equal(upstream.json.resolution, "720p");
  assert.equal(Object.hasOwn(upstream.json, "aspect_ratio"), false);
  assert.equal(upstream.json.generate_audio, false);
  assert.match(upstream.json.prompt, /《目連救母》/);
  assert.match(upstream.json.prompt, /U 形鐵鍊/);
  assert.match(upstream.json.prompt, /全片必須無聲/);
  assert.match(upstream.json.image.url, /^data:image\/jpeg;base64,/);
  const firstFrame = Buffer.from(upstream.json.image.url.split(",")[1], "base64");
  assert.deepEqual(firstFrame, generatedImage, "xAI must receive the original generated JPEG byte-for-byte");
  assert.notDeepEqual(firstFrame, sourceImage, "the raw camera upload must not replace the generated portrait");
  const jpegFrameHeader = firstFrame.indexOf(Buffer.from([0xff, 0xc0]));
  assert.ok(jpegFrameHeader >= 0);
  assert.equal(firstFrame.readUInt16BE(jpegFrameHeader + 5), 36);
  assert.equal(firstFrame.readUInt16BE(jpegFrameHeader + 7), 24);

  release = true;
  const job = await waitForJob(baseUrl, submitted.body.jobId);
  const secondJob = await waitForJob(baseUrl, queued.body.jobId);
  assert.equal(job.status, "completed", job.error);
  assert.equal(secondJob.status, "completed", secondJob.error);
  assert.equal(job.image, `data:image/jpeg;base64,${generatedImage.toString("base64")}`);
  assert.match(job.video, /^\/storage\/\d{4}-\d{2}-\d{2}\/[^/]+\.mp4$/);
  assert.equal(job.videoWarning, undefined);
  assert.equal(job.videoMetadata.requestId, "video-1");
  assert.equal(job.videoMetadata.duration, 3);
  assert.equal(job.videoMetadata.resolution, "720p");
  assert.equal(Object.hasOwn(job.videoMetadata, "aspectRatio"), false);
  assert.equal(job.videoMetadata.generateAudio, false);
  assert.equal(job.videoCost.usd, 0.025);
  const downloads = video.requests.filter(entry => entry.url === "/v1/output.mp4");
  assert.equal(downloads.length, 2);
  for (const download of downloads) assert.equal(download.headers.authorization, undefined);
  assert.equal(image.requests.length, 2);
  assert.equal(video.requests.filter(entry => entry.method === "POST").length, 2);
  assert.deepEqual(Buffer.from(await (await fetch(new URL(job.video, baseUrl))).arrayBuffer()), mp4);

  const saved = await records(storage);
  assert.equal(saved.length, 2);
  const record = saved.find(entry => entry.id === job.jobId);
  assert.ok(record);
  assert.equal(record.videoFile, record.file.replace(/\.jpg$/, ".mp4"));
  assert.deepEqual(await fs.readFile(path.join(storage, record.file)), generatedImage);
  assert.deepEqual(await fs.readFile(path.join(storage, record.videoFile)), mp4);
  assert.equal(record.videoMetadata.requestId, "video-1");
  assert.equal(Object.hasOwn(record.videoMetadata, "aspectRatio"), false);
  const gallery = await photos(baseUrl, record);
  assert.equal(gallery.total, 2);
  assert.equal(gallery.images.length, 2, "MP4s are not lottery image candidates");
  assert.ok(gallery.images.every(url => url.endsWith(".jpg")));
  assert.ok(gallery.photos.every(photo => gallery.images.includes(photo.url) && photo.video?.endsWith(".mp4")));
  const expectedImagePath = `/storage/${record.file.replaceAll("\\", "/").split("/").map(encodeURIComponent).join("/")}`;
  const galleryPhoto = gallery.photos.find(photo => photo.url === expectedImagePath);
  assert.ok(galleryPhoto, "the encoded Chinese filename must match the persisted photo");
  assert.equal(galleryPhoto.video, expectedImagePath.replace(/\.jpg$/, ".mp4"));
  const imageResponse = await fetch(new URL(galleryPhoto.url, baseUrl));
  assert.equal(imageResponse.status, 200);
  assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), generatedImage);
  const rangeResponse = await fetch(new URL(galleryPhoto.video, baseUrl), { headers: { Range: "bytes=0-11" } });
  assert.equal(rangeResponse.status, 206);
  assert.equal(rangeResponse.headers.get("content-range"), `bytes 0-11/${mp4.length}`);
  assert.match(rangeResponse.headers.get("content-type") || "", /^video\/mp4/);
  assert.deepEqual(Buffer.from(await rangeResponse.arrayBuffer()), mp4.subarray(0, 12));

  const completedReplay = await submit(baseUrl, requestId);
  assert.equal(completedReplay.body.jobId, job.jobId);
  assert.equal(completedReplay.body.video, job.video);
  assert.equal(video.requests.filter(entry => entry.method === "POST").length, 2);
  assert.equal((await records(storage)).length, 2);

  await server.stop();
  const restarted = await startServer(t, env, storage);
  const restored = await photos(restarted.baseUrl, record);
  assert.equal(restored.total, 2);
  assert.ok(restored.photos.every(photo => photo.video?.endsWith(".mp4")));
  assert.deepEqual(Buffer.from(await (await fetch(new URL(restored.photos[0].video, restarted.baseUrl))).arrayBuffer()), mp4);
  // Pairing is based on durable image/MP4 files, not in-memory job data or log rows.
  await fs.writeFile(path.join(storage, "results.jsonl"), "");
  const withoutLog = await photos(restarted.baseUrl, record);
  assert.ok(withoutLog.photos.every(photo => photo.video?.endsWith(".mp4")));
  await restarted.stop();

  const disabled = await startServer(t, { ...env, VIDEO_ENABLED: "false" }, storage);
  const stillOnly = await photos(disabled.baseUrl, record);
  assert.equal(stillOnly.total, 2);
  assert.ok(stillOnly.photos.every(photo => !Object.hasOwn(photo, "video")));
  await disabled.stop();
});

for (const failure of ["submission", "generation", "moderation", "download"]) {
  test(`video ${failure} failure keeps exactly one photo and returns a safe fallback`, { timeout: 25000 }, async t => {
    const image = await startImageStub(t);
    const video = await startStub(t, (request, res) => {
      if (request.method === "POST") {
        if (failure === "submission") return json(res, 503, { error: { message: `${videoKey}: private-provider-details` } });
        return json(res, 200, { request_id: "failed-video" });
      }
      if (request.url === "/v1/output.mp4") {
        res.writeHead(200, { "content-type": "text/html" });
        return res.end("This is not an MP4");
      }
      if (failure === "generation") return json(res, 200, { status: "failed", error: { code: "internal_error", message: `${videoKey}: private-provider-details` } });
      return json(res, 200, { status: "done", video: { url: `${video.url}/output.mp4`, duration: 3, respect_moderation: failure !== "moderation" } });
    });
    const { baseUrl, storage } = await startServer(t, { VIDEO_ENABLED: "true", OPENAI_BASE_URL: image.url, XAI_BASE_URL: video.url });
    const requestId = randomUUID();
    const submitted = await submit(baseUrl, requestId);
    assert.equal(submitted.status, 202);
    const job = await waitForJob(baseUrl, submitted.body.jobId);
    assertStillImage(job);
    assert.equal(typeof job.videoWarning, "string");
    assert.ok(job.videoWarning.length > 0);
    assert.doesNotMatch(JSON.stringify(job), /local-xai-test-key|private-provider-details/);
    const saved = await records(storage);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].videoFile, undefined);
    const dateDirectory = path.dirname(path.join(storage, saved[0].file));
    assert.deepEqual((await fs.readdir(dateDirectory)).filter(file => file.endsWith(".mp4")), []);
    const gallery = await photos(baseUrl, saved[0]);
    assert.equal(gallery.total, 1);
    assert.equal(gallery.photos[0].video, undefined);
    if (failure === "moderation") assert.equal(video.requests.some(entry => entry.url === "/v1/output.mp4"), false);
    const replay = await submit(baseUrl, requestId);
    assert.equal(replay.body.jobId, job.jobId);
    assertStillImage(replay.body);
    assert.equal(image.requests.length, 1);
    assert.equal(video.requests.filter(entry => entry.method === "POST").length, 1, "failed video POST must not be resubmitted");
    assert.equal((await records(storage)).length, 1);
  });
}
