const MAX_ON_SCREEN = 20;
const POLL_INTERVAL = 10000;
const POP_INTERVAL = 3000;

let allPhotos = [];
let allPhotosIndex = 0;
let userPhotos = [];
const domElements = [];

const baseStyles = Array.from({ length: 10 }, (_, i) => {
    const num = String(i + 1).padStart(2, '0');
    return `url('/images/style-${num}.webp')`;
});

const baseStyleUrls = Array.from({ length: 10 }, (_, i) => {
    const num = String(i + 1).padStart(2, '0');
    return `/images/style-${num}.webp`;
});

function getTodayStr() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function fetchLatestPhotos() {
    try {
        const today = getTodayStr();
        const res = await fetch(`/api/photos/${today}`);
        const data = await res.json();
        
        if (data.images && data.images.length > 0) {
            userPhotos = data.images;
            const wrapped = data.images.map(url => `url('${url}')`);
            allPhotos = [...baseStyles, ...wrapped];
        }
    } catch (e) {
        console.error("Failed to fetch latest photos", e);
        if (allPhotos.length === 0) {
            allPhotos = [...baseStyles];
        }
    }

    if (userPhotos.length === 0) {
        userPhotos = [...baseStyleUrls];
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

function createDomElements() {
    const center = document.querySelector('.center');
    
    for (let i = 0; i < MAX_ON_SCREEN; i++) {
        const el = document.createElement('div');
        el.className = 'photo';
        
        const scatter = getRandomScatter();
        el.dataset.origTransform = `translate(${scatter.x}px, ${scatter.y}px) rotate(${scatter.rot}deg)`;
        el.style.transform = el.dataset.origTransform;
        
        const initialImg = allPhotos[i % allPhotos.length];
        el.style.setProperty('--bg-img', initialImg);
        
        center.appendChild(el);
        domElements.push(el);
    }
    
    allPhotosIndex = MAX_ON_SCREEN % allPhotos.length;
}

let popTimer;
let currentPopped = null;

function runPopCycle() {
    if (domElements.length === 0) return;
    
    const center = document.querySelector('.center');
    const outerCenter = document.querySelector('.outer-center');
    
    if (currentPopped) {
        currentPopped.classList.remove('normal-filter');
        currentPopped.style.transform = currentPopped.dataset.origTransform;
        center.appendChild(currentPopped);
        currentPopped = null;
    }
    
    const bgElements = domElements.filter(el => el.parentElement === center);
    if (bgElements.length === 0) return;
    
    const el = bgElements[Math.floor(Math.random() * bgElements.length)];
    
    const nextImg = allPhotos[allPhotosIndex % allPhotos.length];
    el.style.setProperty('--bg-img', nextImg);
    allPhotosIndex++;
    
    outerCenter.appendChild(el);
    el.classList.add('normal-filter');
    
    const popRot = (Math.random() - 0.5) * 20;
    const scale = window.innerWidth < 600 ? 1.7 : 1.8;
    el.style.transform = `scale(${scale}) rotate(${popRot}deg)`;
    
    currentPopped = el;
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

    const container = document.getElementById('winnersContainer');
    container.innerHTML = '';
    container.classList.add('active');

    clearInterval(popTimer);

    const shuffled = shuffle(userPhotos);
    const winners = shuffled.slice(0, 5);

    for (let i = 0; i < winners.length; i++) {
        await new Promise(resolve => setTimeout(resolve, 600));
        
        const el = document.createElement('div');
        el.className = 'photo winner';
        el.style.setProperty('--bg-img', `url('${winners[i]}')`);
        
        container.appendChild(el);
    }

    btn.textContent = "重新抽獎";
    btn.disabled = false;
}

async function init() {
    await fetchLatestPhotos();
    createDomElements();
    popTimer = setInterval(runPopCycle, POP_INTERVAL);
    setInterval(fetchLatestPhotos, POLL_INTERVAL);
    document.getElementById('drawButton').addEventListener('click', drawWinners);
}

let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        domElements.forEach(el => {
            if (!el.classList.contains('normal-filter')) {
                const scatter = getRandomScatter();
                el.dataset.origTransform = `translate(${scatter.x}px, ${scatter.y}px) rotate(${scatter.rot}deg)`;
                el.style.transform = el.dataset.origTransform;
            }
        });
    }, 500);
});

init();
