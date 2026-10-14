export const DEFAULT_VIDEO_MODEL = "grok-imagine-video-1.5-lite";
export const VIDEO_RESOLUTIONS = Object.freeze(["480p", "720p", "1080p"]);

function value(env, key, fallback) {
  const configured = env[key];
  return configured == null || String(configured).trim() === "" ? fallback : String(configured).trim();
}

function boolean(env, key, fallback) {
  const configured = value(env, key, String(fallback)).toLowerCase();
  if (configured !== "true" && configured !== "false") throw new Error(`${key} 必須設定為 true 或 false。`);
  return configured === "true";
}

function integer(env, key, fallback, min, max) {
  const configured = value(env, key, String(fallback));
  const parsed = Number(configured);
  if (!/^\d+$/.test(configured) || !Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${key} 必須是 ${min} 至 ${max} 的整數。`);
  }
  return parsed;
}

function choice(env, key, fallback, allowed) {
  const configured = value(env, key, fallback);
  if (!allowed.includes(configured)) throw new Error(`${key} 必須是 ${allowed.join("、")} 其中之一。`);
  return configured;
}

export function isLoopbackUrl(url) {
  return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

/** Public configuration only: the API key is deliberately never returned. */
export function getVideoConfig(env = process.env) {
  const baseUrl = value(env, "XAI_BASE_URL", "https://api.x.ai/v1").replace(/\/+$/, "");
  let parsedUrl;
  try { parsedUrl = new URL(baseUrl); } catch { throw new Error("XAI_BASE_URL 必須是有效的 HTTPS 網址。"); }
  if ((parsedUrl.protocol !== "https:" && !(parsedUrl.protocol === "http:" && isLoopbackUrl(parsedUrl))) ||
      parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash) {
    throw new Error("XAI_BASE_URL 必須使用 HTTPS；僅本機測試可使用 HTTP，且不可包含帳密、查詢或片段。");
  }

  const timeoutMs = integer(env, "VIDEO_TIMEOUT_MS", 600000, 1000, 3600000);
  const pollIntervalMs = integer(env, "VIDEO_POLL_INTERVAL_MS", 5000, 250, 60000);
  if (pollIntervalMs >= timeoutMs) throw new Error("VIDEO_POLL_INTERVAL_MS 必須小於 VIDEO_TIMEOUT_MS。");
  const model = value(env, "VIDEO_MODEL", DEFAULT_VIDEO_MODEL);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(model)) throw new Error("VIDEO_MODEL 必須是有效的模型名稱。");

  return Object.freeze({
    enabled: boolean(env, "VIDEO_ENABLED", false),
    model,
    duration: integer(env, "VIDEO_DURATION", 3, 1, 15),
    resolution: choice(env, "VIDEO_RESOLUTION", "720p", VIDEO_RESOLUTIONS),
    generateAudio: boolean(env, "VIDEO_GENERATE_AUDIO", false),
    timeoutMs,
    pollIntervalMs,
    baseUrl
  });
}

