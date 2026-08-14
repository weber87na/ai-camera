const API_DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

export function localDateString(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

export function isUsableImageUrl(value) {
    if (!value || typeof value !== "string") return false;
    if (value.startsWith("data:image/")) return true;

    try {
        const baseUrl = globalThis.location?.origin || "http://localhost";
        const url = new URL(value, baseUrl);
        return ["http:", "https:"].includes(url.protocol);
    } catch {
        return false;
    }
}

function normalizePhotoEntry(value) {
    if (typeof value === "string") {
        return isUsableImageUrl(value) ? { url: value, name: "" } : null;
    }

    const url = value?.url;
    if (!isUsableImageUrl(url)) return null;
    const name = typeof value?.name === "string" ? value.name.replace(/\s+/g, " ").trim() : "";
    return { url, name };
}

/** Read image URLs and their saved participant names for today's draw. */
export async function getTodayPhotoEntries() {
    const date = localDateString();
    if (!API_DATE_FORMAT.test(date)) throw new Error("無效的今日日期");

    const response = await fetch(`/api/photos/${date}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Photo API returned ${response.status}`);

    const data = await response.json();
    const source = Array.isArray(data.photos) ? data.photos : data.images;
    if (!Array.isArray(source)) return [];

    const entries = source.map(normalizePhotoEntry).filter(Boolean);
    return [...new Map(entries.map(entry => [entry.url, entry])).values()];
}

/** Preserve the URL-only interface used by the gallery and film reel. */
export async function getTodayPhotoUrls() {
    const entries = await getTodayPhotoEntries();
    return entries.map(entry => entry.url);
}

/** Return only today's photos for the actual lottery result. */
export async function getPhotoCandidates() {
    try {
        return await getTodayPhotoUrls();
    } catch (error) {
        console.warn("讀取今日抽獎照片失敗，無法抽獎。", error);
    }

    return [];
}

/** Return today's lottery entries with both URL and participant name. */
export async function getPhotoCandidateEntries() {
    try {
        return await getTodayPhotoEntries();
    } catch (error) {
        console.warn("讀取今日抽獎照片與姓名失敗，無法抽獎。", error);
    }

    return [];
}

export function pickRandomPhoto(urls) {
    if (!Array.isArray(urls) || urls.length === 0) return "";
    return urls[Math.floor(Math.random() * urls.length)] || "";
}

export function pickRandomPhotoEntry(entries) {
    if (!Array.isArray(entries) || entries.length === 0) return null;
    return entries[Math.floor(Math.random() * entries.length)] || null;
}

export function createWinnerNameLabel(stage) {
    const label = document.createElement("div");
    label.className = "winner-name-label";
    label.setAttribute("role", "status");
    label.setAttribute("aria-live", "polite");
    label.setAttribute("aria-hidden", "true");
    stage.appendChild(label);

    let displayName = "";

    return {
        set(name) {
            const normalized = typeof name === "string" ? name.replace(/\s+/g, " ").trim() : "";
            displayName = normalized || "未具名參加者";
            label.textContent = displayName;
            return displayName;
        },
        show() {
            if (!displayName) return;
            label.classList.add("is-visible");
            label.setAttribute("aria-hidden", "false");
        },
        hide() {
            label.classList.remove("is-visible");
            label.setAttribute("aria-hidden", "true");
        },
        clear() {
            displayName = "";
            label.textContent = "";
            this.hide();
        }
    };
}
