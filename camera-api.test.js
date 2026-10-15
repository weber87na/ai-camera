import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import net from "node:net";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jwZkAAAAASUVORK5CYII=", "base64");
const expectedRoles = ["sheng", "dan", "jing", "chou", "beauty-fan", "beauty-necklace", "beauty-umbrella", "beauty-dessert", "handsome-sheng"];
const expectedProps = {
  sheng: { propId: "paper-fan", propName: "紙扇" },
  dan: { propId: "iron-chain", propName: "鐵鍊" },
  jing: { propId: "paper-umbrella", propName: "紙傘" },
  chou: { propId: "dessert-grid", propName: "甜點九宮格" },
  "beauty-fan": { propId: "paper-fan", propName: "紙扇" },
  "beauty-necklace": { propId: "luxury-necklace", propName: "銀飾項鍊" },
  "beauty-umbrella": { propId: "paper-umbrella", propName: "紙傘" },
  "beauty-dessert": { propId: "dessert-grid", propName: "甜點九宮格" },
  "handsome-sheng": { propId: "paper-fan", propName: "紙扇" }
};
const jpegBase64 = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwC/AB//2Q==";
const operaPagePaths = [
  "/opera", "/opera/", "/opera.html", "/OPERA", "/OPERA.HTML",
  "/%6Fpera", "/opera%2F", "/opera%2Ehtml", "/%6fpera%2ehtml",
  "//opera.html", "/%5Copera.html", "/nested%2F..%2Fopera.html",
  "/opera.html.", "/opera.html%20", "/opera.html?from=lottery",
  "/opera.html::$DATA", "/opera.html%3A%3A%24DATA", "/OPERA.HTML%3a%3a%24data"
];

async function availablePort() {
  const listener = net.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const { port } = listener.address();
  await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  return port;
}

async function startServer(t, mode, openaiUrl, { videoEnabled = false } = {}) {
  if (openaiUrl) {
    const url = new URL(openaiUrl);
    assert.equal(url.protocol, "http:");
    assert.equal(url.hostname, "127.0.0.1");
  }
  const storage = await fs.mkdtemp(path.join(os.tmpdir(), "ai-camera-api-test-"));
  const port = await availablePort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: projectRoot,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PORT: String(port),
      STORAGE_DIR: storage,
      PHOTO_MODE: mode,
      VIDEO_ENABLED: String(videoEnabled),
      VIDEO_MODEL: "grok-imagine-video-1.5-lite",
      VIDEO_DURATION: "3",
      VIDEO_RESOLUTION: "720p",
      VIDEO_GENERATE_AUDIO: "false",
      VIDEO_TIMEOUT_MS: "600000",
      VIDEO_POLL_INTERVAL_MS: "5000",
      XAI_BASE_URL: "https://api.x.ai/v1",
      XAI_API_KEY: "",
      OPENAI_API_KEY: openaiUrl ? "local-test-key" : "",
      OPENAI_BASE_URL: openaiUrl || "http://127.0.0.1:1/v1",
      OPENAI_ORG_ID: "",
      OPENAI_PROJECT_ID: "",
      // Do not load real credentials or deployment settings from the local .env.
      DOTENV_CONFIG_PATH: path.join(storage, "no-test-env-file"),
      DOTENV_CONFIG_OVERRIDE: "false",
      DOTENV_CONFIG_QUIET: "true",
      PRIVATE_TEST_SETTING: "must-not-appear-in-public-config",
      MAX_CONCURRENT: "1",
      MAX_QUEUE: "30"
    }
  });
  let output = "";
  let spawnError;
  child.on("error", error => { spawnError = error; });
  child.stdout.on("data", chunk => { output = (output + chunk).slice(-8000); });
  child.stderr.on("data", chunk => { output = (output + chunk).slice(-8000); });
  const closed = new Promise(resolve => child.once("close", resolve));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await closed;
    // Only remove the unique directory created by this test, inside the OS temp root.
    assert.equal(path.dirname(path.resolve(storage)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(storage).startsWith("ai-camera-api-test-"));
    await fs.rm(storage, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) throw new Error(`Test server exited: ${output}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return { baseUrl, storage };
    } catch (error) {
      if (["EACCES", "EPERM"].includes(error.cause?.code)) throw error;
      // Wait until the isolated server starts listening.
    }
    await delay(50);
  }
  throw new Error(`Test server did not become ready: ${output}`);
}

async function submit(baseUrl, fields) {
  const form = new FormData();
  form.set("name", "測試參與者");
  form.set("deviceId", "integration-test-device");
  for (const [key, value] of fields) form.append(key, value);
  if (!form.has("requestId")) form.set("requestId", randomUUID());
  form.set("photo", new Blob([png], { type: "image/png" }), "test.png");
  const response = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(5000)
  });
  return { status: response.status, body: await response.json() };
}

async function startOpenAIStub(t) {
  const requests = [];
  const stub = http.createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const request = new Request("http://127.0.0.1/", {
        method: req.method,
        headers: req.headers,
        body: Buffer.concat(chunks)
      });
      const form = await request.formData();
      requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization, form });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        data: [{ b64_json: jpegBase64 }],
        usage: {
          input_tokens: 20,
          input_tokens_details: { text_tokens: 10, image_tokens: 10 },
          output_tokens: 10,
          total_tokens: 30
        }
      }));
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

async function waitForJob(baseUrl, jobId) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/api/jobs/${jobId}`, { signal: AbortSignal.timeout(1000) });
    assert.equal(response.status, 200);
    const job = await response.json();
    if (["completed", "failed"].includes(job.status)) return job;
    await delay(20);
  }
  assert.fail("The job did not finish against the local OpenAI stub");
}

async function getPublicConfig(baseUrl, expectedMode) {
  const response = await fetch(`${baseUrl}/api/config`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") || "", /no-store/i);
  const config = await response.json();
  assert.equal(config.mode, expectedMode);
  assert.deepEqual(Object.keys(config).sort(), ["mode", "roles", "video"]);
  assert.deepEqual(config.video, {
    enabled: false, model: "grok-imagine-video-1.5-lite", duration: 3,
    resolution: "720p", generateAudio: false
  });
  assert.ok(Array.isArray(config.roles));
  for (const role of config.roles) {
    assert.deepEqual(Object.keys(role).sort(), ["description", "id", "name", "propId", "propName", "title"]);
    for (const value of Object.values(role)) assert.equal(typeof value, "string");
    assert.equal(role.propId, expectedProps[role.id].propId);
    assert.equal(role.propName, expectedProps[role.id].propName);
  }
  assert.doesNotMatch(JSON.stringify(config), /OPENAI_API_KEY|must-not-appear-in-public-config|"prompt"/i);
  return config;
}

async function assertAcceptedWithoutApiCall(baseUrl, fields, mode, style, role) {
  const result = await submit(baseUrl, fields);
  assert.equal(result.status, 202, JSON.stringify(result.body));
  assert.equal(result.body.mode, mode);
  assert.equal(result.body.style, style);
  assert.equal(result.body.role, role);
  assert.equal(result.body.propId, expectedProps[role]?.propId);
  assert.equal(result.body.propName, expectedProps[role]?.propName);
  assert.equal(typeof result.body.jobId, "string");
  const response = await fetch(`${baseUrl}/api/jobs/${result.body.jobId}`);
  assert.equal(response.status, 200);
  const job = await response.json();
  assert.equal(job.mode, mode);
  assert.equal(job.style, style);
  assert.equal(job.role, role);
  assert.equal(job.propId, expectedProps[role]?.propId);
  assert.equal(job.propName, expectedProps[role]?.propName);
  assert.equal(job.status, "failed");
  assert.match(job.error, /OPENAI_API_KEY/);
}

test("blank PHOTO_MODE preserves standard styles and rejects opera role fields", { timeout: 20000 }, async t => {
  const { baseUrl } = await startServer(t, "");
  const config = await getPublicConfig(baseUrl, "standard");
  assert.deepEqual(config.roles, []);

  await assertAcceptedWithoutApiCall(baseUrl, [["style", "simpsons"]], "standard", "simpsons", undefined);
  await assertAcceptedWithoutApiCall(baseUrl, [["style", "opera"]], "standard", "opera", undefined);

  for (const role of ["dan", "beauty-necklace", "handsome-sheng", "", "unknown"]) {
    const result = await submit(baseUrl, [["style", "opera"], ["role", role]]);
    assert.equal(result.status, 400, `standard mode accepted role ${JSON.stringify(role)}`);
    assert.equal(typeof result.body.error, "string");
  }
  const invalidStyle = await submit(baseUrl, [["style", "unknown-style"]]);
  assert.equal(invalidStyle.status, 400);
});

test("opera mode exposes nine roles and accepts only matching style and scalar role IDs", { timeout: 20000 }, async t => {
  const { baseUrl } = await startServer(t, "opera");
  const config = await getPublicConfig(baseUrl, "opera");
  assert.deepEqual(config.roles.map(role => role.id), expectedRoles);
  assert.deepEqual(config.roles.map(role => role.name), ["小生", "苦旦", "花臉", "文丑", "小旦", "小旦", "小旦", "花旦", "小生"]);
  assert.deepEqual(config.roles.map(role => role.title), config.roles.map(role => role.name));

  for (const role of expectedRoles) {
    await assertAcceptedWithoutApiCall(baseUrl, [["style", "opera"], ["role", role]], "opera", "opera", role);
  }

  const invalidRequests = [
    [["style", "opera"]],
    [["style", "opera"], ["role", ""]],
    [["style", "opera"], ["role", "unknown"]],
    [["style", "opera"], ["role", "beauty-unknown"]],
    [["style", "opera"], ["role", "beauty-fan "]],
    [["style", "opera"], ["role", "handsome-sheng "]],
    [["style", "opera"], ["role", "handsome-unknown"]],
    [["style", "opera"], ["role", "Handsome-Sheng"]],
    [["style", "opera"], ["role", "constructor"]],
    [["style", "opera"], ["role", "toString"]],
    [["style", "simpsons"], ["role", "dan"]],
    [["role", "dan"]],
    [["style", "opera"], ["role", "dan"], ["role", "sheng"]],
    [["style", "opera"], ["role[]", "dan"]],
    [["style", "opera"], ["role[id]", "dan"]]
  ];
  for (const fields of invalidRequests) {
    const result = await submit(baseUrl, fields);
    assert.equal(result.status, 400, `accepted malformed selection ${JSON.stringify(fields)}`);
    assert.equal(typeof result.body.error, "string");
  }
});

test("Chinese PHOTO_MODE alias enables the same opera role contract", { timeout: 20000 }, async t => {
  const { baseUrl } = await startServer(t, "歌仔戲");
  const config = await getPublicConfig(baseUrl, "opera");
  assert.deepEqual(config.roles.map(role => role.id), expectedRoles);
  await assertAcceptedWithoutApiCall(baseUrl, [["style", "opera"], ["role", "dan"]], "opera", "opera", "dan");
});

test("opera lottery page is inaccessible in standard and default modes, including static-file aliases", { timeout: 20000 }, async t => {
  for (const mode of ["standard", ""]) {
    const { baseUrl } = await startServer(t, mode);
    for (const pathname of operaPagePaths) {
      const response = await fetch(`${baseUrl}${pathname}`, { redirect: "manual" });
      assert.equal(response.status, 404, `${JSON.stringify(mode)} exposed ${pathname}`);
      assert.match(response.headers.get("cache-control") || "", /no-store/i);
      assert.doesNotMatch(await response.text(), /<html/i);
    }
    for (const pathname of ["/%6fpera.html", "/opera.html::$DATA", "/opera.html%3A%3A%24DATA"]) {
      const head = await fetch(`${baseUrl}${pathname}`, { method: "HEAD" });
      assert.equal(head.status, 404, `${JSON.stringify(mode)} exposed HEAD ${pathname}`);
    }
    assert.equal((await fetch(`${baseUrl}/`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/gallery`)).status, 200);
  }
});

test("opera lottery page is served only in opera mode and its Chinese alias", { timeout: 20000 }, async t => {
  const expectedPage = await fs.readFile(path.join(projectRoot, "public", "opera.html"), "utf8");
  for (const mode of ["opera", "歌仔戲"]) {
    const { baseUrl } = await startServer(t, mode);
    for (const pathname of operaPagePaths) {
      const response = await fetch(`${baseUrl}${pathname}`, { redirect: "manual" });
      assert.equal(response.status, 200, `${mode} did not serve ${pathname}`);
      assert.match(response.headers.get("content-type") || "", /text\/html/i);
      assert.match(response.headers.get("cache-control") || "", /no-store/i);
      assert.equal(await response.text(), expectedPage);
    }
    for (const pathname of ["/%6fpera.html", "/opera.html::$DATA", "/opera.html%3A%3A%24DATA"]) {
      const head = await fetch(`${baseUrl}${pathname}`, { method: "HEAD" });
      assert.equal(head.status, 200, `${mode} did not serve HEAD ${pathname}`);
      assert.equal(await head.text(), "");
    }
  }
});

test("opera photo API preserves names and exposes only completed paired videos when enabled", { timeout: 20000 }, async t => {
  const date = "2026-10-14";
  const completePhoto = "1791907200000-1234abcd-完成 參與者.jpg";
  const pendingPhoto = "1791907200001-5678abcd-等待參與者.jpg";
  for (const videoEnabled of [false, true]) {
    const { baseUrl, storage } = await startServer(t, "opera", undefined, { videoEnabled });
    const dateDir = path.join(storage, date);
    await fs.mkdir(dateDir);
    await Promise.all([
      fs.writeFile(path.join(dateDir, completePhoto), png),
      fs.writeFile(path.join(dateDir, pendingPhoto), png),
      fs.writeFile(path.join(dateDir, completePhoto.replace(/\.jpg$/, ".mp4")), "finished-video-fixture"),
      fs.writeFile(path.join(dateDir, pendingPhoto.replace(/\.jpg$/, ".mp4.tmp")), "unfinished-video-fixture"),
      fs.writeFile(path.join(dateDir, "orphan.mp4"), "video-without-photo"),
      fs.writeFile(path.join(storage, "results.jsonl"), JSON.stringify({ file: `${date}/${completePhoto}`, name: "中獎人 全名" }) + "\n")
    ]);

    const config = await (await fetch(`${baseUrl}/api/config`)).json();
    assert.equal(config.mode, "opera");
    assert.equal(config.video.enabled, videoEnabled);
    const response = await fetch(`${baseUrl}/api/photos/${date}`);
    assert.equal(response.status, 200);
    const listing = await response.json();
    assert.equal(listing.total, 2);
    assert.equal(listing.photos.length, 2);
    assert.equal(listing.photos[0].name, "中獎人 全名");
    assert.equal(listing.photos[1].name, "等待參與者");
    assert.deepEqual(listing.photos.map(photo => photo.url), listing.images);
    assert.deepEqual(listing.images, [completePhoto, pendingPhoto].map(file => `/storage/${date}/${encodeURIComponent(file)}`));
    assert.equal(Object.hasOwn(listing.photos[1], "video"), false);
    if (videoEnabled) {
      assert.equal(listing.photos[0].video, `/storage/${date}/${encodeURIComponent(completePhoto.replace(/\.jpg$/, ".mp4"))}`);
    } else {
      assert.ok(listing.photos.every(photo => !Object.hasOwn(photo, "video")));
    }

    // Azure terminates HTTPS before forwarding HTTP to Node. Media URLs must
    // use the browser's origin, independent of internal or forwarded hosts.
    const forwardedResponse = await fetch(`${baseUrl}/api/photos/${date}`, {
      headers: {
        Host: "internal-app:8080",
        "X-Forwarded-Proto": "https",
        "X-Forwarded-Host": "camera.example.com"
      }
    });
    assert.equal(forwardedResponse.status, 200);
    assert.deepEqual(await forwardedResponse.json(), listing);
    const page = new URL("https://camera.example.com/opera");
    for (const mediaPath of [...listing.images, ...listing.photos.flatMap(photo => photo.video ? [photo.video] : [])]) {
      assert.match(mediaPath, /^\/storage\//);
      const resolved = new URL(mediaPath, page);
      assert.equal(resolved.protocol, "https:");
      assert.equal(resolved.origin, page.origin);
    }
    const storedImage = await fetch(new URL(listing.photos[0].url, baseUrl));
    assert.equal(storedImage.status, 200);
    assert.deepEqual(Buffer.from(await storedImage.arrayBuffer()), png);
    if (videoEnabled) {
      const storedVideo = await fetch(new URL(listing.photos[0].video, baseUrl));
      assert.equal(storedVideo.status, 200);
      assert.equal(await storedVideo.text(), "finished-video-fixture");
    }
  }
});

test("each role sends its fixed prop prompt and persists server-selected props without duplicate generation", { timeout: 20000 }, async t => {
  const stub = await startOpenAIStub(t);
  const { baseUrl, storage } = await startServer(t, "opera", stub.url);
  const promptRequirements = {
    sheng: [/必須手持明顯展開的象牙白紙折扇/, /完整扇面、扇骨與握扇的手/],
    dan: [/《目連救母》中的母親/, /鐵鍊[^\n]*不可省略/, /U 形/],
    jing: [/展開的傳統油紙傘/, /放射狀竹製傘骨/, /傘面不得遮擋臉部/],
    chou: [/3 × 3 = 9 個獨立方形格子/, /每格各放一件傳統甜點/, /朝鏡頭傾斜/],
    "beauty-fan": [/指定角色：小旦/, /象牙白搭藕粉的傳統女褶子/, /花鳥紙折扇已展開於胸前下方/, /完整扇面、竹製扇骨與持扇的手/],
    "beauty-necklace": [/指定角色：小旦/, /深孔雀藍搭香檳金的傳統旦角女帔/, /正常日常尺寸的純銀細鏈/, /鏈身粗細為 1 至 2 毫米、整條長度為 40 至 45 公分/, /一枚長度不超過 1 公分的簡單小水滴形銀墜/, /自然佩戴於頸胸間/, /位於閉合衣襟外側/, /不加入品牌文字/],
    "beauty-umbrella": [/指定角色：小旦/, /月白搭淺青的傳統女褶子/, /淡色花卉油紙傘置於肩後/, /放射狀竹製傘骨/],
    "beauty-dessert": [/指定角色：花旦/, /以正紅色為主色的傳統女褶子/, /恰好 3 × 3 = 9 格/, /每格一份甜點/, /腰胸之間.*朝鏡頭傾斜/],
    "handsome-sheng": [/指定角色：小生/, /象牙白不透明緞面傳統男褶子/, /黑色傳統文生巾帽/, /水墨竹紋/, /一把已完全展開的象牙白紙折扇/, /頭部至上臀部構圖/]
  };

  for (const [index, role] of expectedRoles.entries()) {
    const prop = expectedProps[role];
    const fields = [
      ["style", "opera"], ["role", role], ["requestId", randomUUID()],
      // Untrusted client fields cannot override the server's role-to-prop mapping.
      ["propId", "malicious-prop-override"], ["propName", "不屬於此角色的道具"]
    ];
    const submitted = await submit(baseUrl, fields);
    assert.equal(submitted.status, 202, JSON.stringify(submitted.body));
    assert.equal(submitted.body.propId, prop.propId);
    assert.equal(submitted.body.propName, prop.propName);
    const job = await waitForJob(baseUrl, submitted.body.jobId);
    assert.equal(job.status, "completed", job.error);
    assert.equal(job.mode, "opera");
    assert.equal(job.style, "opera");
    assert.equal(job.role, role);
    assert.equal(job.propId, prop.propId);
    assert.equal(job.propName, prop.propName);
    assert.equal(job.image, `data:image/jpeg;base64,${jpegBase64}`);

    assert.equal(stub.requests.length, index + 1);
    const upstream = stub.requests[index];
    assert.ifError(upstream.error);
    assert.equal(upstream.method, "POST");
    assert.equal(upstream.url, "/v1/images/edits");
    assert.equal(upstream.authorization, "Bearer local-test-key");
    const prompt = upstream.form.get("prompt");
    assert.equal(typeof prompt, "string");
    assert.ok(prompt.includes(`固定道具：${prop.propName}（${prop.propId}），不可省略或替換`));
    for (const requirement of promptRequirements[role]) assert.match(prompt, requirement);
    assert.doesNotMatch(prompt, /malicious-prop-override|不屬於此角色的道具/);
    assert.equal(upstream.form.get("output_format"), "jpeg");
    assert.equal(upstream.form.get("size"), "1024x1536");

    const records = (await fs.readFile(path.join(storage, "results.jsonl"), "utf8")).trim().split(/\r?\n/).map(line => JSON.parse(line));
    assert.equal(records.length, index + 1);
    const record = records[index];
    assert.equal(record.id, job.jobId);
    assert.equal(record.mode, "opera");
    assert.equal(record.style, "opera");
    assert.equal(record.role, role);
    assert.equal(record.propId, prop.propId);
    assert.equal(record.propName, prop.propName);
    const savedImagePath = path.resolve(storage, record.file);
    assert.ok(savedImagePath.startsWith(path.resolve(storage) + path.sep));
    assert.deepEqual(await fs.readFile(savedImagePath), Buffer.from(jpegBase64, "base64"));

    const replay = await submit(baseUrl, fields);
    assert.equal(replay.status, 202);
    assert.equal(replay.body.jobId, job.jobId);
    assert.equal(replay.body.status, "completed");
    assert.equal(replay.body.role, role);
    assert.equal(replay.body.propId, prop.propId);
    assert.equal(stub.requests.length, index + 1);
  }
});

test("standard generation ignores client prop fields and omits opera prop metadata", { timeout: 20000 }, async t => {
  const stub = await startOpenAIStub(t);
  const { baseUrl, storage } = await startServer(t, "standard", stub.url);
  const submitted = await submit(baseUrl, [["style", "simpsons"], ["propId", "iron-chain"], ["propName", "鐵鍊"]]);
  assert.equal(submitted.status, 202);
  const job = await waitForJob(baseUrl, submitted.body.jobId);
  assert.equal(job.status, "completed", job.error);
  assert.equal(job.mode, "standard");
  const record = JSON.parse((await fs.readFile(path.join(storage, "results.jsonl"), "utf8")).trim());
  for (const metadata of [submitted.body, job, record]) {
    assert.equal(Object.hasOwn(metadata, "role"), false);
    assert.equal(Object.hasOwn(metadata, "propId"), false);
    assert.equal(Object.hasOwn(metadata, "propName"), false);
  }
  assert.equal(stub.requests.length, 1);
  assert.doesNotMatch(stub.requests[0].form.get("prompt"), /固定道具：/);
});
