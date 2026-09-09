export const IMAGE_MODEL = "gpt-image-2.5-flare";
export const DEFAULT_IMAGE_QUALITY = "high";

// Verified 2026-09-09: https://developers.openai.com/api/docs/pricing
export const IMAGE_PRICING = Object.freeze({
  textInput: 5,
  cachedTextInput: 1.25,
  imageInput: 8,
  cachedImageInput: 2,
  imageOutput: 30
});

function rate(env, name, fallback) {
  const value = env[name];
  if (value == null || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function estimateCost(usage, exchangeRate, env = process.env) {
  const details = usage?.input_tokens_details;
  const output = usage?.output_tokens_details?.image_tokens ?? usage?.output_tokens;
  const valid = value => Number.isFinite(value) && value >= 0;
  const common = { exchangeRate, estimated: true, model: IMAGE_MODEL };
  if (!valid(details?.text_tokens) || !valid(details?.image_tokens) || !valid(output)) {
    return { ...common, usd: null, twd: null };
  }
  // Images API currently documents no per-modality cached-token breakdown.
  // Estimate inputs at standard rates; do not invent a cache split or discount.
  const usd = (
    details.text_tokens * rate(env, "TEXT_INPUT_USD_PER_MILLION", IMAGE_PRICING.textInput) +
    details.image_tokens * rate(env, "IMAGE_INPUT_USD_PER_MILLION", IMAGE_PRICING.imageInput) +
    output * rate(env, "IMAGE_OUTPUT_USD_PER_MILLION", IMAGE_PRICING.imageOutput)
  ) / 1_000_000;
  return { ...common, usd, twd: usd * exchangeRate };
}
