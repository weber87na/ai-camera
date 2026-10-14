/** Match the date folders written by the server, regardless of device timezone. */
export function operaDateString(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}

function mediaUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return '';
    try {
        const url = new URL(value, globalThis.location?.origin || 'http://localhost');
        return ['http:', 'https:'].includes(url.protocol) ? value : '';
    } catch { return ''; }
}

/** All four props use one pool. Video draws only include finished video pairs. */
export function operaCandidates(data, videoEnabled) {
    if (!Array.isArray(data?.photos)) return [];
    const entries = data.photos.flatMap(photo => {
        const url = mediaUrl(photo?.url);
        const video = mediaUrl(photo?.video);
        if (!url || (videoEnabled && !video)) return [];
        const name = typeof photo.name === 'string' ? photo.name.replace(/\s+/g, ' ').trim() : '';
        return [{
            url, video: videoEnabled ? video : '', name: name || '未具名參加者',
            participantKey: name ? `name:${name}` : `url:${url}`
        }];
    });
    return [...new Map(entries.map(entry => [entry.url, entry])).values()];
}

function participantKey(entry) {
    if (entry?.participantKey) return entry.participantKey;
    const name = typeof entry?.name === 'string' ? entry.name.replace(/\s+/g, ' ').trim() : '';
    return name ? `name:${name}` : `url:${entry?.url}`;
}

export function pickOperaWinner(entries, previousWinner = null) {
    if (!entries.length) return null;
    const alternatives = previousWinner
        ? entries.filter(entry => participantKey(entry) !== participantKey(previousWinner))
        : entries;
    // A single participant stays drawable even when they own several photos.
    const candidates = alternatives.length ? alternatives : entries;
    // Rejection sampling keeps selection unbiased within the eligible pool.
    const random = new Uint32Array(1);
    const limit = 0x100000000 - (0x100000000 % candidates.length);
    do { globalThis.crypto.getRandomValues(random); } while (random[0] >= limit);
    return candidates[random[0] % candidates.length];
}

export async function fetchOperaPool() {
    const signal = AbortSignal.timeout(10000);
    const configResponse = await fetch('/api/config', { cache: 'no-store', signal });
    if (!configResponse.ok) throw new Error('無法讀取抽獎設定，請稍後重試。');
    const config = await configResponse.json();
    if (config.mode !== 'opera') throw new Error('目前未開啟歌仔戲模式，請返回拍照頁。');
    const videoEnabled = config.video?.enabled === true;
    const date = operaDateString();
    const response = await fetch(`/api/photos/${date}`, { cache: 'no-store', signal });
    if (!response.ok) throw new Error('無法讀取今日名單，請稍後重試。');
    return { date, videoEnabled, entries: operaCandidates(await response.json(), videoEnabled) };
}
