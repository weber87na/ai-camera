const MAX_ON_SCREEN = 20;
const POLL_INTERVAL = 10000;
const POP_INTERVAL = 3000;

let allPhotos = [];
let allPhotosIndex = 0;
const domElements = [];

// Base styles from the app
const baseStyles = Array.from({ length: 10 }, (_, i) => {
    const num = String(i + 1).padStart(2, '0');
    return `url('/images/style-${num}.webp')`;
});

function getTodayStr() {
    // Return YYYY-MM-DD
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function fetchLatestPhotos() {
    try {
        const today = getTodayStr();
        // Fetch up to 1000 records for today to ensure we get all of them
        const res = await fetch(`/api/results?date=${today}&limit=1000`);
        const data = await res.json();
        
        if (data.data) {
            // The API returns newest first (descending). We want oldest first (ascending)
            // so they show up sequentially as they were taken today.
            const userPhotos = data.data.reverse().map(r => `url('${r.imageUrl}')`);
            
            // Rebuild the allPhotos array
            // It contains the 10 base styles followed by all user photos of the day
            allPhotos = [...baseStyles, ...userPhotos];
        }
    } catch (e) {
        console.error("Failed to fetch latest photos", e);
        // Fallback to just base styles if fetch fails
        if (allPhotos.length === 0) {
            allPhotos = [...baseStyles];
        }
    }
}

// Generate random coordinates avoiding the direct center (to form a ring-like scatter)
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
        
        // Initial setup
        const scatter = getRandomScatter();
        // Store original transform to restore after popping
        el.dataset.origTransform = `translate(${scatter.x}px, ${scatter.y}px) rotate(${scatter.rot}deg)`;
        el.style.transform = el.dataset.origTransform;
        
        // Assign an initial image
        const initialImg = allPhotos[i % allPhotos.length];
        el.style.setProperty('--bg-img', initialImg);
        
        center.appendChild(el);
        domElements.push(el);
    }
    
    // Set the pointer for the next image to be shown
    allPhotosIndex = MAX_ON_SCREEN % allPhotos.length;
}

let popTimer;
let currentPopped = null;

function runPopCycle() {
    if (domElements.length === 0) return;
    
    const center = document.querySelector('.center');
    const outerCenter = document.querySelector('.outer-center');
    
    // If there is already a popped element, return it to the background
    if (currentPopped) {
        currentPopped.classList.remove('normal-filter');
        currentPopped.style.transform = currentPopped.dataset.origTransform;
        center.appendChild(currentPopped);
        currentPopped = null;
    }
    
    // Pick a random DOM element that is currently in the background
    const bgElements = domElements.filter(el => el.parentElement === center);
    if (bgElements.length === 0) return;
    
    const el = bgElements[Math.floor(Math.random() * bgElements.length)];
    
    // Update its background image to the next one in the sequence
    const nextImg = allPhotos[allPhotosIndex % allPhotos.length];
    el.style.setProperty('--bg-img', nextImg);
    allPhotosIndex++;
    
    // Pop it to the foreground
    outerCenter.appendChild(el);
    el.classList.add('normal-filter');
    
    // Give it a random slight rotation for the popup effect
    const popRot = (Math.random() - 0.5) * 20; // -10 to +10 degrees
    // We scale it up slightly for the popup effect based on screen size
    const scale = window.innerWidth < 600 ? 1.1 : 1.5;
    el.style.transform = `scale(${scale}) rotate(${popRot}deg)`;
    
    currentPopped = el;
}

async function init() {
    // 1. Initial fetch
    await fetchLatestPhotos();
    
    // 2. Create the 20 DOM elements
    createDomElements();
    
    // 3. Start the pop cycle (every 3 seconds)
    popTimer = setInterval(runPopCycle, POP_INTERVAL);
    
    // 4. Start polling for new images every 10 seconds
    setInterval(fetchLatestPhotos, POLL_INTERVAL);
}

// Re-scatter if window is resized significantly
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
