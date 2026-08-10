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

/** Read only image URLs from today's storage/YYYY-MM-DD directory. */
export async function getTodayPhotoUrls() {
    const date = localDateString();
    if (!API_DATE_FORMAT.test(date)) throw new Error("無效的今日日期");

    const response = await fetch(`/api/photos/${date}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Photo API returned ${response.status}`);

    const data = await response.json();
    return Array.isArray(data.images)
        ? [...new Set(data.images.filter(isUsableImageUrl))]
        : [];
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

export function pickRandomPhoto(urls) {
    if (!Array.isArray(urls) || urls.length === 0) return "";
    return urls[Math.floor(Math.random() * urls.length)] || "";
}
