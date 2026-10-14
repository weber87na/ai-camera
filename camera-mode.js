import { getStylePrompt } from "./styles.js";
import { OPERA_ROLES, getOperaPrompt } from "./opera.js";

/** Fail early on an invalid deployment setting rather than silently switching. */
export function getCameraMode(value = process.env.PHOTO_MODE) {
  if (value === undefined) return "standard";
  if (typeof value !== "string") {
    throw new Error("PHOTO_MODE 必須為 standard、opera 或歌仔戲。");
  }
  const mode = value.trim().toLowerCase();
  if (mode === "" || mode === "standard") return "standard";
  if (mode === "opera" || mode === "歌仔戲") return "opera";
  throw new Error("PHOTO_MODE 設定無效，請使用 standard、opera 或歌仔戲。");
}

/** This response is public: never include image-generation prompts or secrets. */
export function getCameraConfig(mode = getCameraMode()) {
  const cameraMode = getCameraMode(mode);
  return {
    mode: cameraMode,
    roles: cameraMode === "opera" ? OPERA_ROLES : []
  };
}

/** Reject incompatible requests before the caller sends a paid image request. */
export function getPhotoPrompt({ mode = "standard", style, role } = {}) {
  if (mode === "opera") {
    return style === "opera" ? getOperaPrompt(role) : null;
  }
  if (mode !== "standard" || role !== undefined) return null;
  return getStylePrompt(style);
}
