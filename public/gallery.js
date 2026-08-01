const POLL_INTERVAL = 10000;

let photos = []; // 當前顯示的圖片 URL 陣列
const cardMap = new Map(); // URL → DOM element 的對照表

const baseStyleUrls = Array.from({ length: 10 }, (_, i) => {
    const num = String(i + 1).padStart(2, '0');
    return `/images/style-${num}.webp`;
});

function getTodayStr() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function fetchPhotos() {
    try {
        const today = getTodayStr();
        const res = await fetch(`/api/photos/${today}`);
        const data = await res.json();
        
        if (data.images && data.images.length > 0) {
            return data.images;
        }
    } catch (e) {
        console.error("Failed to fetch photos", e);
    }

    // 今日無照片時，使用範例圖片
    return [...baseStyleUrls];
}

function createCard(url) {
    const card = document.createElement('div');
    card.className = 'polaroid-card';
    card.addEventListener('click', () => openLightbox(url));

    const photo = document.createElement('div');
    photo.className = 'card-photo';
    photo.style.backgroundImage = `url('${url}')`;

    card.appendChild(photo);
    return card;
}

/**
 * 差異更新 grid：只新增 / 移除有變動的卡片，不影響現有 DOM
 */
function syncGrid(newPhotos) {
    const grid = document.getElementById('galleryGrid');
    const empty = document.getElementById('galleryEmpty');

    const newSet = new Set(newPhotos);
    const oldSet = new Set(photos);

    // 1. 移除已不存在的卡片
    for (const url of photos) {
        if (!newSet.has(url)) {
            const card = cardMap.get(url);
            if (card) {
                card.remove();
                cardMap.delete(url);
            }
        }
    }

    // 2. 新增新的卡片（append 到尾端）
    for (const url of newPhotos) {
        if (!oldSet.has(url)) {
            const card = createCard(url);
            grid.appendChild(card);
            cardMap.set(url, card);
        }
    }

    // 3. 更新照片陣列
    photos = newPhotos;

    // 4. 切換空狀態提示
    empty.style.display = photos.length === 0 ? '' : 'none';
}

// ── Lightbox ──────────────────────────────────

function openLightbox(url) {
    const lightbox = document.getElementById('lightbox');
    const photoEl = document.getElementById('lightboxPhoto');

    // 清除舊的照片 div
    photoEl.innerHTML = '';

    const inner = document.createElement('div');
    inner.className = 'card-photo';
    inner.style.backgroundImage = `url('${url}')`;
    photoEl.appendChild(inner);

    lightbox.classList.add('active');
}

function closeLightbox() {
    document.getElementById('lightbox').classList.remove('active');
}

document.getElementById('lightboxClose').addEventListener('click', closeLightbox);
document.getElementById('lightbox').addEventListener('click', (e) => {
    // 點擊背景（非照片區域）時關閉
    if (e.target === e.currentTarget) closeLightbox();
});

// ESC 鍵關閉
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeLightbox();
});

// ── 初始化 ────────────────────────────────────

async function init() {
    const initialPhotos = await fetchPhotos();
    syncGrid(initialPhotos);

    // 定期輪詢，差異更新
    setInterval(async () => {
        const latest = await fetchPhotos();

        // 快速比對：長度不同或內容不同才更新
        if (latest.length !== photos.length || latest.some((url, i) => url !== photos[i])) {
            syncGrid(latest);
        }
    }, POLL_INTERVAL);
}

init();

