const MAX_BG_PHOTOS = 20;

let userPhotos = []; // 只存真實使用者的相片 URL
const domElements = [];

function getTodayStr() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function fetchPhotos() {
    try {
        const today = getTodayStr();
        const res = await fetch(`/api/results?date=${today}&limit=1000`);
        const data = await res.json();
        
        if (data.data && data.data.length > 0) {
            // 取得真實照片
            userPhotos = data.data.map(r => r.imageUrl);
        }
    } catch (e) {
        console.error("Failed to fetch photos", e);
    }
}

function getRandomScatter() {
    const minRadius = Math.min(window.innerWidth, window.innerHeight) * 0.25;
    const maxRadius = Math.max(window.innerWidth, window.innerHeight) * 0.7;
    const radius = minRadius + Math.random() * (maxRadius - minRadius);
    const angle = Math.random() * Math.PI * 2;
    
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    const rot = Math.random() * 360;
    
    return { x, y, rot };
}

function createBgElements() {
    const center = document.querySelector('.center');
    center.innerHTML = '';
    domElements.length = 0;
    
    // 建立背景裝飾圖片池
    let bgPool = [...userPhotos];
    
    // 如果真實相片不足 50 張，把基礎相片也混進來當背景
    if (userPhotos.length < 50) {
        const baseStyles = Array.from({ length: 10 }, (_, i) => {
            const num = String(i + 1).padStart(2, '0');
            return `/images/style-${num}.webp`;
        });
        bgPool = [...bgPool, ...baseStyles];
    }
    
    // 如果連1張照片都沒有（剛好也沒 baseStyles 就不建），不過有了 baseStyles 就一定會有照片
    if (bgPool.length === 0) return;

    for (let i = 0; i < MAX_BG_PHOTOS; i++) {
        const el = document.createElement('div');
        el.className = 'photo';
        
        const scatter = getRandomScatter();
        el.style.transform = `translate(${scatter.x}px, ${scatter.y}px) rotate(${scatter.rot}deg)`;
        
        // 從 bgPool 隨機塞一張照片做背景裝飾
        const img = bgPool[Math.floor(Math.random() * bgPool.length)];
        el.style.setProperty('--bg-img', `url('${img}')`);
        
        center.appendChild(el);
        domElements.push(el);
    }
}

// Fisher-Yates Shuffle
function shuffle(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

async function drawWinners() {
    if (userPhotos.length === 0) {
        alert("今日尚無照片，無法抽獎！");
        return;
    }

    const btn = document.getElementById('drawButton');
    btn.disabled = true;
    btn.textContent = "抽獎中...";

    const container = document.querySelector('.winners-container');
    container.innerHTML = ''; // 清空上次得獎者
    container.classList.add('active');

    // 洗牌並取出最多 5 張
    const shuffled = shuffle(userPhotos);
    const winners = shuffled.slice(0, 5);

    // 依序彈出中獎照片
    for (let i = 0; i < winners.length; i++) {
        await new Promise(resolve => setTimeout(resolve, 600)); // 每隔 0.6 秒彈出一張
        
        const el = document.createElement('div');
        el.className = 'photo winner';
        el.style.setProperty('--bg-img', `url('${winners[i]}')`);
        
        container.appendChild(el);
    }

    btn.textContent = "重新抽獎";
    btn.disabled = false;
}

async function init() {
    await fetchPhotos();
    createBgElements();
    
    document.getElementById('drawButton').addEventListener('click', drawWinners);
}

// RWD 重新散佈背景
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        domElements.forEach(el => {
            const scatter = getRandomScatter();
            el.style.transform = `translate(${scatter.x}px, ${scatter.y}px) rotate(${scatter.rot}deg)`;
        });
    }, 500);
});

init();
