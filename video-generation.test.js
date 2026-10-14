import test from "node:test";
import assert from "node:assert/strict";
import { getVideoConfig } from "./video-config.js";
import { generateVideo, getVideoPrompt } from "./video-generation.js";

const config = getVideoConfig({ VIDEO_ENABLED: "true", VIDEO_POLL_INTERVAL_MS: "250" });
// A real 2x3 JPEG fixture; submitting it must not change dimensions or encoding.
const input = Buffer.from("/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAADAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgj/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABykX//Z", "base64");
const mp4 = Buffer.from([0, 0, 0, 24, ...Buffer.from("ftypisom"), 0, 0, 0, 0, ...Buffer.from("isommp42")]);
const json = data => Response.json(data);
const done = extra => ({ status: "done", video: { url: "https://cdn.example/video.mp4", duration: 3, respect_moderation: true }, ...extra });

async function run(responses, options = {}) {
  const requests = [];
  const events = [];
  let now = 0;
  const result = await generateVideo({
    image: input, mode: "opera", role: "dan", apiKey: "test-key", config,
    nowFn: () => now,
    sleepFn: async ms => { now += ms; },
    onProgress: event => events.push(event),
    fetchFn: async (url, request) => {
      requests.push({ url, ...request });
      const response = responses.shift();
      if (response instanceof Error) throw response;
      assert.ok(response, `unexpected request ${url}`);
      return response;
    },
    ...options
  });
  return { result, requests, events };
}

test("submit/poll/download uses selected parameters, server auth and anonymous CDN download", async () => {
  const { result, requests, events } = await run([
    json({ request_id: "job 123" }), json({ status: "pending", progress: 41 }),
    json(done({ model: "grok-imagine-video-1.5-lite", usage: { cost_in_usd_ticks: 1200000000 } })),
    new Response(mp4, { headers: { "content-type": "video/mp4" } })
  ]);
  assert.equal(requests.length, 4);
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].headers.Authorization, "Bearer test-key");
  const body = JSON.parse(requests[0].body);
  assert.equal(body.model, config.model);
  assert.equal(body.duration, 3);
  assert.equal(body.resolution, "720p");
  assert.equal(Object.hasOwn(body, "aspect_ratio"), false);
  assert.equal(body.generate_audio, false);
  assert.match(body.image.url, /^data:image\/jpeg;base64,/);
  assert.deepEqual(Buffer.from(body.image.url.split(",")[1], "base64"), input, "source JPEG bytes are preserved exactly");
  assert.match(body.prompt, /目連救母/);
  assert.match(body.prompt, /全片必須無聲/);
  assert.equal(requests[1].url, "https://api.x.ai/v1/videos/job%20123");
  assert.equal(requests[3].headers.Authorization, undefined);
  assert.deepEqual(result.buffer, mp4);
  assert.equal(result.requestId, "job 123");
  assert.equal(result.costUsd, 0.12);
  assert.equal(Object.hasOwn(result, "aspectRatio"), false);
  assert.deepEqual(events.map(event => event.stage), ["submitting", "generating", "generating", "downloading"]);
});

test("role motion retains assigned props and Santa opera details; standard stays generic", () => {
  const sheng = getVideoPrompt({ mode: "opera", role: "sheng" });
  assert.match(sheng, /完整紙扇/);
  const dan = getVideoPrompt({ mode: "opera", role: "dan" });
  assert.match(dan, /U 形鐵鍊/);
  assert.match(dan, /絕不可裁掉鐵鍊或雙手/);
  const jing = getVideoPrompt({ mode: "opera", role: "jing" });
  assert.match(jing, /竹製傘骨/);
  const chou = getVideoPrompt({ mode: "opera", role: "chou" });
  assert.match(chou, /聖誕老人/);
  assert.match(chou, /3 × 3 = 9 格/);
  assert.match(chou, /不增加白鬍鬚/);
  const standard = getVideoPrompt({ mode: "standard", style: "watercolor", generateAudio: true });
  assert.match(standard, /保持原圖既有的美術風格/);
  assert.doesNotMatch(standard, /歌仔戲|全片必須無聲/);
  assert.throws(() => getVideoPrompt({ mode: "opera", role: "other" }), /角色無效/);
});

test("all four user-approved video motion paragraphs are retained verbatim", () => {
  const approved = {
    sheng: "以原圖生角人物為主角，完整保留原有五官、黑色書生帽、青藍色金色竹紋長袍、白色水袖及梅花摺扇。人物展現臺灣歌仔戲小生儒雅瀟灑的傳統戲曲身段。起初微微側頭，目光溫柔地望向遠方，接著右手優雅地將展開的摺扇輕輕抬高，在胸前緩慢搖動一次，另一隻手配合做出含蓄的戲曲手勢，白色長袖自然垂落輕輕擺動。人物露出淡淡微笑，身體輕微側轉，最後停留在俊雅的書生亮相姿勢。鏡頭平穩緩慢推近，柔和暖色舞台光線，寫實傳統戲曲電影質感。",
    dan: "以原圖旦角人物為主角，保持人物容貌、紫色傳統戲服、長髮造型、雙手鐵鍊及紅色舞台布幕一致。人物展現臺灣歌仔戲旦角優雅而哀傷的傳統表演，眼神緩緩望向斜上方，眉頭微蹙，眼眶帶著淚光，嘴唇輕輕開合，彷彿正在唱出哀怨婉轉的歌仔戲唱腔。雙手緩慢抬起，鐵鍊隨動作自然下垂並輕輕晃動，衣袖柔順飄動。人物姿態端莊，動作柔美細膩，鏡頭緩慢推近至上半身，戲劇舞台暖色聚光燈，寫實電影級畫質。",
    jing: "以原圖淨角人物為唯一主角，保留原有戲曲臉譜、官帽、黑色長鬍鬚、華麗刺繡戲服及手持油紙傘。人物展現臺灣歌仔戲淨角威武莊嚴的舞台身段。開場目光凌厲地注視前方，接著緩慢轉頭，雙眼有力地瞪視側前方，下巴微微抬起，呈現威嚴的英雄氣勢。持傘的手微微調整姿勢，油紙傘輕輕傾斜，長鬍鬚及寬大衣袖隨動作自然擺動，另一隻手保持叉腰姿勢。最後定格於威風凜凜的戲曲亮相動作。鏡頭由全身緩慢推近，莊嚴舞台燈光，電影級寫實影像。",
    chou: "以原圖人物為唯一主角，保持原有臉部五官、服裝、紅色聖誕帽、糕點禮盒及舞台背景完全一致。人物展現臺灣歌仔戲丑角詼諧逗趣的表演，先俏皮地挑起眉毛，眼珠靈活地向左右轉動，接著頭部輕輕歪向一側，露出調皮得意的笑容。雙手穩穩捧著九宮格糕點禮盒，身體輕微左右搖擺，彷彿正在向觀眾獻寶。動作自然連貫，具有傳統歌仔戲丑角幽默的舞台節奏。鏡頭緩慢推近，暖色舞台燈光，寫實戲曲表演質感。"
  };
  for (const [role, paragraph] of Object.entries(approved)) {
    const prompt = getVideoPrompt({ mode: "opera", role });
    assert.ok(prompt.split("\n").includes(paragraph), `${role} keeps the exact approved paragraph`);
    assert.match(prompt, /全片必須無聲/);
  }
});

test("disabled video and missing credentials fail before any provider call", async () => {
  const fetchFn = async () => assert.fail("must not submit");
  await assert.rejects(() => run([], { config: getVideoConfig({}), fetchFn }), { code: "VIDEO_DISABLED" });
  await assert.rejects(() => run([], { apiKey: "", fetchFn }), { code: "VIDEO_CONFIG_ERROR" });
});

test("POST failures are not retried; transient poll failures are retried without resubmitting", async () => {
  let count = 0;
  await assert.rejects(() => run([], { fetchFn: async () => { count += 1; return new Response("rate limited", { status: 429 }); } }), /HTTP 429/);
  assert.equal(count, 1);
  const { requests } = await run([
    json({ request_id: "one-job" }), new Response("busy", { status: 503 }),
    new Response("slow down", { status: 429 }), json(done()), new Response(mp4)
  ]);
  assert.equal(requests.filter(request => request.method === "POST").length, 1);
  assert.equal(requests.length, 5);
});

test("failed, expired and unexpected provider states reject without downloading", async () => {
  for (const status of ["failed", "expired", "surprise"]) {
    await assert.rejects(() => run([json({ request_id: "job" }), json({ status })]), /影片生成失敗|未知的工作狀態/);
  }
  await assert.rejects(() => run([json({})]), /request_id/);
  await assert.rejects(() => run([new Response("not-json")]), /JSON/);
});

test("moderation failures and completed jobs without a usable URL reject", async () => {
  await assert.rejects(() => run([
    json({ request_id: "job" }), json(done({ video: { respect_moderation: false, url: "https://cdn.example/blocked.mp4" } }))
  ]), { code: "VIDEO_MODERATION" });
  await assert.rejects(() => run([json({ request_id: "job" }), json(done({ video: {} }))]), /沒有回傳可下載/);
  await assert.rejects(() => run([
    json({ request_id: "job" }), json(done({ video: { url: "https://cdn.example/unverified.mp4" } }))
  ]), /內容檢查狀態無效/);
  await assert.rejects(() => run([
    json({ request_id: "job" }), json(done({ video: { url: "http://cdn.example/video.mp4", respect_moderation: true } }))
  ]), /HTTPS/);
});

test("pending jobs expire at total timeout instead of polling forever", async () => {
  let now = 0;
  let count = 0;
  await assert.rejects(() => run([], {
    config: { ...config, timeoutMs: 1000 }, nowFn: () => now,
    sleepFn: async ms => { now += ms; },
    fetchFn: async () => { count += 1; return count === 1 ? json({ request_id: "job" }) : json({ status: "pending" }); }
  }), { code: "VIDEO_TIMEOUT" });
  assert.equal(count, 5);
});

test("a stalled HTTP response is aborted within the remaining deadline", async () => {
  let signal;
  await assert.rejects(() => run([], {
    config: { ...config, timeoutMs: 30 },
    fetchFn: async (_, options) => { signal = options.signal; return new Promise(() => {}); }
  }), { code: "VIDEO_TIMEOUT" });
  assert.equal(signal.aborted, true);
});

test("download rejects HTTP failures, non-MP4 output, oversize output and insecure redirects", async () => {
  const cases = [
    [new Response("expired", { status: 403 }), /HTTP 403/],
    [new Response("<html>expired file</html>"), /MP4/],
    [new Response(mp4, { headers: { "content-length": String(101 * 1024 * 1024) } }), /大小限制/],
    [new Response(null, { status: 302, headers: { location: "http://cdn.example/file.mp4" } }), /HTTPS/]
  ];
  for (const [response, expected] of cases) {
    await assert.rejects(() => run([json({ request_id: "job" }), json(done()), response]), expected);
  }
});

test("HTTPS CDN redirects are followed without leaking the API key and unknown cost stays unknown", async () => {
  const { requests, result } = await run([
    json({ request_id: "job" }), json(done()),
    new Response(null, { status: 302, headers: { location: "https://other.example/signed.mp4" } }), new Response(mp4)
  ]);
  assert.equal(requests.at(-1).url, "https://other.example/signed.mp4");
  assert.equal(requests.at(-1).headers.Authorization, undefined);
  assert.equal(Object.hasOwn(result, "costUsd"), false);
  assert.equal(result.usage, null);
});
