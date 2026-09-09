import test from "node:test";
import assert from "node:assert/strict";
import { estimateCost } from "./image-config.js";

const usage = {
  input_tokens_details: { text_tokens: 1000, image_tokens: 2000 },
  output_tokens: 3000
};

test("standard text, image input and image output rates with TWD conversion", () => {
  const cost = estimateCost(usage, 32.5, {});
  assert.equal(cost.usd, 0.111);
  assert.equal(cost.twd, 0.111 * 32.5);
});

test("image output details exclude text output from billing", () => {
  const cost = estimateCost({ ...usage, output_tokens_details: { image_tokens: 2000, text_tokens: 1000 } }, 32.5, {});
  assert.equal(cost.usd, 0.081);
});

test("missing or invalid usage is unknown, while explicit zero is free", () => {
  for (const value of [undefined, {}, { output_tokens: 1 }, { ...usage, output_tokens: -1 }]) {
    assert.equal(estimateCost(value, 32.5, {}).usd, null);
  }
  assert.equal(estimateCost({ input_tokens_details: { text_tokens: 0, image_tokens: 0 }, output_tokens: 0 }, 32.5, {}).usd, 0);
});

test("rate overrides allow zero and reject invalid prices", () => {
  assert.equal(estimateCost(usage, 32.5, { TEXT_INPUT_USD_PER_MILLION: "0" }).usd, 0.106);
  for (const value of ["", " ", "invalid", "-1", "Infinity"]) {
    assert.equal(estimateCost(usage, 32.5, { IMAGE_OUTPUT_USD_PER_MILLION: value }).usd, 0.111);
  }
});
