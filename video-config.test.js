import test from "node:test";
import assert from "node:assert/strict";
import { getVideoConfig } from "./video-config.js";

test("video defaults are opt-in, silent, 3 seconds and 720p without aspect overrides or exposed secrets", () => {
  const config = getVideoConfig({ XAI_API_KEY: "private-key" });
  assert.deepEqual(config, {
    enabled: false, model: "grok-imagine-video-1.5-lite", duration: 3,
    resolution: "720p", generateAudio: false,
    timeoutMs: 600000, pollIntervalMs: 5000, baseUrl: "https://api.x.ai/v1"
  });
  assert.equal(JSON.stringify(config).includes("private-key"), false);
  assert.equal(Object.hasOwn(config, "aspectRatio"), false);
  assert.ok(Object.isFrozen(config));
});

test("video configuration accepts documented options and explicit local API mocks", () => {
  const config = getVideoConfig({
    VIDEO_ENABLED: "TRUE", VIDEO_MODEL: "grok-imagine-video-1.5", VIDEO_DURATION: "15",
    VIDEO_RESOLUTION: "1080p", VIDEO_GENERATE_AUDIO: "true",
    VIDEO_TIMEOUT_MS: "2000", VIDEO_POLL_INTERVAL_MS: "250", XAI_BASE_URL: "http://127.0.0.1:3123/v1/"
  });
  assert.equal(config.enabled, true);
  assert.equal(config.duration, 15);
  assert.equal(config.generateAudio, true);
  assert.equal(config.baseUrl, "http://127.0.0.1:3123/v1");
});

test("invalid environment settings fail early instead of silently changing the requested video", () => {
  const badSettings = {
    VIDEO_ENABLED: ["yes", "1"], VIDEO_GENERATE_AUDIO: ["no", "0"],
    VIDEO_MODEL: ["bad model", "../model"], VIDEO_DURATION: ["0", "16", "1.5", "3e0"],
    VIDEO_RESOLUTION: ["4k", "720"],
    VIDEO_TIMEOUT_MS: ["999", "3600001"], VIDEO_POLL_INTERVAL_MS: ["0", "249", "60001"],
    XAI_BASE_URL: ["garbage", "http://api.x.ai/v1", "https://user:pass@api.x.ai/v1", "https://api.x.ai/v1?k=secret", "https://api.x.ai/v1#fragment"]
  };
  for (const [name, values] of Object.entries(badSettings)) {
    for (const value of values) assert.throws(() => getVideoConfig({ [name]: value }), new RegExp(name));
  }
  assert.throws(() => getVideoConfig({ VIDEO_TIMEOUT_MS: "1000", VIDEO_POLL_INTERVAL_MS: "1000" }), /必須小於/);
});

