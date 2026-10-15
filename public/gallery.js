import { startOperaPetals } from './opera-petals.js?v=1';
import { getOrderedOperaRoles, getOperaPortraitUrl } from './opera-mode.js?v=10';

const POLL_INTERVAL = 10000;
const OPERA_MIN_CELLS = 9;
// Match the homepage portraits; these placeholders never enter the photo API.
const operaSamples = new Map();

let photos = []; // 當前顯示的圖片 URL 陣列
const cardMap = new Map(); // URL → DOM element 的對照表
const photoNames = new Map();
const photoVideos = new Map();
let galleryMode = null;
let galleryVideo = { enabled: false };
let initializing = false;
let pollTimer = null;
let lightboxTrigger = null;
let polling = false;
const emptySlots = [];
const operaGroups = [];
const backgroundInert = new Map();

const baseStyleUrls = Array.from({ length: 10 }, (_, i) => {
    const num = String(i + 1).padStart(2, '0');
    return `/images/style-${num}.webp`;
});

function setGalleryStatus(message) {
    document.getElementById('galleryStatusText').textContent = message;
    document.getElementById('galleryStatus').hidden = !message;
}

async function loadGalleryMode() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
        const response = await fetch('/api/config', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('Unable to load camera mode');
        const config = await response.json();
        if (!['standard', 'opera'].includes(config.mode)) throw new Error('Invalid camera mode');
        galleryMode = config.mode;
        galleryVideo = config.video || { enabled: false };
        const opera = galleryMode === 'opera';
        operaSamples.clear();
        if (opera) {
            for (const role of getOrderedOperaRoles(config.roles)) {
                operaSamples.set(`/${getOperaPortraitUrl(role)}`, `${role.name}・角色造型示意`);
            }
        }
        document.getElementById('galleryLotteryLink').hidden = !opera;
        document.body.classList.toggle('opera-mode', opera);
        if (opera) startOperaPetals();
        document.getElementById('galleryTitle').textContent = opera ? '歌仔戲藝廊' : '映像間';
        document.getElementById('gallerySubtitle').textContent = opera ? '戲曲寫真・今日好戲' : '今日作品';
        document.querySelector('meta[name="theme-color"]').content = opera ? '#211719' : '#1a1a1a';
        document.title = opera ? '映像間｜歌仔戲藝廊' : '映像間｜作品藝廊';
    } finally {
        clearTimeout(timeout);
    }
}

function photoLabel(url) {
    return photoNames.get(url) || (galleryMode === 'opera' ? operaSamples.get(url) || '今日戲影' : 'AI 風格作品');
}

function getTodayStr() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function fetchPhotos() {
    try {
        const today = getTodayStr();
        const res = await fetch(`/api/photos/${today}`);
        if (!res.ok) throw new Error('Unable to load gallery photos');
        const data = await res.json();
        
        if (Array.isArray(data.images) && data.images.length > 0) {
            photoNames.clear();
            photoVideos.clear();
            for (const photo of data.photos || []) {
                if (typeof photo?.url === 'string' && typeof photo.name === 'string' && photo.name.trim()) {
                    photoNames.set(photo.url, photo.name.trim());
                }
                if (galleryVideo.enabled && typeof photo?.url === 'string' && typeof photo.video === 'string' && photo.video) {
                    photoVideos.set(photo.url, photo.video);
                }
            }
            setGalleryStatus('');
            return data.images.filter(url => typeof url === 'string');
        }
    } catch (e) {
        console.error("Failed to fetch photos", e);
        // Keep existing results visible during a temporary polling failure.
        if (photos.length) {
            setGalleryStatus('作品更新暫時中斷，稍後將自動重試。');
            return photos;
        }
    }

    // 尚無作品時使用首頁的角色示意圖，其餘位置由九宮格補空。
    photoVideos.clear();
    photoNames.clear();
    if (galleryMode === 'opera') {
        setGalleryStatus('');
        photoNames.clear();
        return [...operaSamples.keys()];
    }
    setGalleryStatus('');
    return [...baseStyleUrls];
}

function createCard(url) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'polaroid-card';
    card.setAttribute('aria-label', `欣賞${photoLabel(url)}`);
    card.addEventListener('click', () => openLightbox(url, card));

    const photo = document.createElement('div');
    photo.className = 'card-photo';
    const image = document.createElement('img');
    image.src = url;
    image.alt = photoLabel(url);
    image.loading = 'lazy';
    image.decoding = 'async';
    photo.appendChild(image);

    card.appendChild(photo);
    return card;
}

/** Keep matching cards mounted while the continuously scrolling grid updates. */
function renderGallery() {
    const grid = document.getElementById('galleryGrid');
    const empty = document.getElementById('galleryEmpty');
    const focusedCard = grid.contains(document.activeElement) ? document.activeElement : null;
    const visibleSet = new Set(photos);

    for (const [url, card] of cardMap) {
        if (!visibleSet.has(url)) {
            card.remove();
            cardMap.delete(url);
        }
    }

    const groupCount = galleryMode === 'opera' ? Math.max(1, Math.ceil(photos.length / OPERA_MIN_CELLS)) : 0;
    while (operaGroups.length < groupCount) {
        const group = document.createElement('section');
        group.className = 'opera-gallery-group';
        group.setAttribute('aria-label', `第 ${operaGroups.length + 1} 組作品`);
        operaGroups.push(group);
        grid.appendChild(group);
    }
    const placeCell = (cell, index) => {
        const parent = galleryMode === 'opera' ? operaGroups[Math.floor(index / OPERA_MIN_CELLS)] : grid;
        const position = galleryMode === 'opera' ? index % OPERA_MIN_CELLS : index;
        const current = parent.children[position];
        if (current !== cell) parent.insertBefore(cell, current || null);
    };

    photos.forEach((url, index) => {
        let card = cardMap.get(url);
        if (!card) {
            card = createCard(url);
            cardMap.set(url, card);
        }
        const label = photoLabel(url);
        card.setAttribute('aria-label', `欣賞${label}`);
        card.querySelector('img').alt = label;
        // insertBefore also fixes changed server ordering without reloading images.
        placeCell(card, index);
    });

    const cellCount = galleryMode === 'opera'
        ? groupCount * OPERA_MIN_CELLS
        : photos.length;
    const missing = cellCount - photos.length;
    while (emptySlots.length > missing) emptySlots.pop().remove();
    while (emptySlots.length < missing) {
        const slot = document.createElement('div');
        slot.className = 'gallery-placeholder';
        slot.setAttribute('aria-hidden', 'true');
        emptySlots.push(slot);
    }
    emptySlots.forEach((slot, index) => {
        placeCell(slot, photos.length + index);
    });
    // Move retained photos first, then remove now-empty groups after deletions.
    while (operaGroups.length > groupCount) operaGroups.pop().remove();
    empty.style.display = galleryMode !== 'opera' && photos.length === 0 ? '' : 'none';
    if (focusedCard?.isConnected && document.activeElement !== focusedCard) {
        focusedCard.focus({ preventScroll: true });
    }
}

function syncGrid(newPhotos) {
    photos = [...new Set(newPhotos.filter(url => typeof url === 'string'))];
    renderGallery();
}

// ── Lightbox ──────────────────────────────────

function releaseLightboxVideo() {
    const video = document.querySelector('#lightboxPhoto video');
    if (!video) return;
    video.onerror = null;
    video.onloadedmetadata = null;
    video.pause();
    video.removeAttribute('src');
    video.removeAttribute('poster');
    video.load();
}
function setLightboxMessage(message) {
    const status = document.getElementById('lightboxMediaStatus');
    status.textContent = message || '';
    status.hidden = !message;
}
function setBackgroundInert(inert) {
    if (inert) {
        for (const element of document.querySelectorAll('.gallery-header, #galleryStatus, #galleryGrid, #galleryEmpty')) {
            if (!backgroundInert.has(element)) backgroundInert.set(element, element.inert);
            element.inert = true;
        }
    } else {
        for (const [element, previous] of backgroundInert) element.inert = previous;
        backgroundInert.clear();
    }
}
function openLightbox(url, trigger) {
    const lightbox = document.getElementById('lightbox');
    const photoEl = document.getElementById('lightboxPhoto');
    lightboxTrigger = trigger;
    releaseLightboxVideo();
    photoEl.replaceChildren();
    photoEl.classList.remove('has-video');
    setLightboxMessage('');

    const inner = document.createElement('div');
    inner.className = 'card-photo';
    const showImage = () => {
        inner.replaceChildren();
        const image = document.createElement('img');
        image.src = url;
        image.alt = photoLabel(url);
        inner.appendChild(image);
    };
    const videoUrl = galleryVideo.enabled && photoVideos.get(url);
    let video;
    if (videoUrl) {
        video = document.createElement('video');
        video.controls = true;
        video.autoplay = true;
        video.muted = true;
        video.defaultMuted = true;
        video.loop = true;
        video.playsInline = true;
        video.preload = 'metadata';
        video.tabIndex = 0;
        video.setAttribute('aria-label', `${photoLabel(url)}的影片`);
        video.poster = url;
        const thumbnail = trigger?.querySelector('img');
        const posterRatio = thumbnail?.naturalWidth && thumbnail.naturalHeight ? thumbnail.naturalWidth / thumbnail.naturalHeight : 1;
        photoEl.style.setProperty('--lightbox-video-ratio', posterRatio);
        video.onloadedmetadata = () => {
            if (video.videoWidth && video.videoHeight) photoEl.style.setProperty('--lightbox-video-ratio', video.videoWidth / video.videoHeight);
        };
        photoEl.classList.add('has-video');
        video.onerror = () => {
            if (!video.isConnected) return;
            releaseLightboxVideo();
            photoEl.classList.remove('has-video');
            showImage();
            setLightboxMessage('影片暫時無法播放，先顯示照片。');
        };
        video.src = videoUrl;
        inner.appendChild(video);
    } else showImage();
    photoEl.appendChild(inner);

    document.body.classList.add('lightbox-open');
    setBackgroundInert(true);
    lightbox.setAttribute('aria-hidden', 'false');
    lightbox.classList.add('active');
    document.getElementById('lightboxClose').focus();
    if (video) video.play().catch(() => {
        if (video.isConnected && video.getAttribute('src')) setLightboxMessage('點擊影片播放鍵即可播放。');
    });
}

function closeLightbox(restoreFocus = true) {
    const lightbox = document.getElementById('lightbox');
    const wasActive = lightbox.classList.contains('active');
    releaseLightboxVideo();
    document.getElementById('lightboxPhoto').replaceChildren();
    lightbox.classList.remove('active');
    lightbox.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('lightbox-open');
    setBackgroundInert(false);
    if (!wasActive || !restoreFocus) return;
    if (lightboxTrigger?.isConnected) lightboxTrigger.focus();
    else (document.querySelector('#galleryGrid button') || document.querySelector('.gallery-back'))?.focus();
}

document.getElementById('lightboxClose').addEventListener('click', () => closeLightbox());
document.getElementById('lightbox').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeLightbox();
});

// Sentinels leave native video controls in the tab order, and loop at the dialog edges.
document.getElementById('lightboxFocusStart').addEventListener('focus', () => {
    (document.querySelector('#lightboxPhoto video') || document.getElementById('lightboxClose')).focus();
});
document.getElementById('lightboxFocusEnd').addEventListener('focus', () => document.getElementById('lightboxClose').focus());
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeLightbox();
}, true);
window.addEventListener('pagehide', () => closeLightbox(false));

// ── 初始化 ────────────────────────────────────

async function init() {
    if (initializing || pollTimer) return;
    initializing = true;
    document.getElementById('galleryRetry').hidden = true;
    setGalleryStatus('正在準備作品藝廊…');
    try {
        await loadGalleryMode();
        const initialPhotos = await fetchPhotos();
        syncGrid(initialPhotos);

        // 定期輪詢，差異更新
        pollTimer = setInterval(async () => {
            if (polling) return;
            polling = true;
            try {
                const latest = await fetchPhotos();
                // Reuse unchanged cards, but refresh labels and ordering from the server.
                syncGrid(latest);
            } finally {
                polling = false;
            }
        }, POLL_INTERVAL);
    } catch {
        setGalleryStatus('無法載入藝廊設定，請確認網路後重試。');
        document.getElementById('galleryRetry').hidden = false;
    } finally {
        initializing = false;
    }
}

document.getElementById('galleryRetry').addEventListener('click', init);
init();

