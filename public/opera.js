import * as THREE from 'three';
import { RoomEnvironment } from '/vendor/three-addons/environments/RoomEnvironment.js';
import { createOperaProps } from '/opera-props.js?v=3';
import { createOperaAtmosphere } from '/opera-atmosphere.js?v=2';
import { fetchOperaPool, pickOperaWinner } from '/opera-lottery.js?v=2';

const $ = selector => document.querySelector(selector);
const stage = $('#operaStage');
const lobby = stage;
const status = $('#operaStatus');
const panel = $('#winnerPanel');
const image = $('#winnerImage');
const video = $('#winnerVideo');
const playButton = $('#playWinner');
const retryMedia = $('#retryMedia');
const mediaStatus = $('#mediaStatus');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const props = createOperaProps().map(prop => {
    // Keep the model's normalization transform inside the animated stage group.
    const group = new THREE.Group();
    group.add(prop.group);
    return { ...prop, group };
});
let pool = null;
let busy = false;
let activeProp = null;
let winner = null;
const previousWinners = new Map();
let previousDrawDate = '';
let lastTrigger = null;
let mediaVersion = 0;
let mediaTimer = null;
let renderer;
let scene;
let camera;
let atmosphere;
let reflectionTarget;
let sceneAvailable = false;
let previousFrame = 0;
let selectedIndex = 0;
let carouselPosition = 0;
let carouselTarget = 0;
let compact = false;
let drag = null;
let wheelTotal = 0;
let wheelLocked = false;
let wheelTimer;

const symbols = {
    fan: '<path d="M32 54 4 25Q32-5 60 25Zm0 0L12 18m20 36L22 12m10 42V9m0 45 10-42m-10 42 20-36"/>',
    umbrella: '<path d="M4 30Q32-8 60 30Z M32 10v44q0 10-9 4M32 10Q15 16 13 30m19-20q17 6 19 20"/>',
    chain: '<ellipse cx="23" cy="21" rx="10" ry="15" transform="rotate(30 23 21)"/><ellipse cx="39" cy="43" rx="10" ry="15" transform="rotate(30 39 43)"/><path d="m25 27 12 12"/>',
    grid: '<rect x="8" y="8" width="48" height="48" rx="2"/><path d="M24 8v48M40 8v48M8 24h48M8 40h48"/>'
};

const buttons = props.map(prop => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'prop-control';
    button.innerHTML = `<svg viewBox="0 0 64 64" aria-hidden="true">${symbols[prop.id]}</svg>`;
    button.setAttribute('aria-label', `選擇${prop.name}抽獎`);
    button.disabled = true;
    button.addEventListener('click', () => void draw(prop, button));
    button.addEventListener('focus', () => { selectProp(props.indexOf(prop)); activeProp = prop; });
    button.addEventListener('blur', () => { activeProp = null; });
    $('#propControls').appendChild(button);
    prop.button = button;
    return button;
});

function setBusy(value) {
    busy = value;
    stage.setAttribute('aria-busy', String(value));
    buttons.forEach(button => { button.disabled = value || !pool; });
    $('#refreshPool').disabled = value;
    $('#stageFeedback').hidden = !value;
}

function updatePoolInfo() {
    if (pool.date !== previousDrawDate) {
        previousWinners.clear();
        previousDrawDate = pool.date;
    }
    $('#refreshPool').hidden = pool.entries.length > 0;
}

function emptyMessage() {
    return pool.videoEnabled
        ? '今日尚無可抽獎影片，待影片完成後重新整理名單。'
        : '今日尚無可抽獎照片，拍照完成後重新整理名單。';
}

async function refreshPool() {
    if (busy) return;
    setBusy(true);
    status.textContent = '正在更新今日名單…';
    try {
        pool = await fetchOperaPool();
        updatePoolInfo();
        status.textContent = pool.entries.length ? '左右切換道具，點選抽獎。' : emptyMessage();
    } catch (error) {
        pool = null;
        $('#refreshPool').hidden = false;
        status.textContent = error.message;
    } finally { setBusy(false); }
}

async function draw(prop, trigger) {
    if (busy || !panel.hidden) return;
    setBusy(true);
    lastTrigger = trigger || prop.button;
    selectProp(props.indexOf(prop));
    activeProp = prop;
    status.textContent = `${prop.name}・正在揭曉幸運主角…`;
    try {
        // Re-read config and today's files on every click, including after midnight.
        [pool] = await Promise.all([
            fetchOperaPool(),
            new Promise(resolve => setTimeout(resolve, reducedMotion ? 0 : 650))
        ]);
        updatePoolInfo();
        winner = pickOperaWinner(pool.entries, previousWinners.get(prop.id));
        if (!winner) {
            status.textContent = emptyMessage();
            return;
        }
        previousWinners.set(prop.id, winner);
        showWinner();
    } catch (error) {
        pool = null;
        $('#refreshPool').hidden = false;
        status.textContent = error.message;
    } finally {
        activeProp = null;
        setBusy(false);
    }
}

function clearMedia() {
    mediaVersion += 1;
    clearTimeout(mediaTimer);
    video.onloadeddata = null;
    video.onerror = null;
    video.onplaying = null;
    image.onload = null;
    image.onerror = null;
    video.pause();
    video.removeAttribute('src');
    video.removeAttribute('poster');
    video.load();
    image.removeAttribute('src');
    image.hidden = true;
    video.hidden = true;
    playButton.hidden = true;
    retryMedia.hidden = true;
}

function showWinnerPhoto(message = '') {
    clearMedia();
    const version = mediaVersion;
    image.hidden = false;
    image.setAttribute('aria-label', `${winner.name}的歌仔戲照片`);
    mediaStatus.textContent = message || '正在載入中獎照片…';
    image.onload = () => {
        if (version !== mediaVersion) return;
        clearTimeout(mediaTimer);
        retryMedia.hidden = true;
        image.hidden = false;
        mediaStatus.textContent = message;
    };
    const fail = () => {
        if (version !== mediaVersion) return;
        clearTimeout(mediaTimer);
        image.hidden = true;
        retryMedia.hidden = false;
        mediaStatus.textContent = '照片暫時無法載入，中獎結果已保留。';
    };
    image.onerror = fail;
    mediaTimer = setTimeout(fail, 15000);
    image.src = winner.url;
}

async function playWinner() {
    const version = mediaVersion;
    clearTimeout(mediaTimer);
    mediaTimer = setTimeout(() => {
        if (version === mediaVersion && !panel.hidden && !video.hidden) {
            showWinnerPhoto('影片暫時無法播放，先顯示同一位中獎人的照片。');
        }
    }, 15000);
    try {
        video.muted = false;
        await video.play();
        if (version !== mediaVersion) return;
        playButton.hidden = true;
        mediaStatus.textContent = '';
    } catch (error) {
        if (version !== mediaVersion || panel.hidden || video.hidden) return;
        if (error.name === 'NotAllowedError' || error.name === 'AbortError') {
            clearTimeout(mediaTimer);
            mediaStatus.textContent = '點選下方按鈕播放中獎影片。';
            playButton.hidden = false;
        } else {
            showWinnerPhoto('影片暫時無法播放，先顯示同一位中獎人的照片。');
        }
    }
}

function showWinner() {
    clearMedia();
    $('#winnerName').textContent = winner.name;
    panel.hidden = false;
    lobby.inert = true;
    lobby.setAttribute('aria-hidden', 'true');
    $('#closeWinner').focus();
    status.textContent = '選擇道具，讓好運登場';
    if (!pool.videoEnabled) {
        showWinnerPhoto();
        return;
    }
    const version = mediaVersion;
    mediaStatus.textContent = '正在載入中獎影片…';
    video.hidden = false;
    video.setAttribute('aria-label', `${winner.name}的中獎影片`);
    video.poster = winner.url;
    const fallback = () => {
        if (version !== mediaVersion || panel.hidden) return;
        showWinnerPhoto('影片暫時無法播放，先顯示同一位中獎人的照片。');
    };
    video.onerror = fallback;
    video.onplaying = () => {
        if (version !== mediaVersion) return;
        clearTimeout(mediaTimer);
        mediaStatus.textContent = '';
        playButton.hidden = true;
    };
    playButton.setAttribute('aria-label', '播放中獎影片');
    video.src = winner.video;
    video.load();
    void playWinner();
}

function closeWinner() {
    clearMedia();
    panel.hidden = true;
    lobby.inert = false;
    lobby.removeAttribute('aria-hidden');
    winner = null;
    lastTrigger?.focus();
}

$('#refreshPool').addEventListener('click', () => void refreshPool());
$('#closeWinner').addEventListener('click', closeWinner);
playButton.addEventListener('click', () => void playWinner());
retryMedia.addEventListener('click', () => showWinnerPhoto());
video.addEventListener('click', () => {
    if (video.paused) void playWinner();
    else { video.pause(); playButton.hidden = false; }
});
document.addEventListener('keydown', event => {
    if (panel.hidden) {
        if (event.altKey || event.ctrlKey || event.metaKey || event.repeat || event.target.closest('button, a, input')) return;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            stepCarousel(event.key === 'ArrowLeft' ? -1 : 1);
        } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            void draw(props[selectedIndex], stage);
        }
        return;
    }
    if (event.key === 'Escape') { event.preventDefault(); closeWinner(); }
    if (event.key !== 'Tab') return;
    const focusable = [...panel.querySelectorAll('button')].filter(element => !element.hidden);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});

function useFallbackControls() {
    sceneAvailable = false;
    stage.classList.add('opera-no-webgl');
    if (renderer) { renderer.setAnimationLoop(null); renderer.domElement.hidden = true; }
    status.textContent = '立體舞台暫時無法顯示，仍可點選道具圖示抽獎。';
}

function selectProp(index) {
    const next = ((index % props.length) + props.length) % props.length;
    const delta = ((next - selectedIndex + props.length * 1.5) % props.length) - props.length / 2;
    selectedIndex = next;
    carouselTarget += delta;
    if (reducedMotion) carouselPosition = carouselTarget;
    stage.dataset.selectedProp = props[next].id;
    status.textContent = props[next].name;
}

function stepCarousel(direction) {
    if (busy || !panel.hidden) return;
    activeProp = null;
    selectProp(selectedIndex + direction);
}

function createScene() {
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x000000, .018);
    camera = new THREE.PerspectiveCamera(42, 1, .1, 80);
    renderer = new THREE.WebGLRenderer({ alpha: false, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    // Broad reflected light gives the brushed metal and polished wood depth
    // while the visible stage background stays black.
    const reflectionRoom = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(renderer);
    reflectionTarget = pmrem.fromScene(reflectionRoom, 0.04);
    scene.environment = reflectionTarget.texture;
    scene.environmentIntensity = 0.42;
    reflectionRoom.dispose();
    pmrem.dispose();
    renderer.domElement.setAttribute('aria-hidden', 'true');
    stage.prepend(renderer.domElement);
    scene.add(new THREE.HemisphereLight(0xfff2d8, 0x16100b, 1.65));
    const key = new THREE.DirectionalLight(0xffe7bc, 2.4);
    key.position.set(-3, 6, 9);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xb8c9d8, 1.25);
    rim.position.set(5, 2, 4);
    scene.add(rim);
    const spotlight = new THREE.SpotLight(0xffdea3, 32, 30, Math.PI / 5, .8, 1.5);
    spotlight.position.set(-1, 4, 8);
    spotlight.target.position.set(0, 0, 1);
    scene.add(spotlight, spotlight.target);
    props.forEach(prop => {
        const model = prop.group.children[0];
        if (prop.id === 'fan') model.rotation.z = -.28;
        const bounds = new THREE.Box3().setFromObject(prop.group);
        prop.size = bounds.getSize(new THREE.Vector3());
        const target = new THREE.Mesh(
            new THREE.BoxGeometry(prop.size.x + .08, prop.size.y + .08, Math.max(prop.size.z, .2)),
            new THREE.MeshBasicMaterial({ visible: false })
        );
        target.position.copy(bounds.getCenter(new THREE.Vector3()));
        target.userData.prop = prop;
        prop.group.add(target);
        prop.hitTarget = target;
        prop.frontScale = 1;
        scene.add(prop.group);
    });
    atmosphere = createOperaAtmosphere(scene, { reducedMotion });
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    function propAt(event) {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
        raycaster.setFromCamera(pointer, camera);
        return raycaster.intersectObjects(props.map(prop => prop.hitTarget), false)[0]?.object.userData.prop || null;
    }
    const canvas = renderer.domElement;
    canvas.addEventListener('pointerdown', event => {
        if (!event.isPrimary || event.button !== 0 || busy || !panel.hidden) return;
        stage.focus({ preventScroll: true });
        drag = { id: event.pointerId, x: event.clientX, y: event.clientY, time: performance.now(), moved: false };
        canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', event => {
        if (drag && event.pointerId === drag.id) {
            if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 8) drag.moved = true;
            canvas.style.cursor = drag.moved ? 'grabbing' : 'pointer';
            return;
        }
        if (busy) return;
        activeProp = propAt(event);
        canvas.style.cursor = activeProp ? 'pointer' : 'grab';
    });
    canvas.addEventListener('pointerup', event => {
        if (!drag || event.pointerId !== drag.id) return;
        const gesture = drag;
        drag = null;
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
        canvas.style.cursor = 'grab';
        if (busy) return;
        if (gesture.moved) {
            const dx = event.clientX - gesture.x;
            const dy = event.clientY - gesture.y;
            if (Math.abs(dx) > Math.max(28, Math.abs(dy))) stepCarousel(-Math.sign(dx));
            return;
        }
        const prop = propAt(event);
        if (prop) void draw(prop, stage);
    });
    canvas.addEventListener('pointercancel', () => { drag = null; });
    canvas.addEventListener('lostpointercapture', () => { drag = null; });
    canvas.addEventListener('pointerleave', () => { if (!drag) activeProp = null; });
    canvas.addEventListener('wheel', event => {
        event.preventDefault();
        if (busy || !panel.hidden) return;
        clearTimeout(wheelTimer);
        wheelTimer = setTimeout(() => { wheelLocked = false; wheelTotal = 0; }, 180);
        if (wheelLocked) return;
        const raw = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
        wheelTotal += raw * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1);
        if (Math.abs(wheelTotal) >= 40) {
            stepCarousel(Math.sign(wheelTotal));
            wheelLocked = true;
        }
    }, { passive: false });
    canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); useFallbackControls(); });
    sceneAvailable = true;
    resize();
    renderer.setAnimationLoop(render);
}

function resize() {
    if (!sceneAvailable) return;
    const width = Math.max(1, stage.clientWidth);
    const height = Math.max(1, stage.clientHeight);
    compact = width < 720;
    camera.fov = compact ? 54 : 42;
    camera.aspect = width / height;
    camera.position.set(0, .65, compact ? 14.25 : 11.6);
    camera.lookAt(0, 0, -.3);
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    const visibleHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * (camera.position.z - .8);
    const visibleWidth = visibleHeight * camera.aspect;
    props.forEach(prop => {
        prop.frontScale = Math.min(visibleWidth * .88 / prop.size.x, visibleHeight * .83 / prop.size.y);
    });
    layoutProps(performance.now(), 1, true);
    renderer.render(scene, camera);
}

function layoutProps(now, dt, snap = false) {
    carouselPosition = reducedMotion || snap ? carouselTarget : THREE.MathUtils.damp(carouselPosition, carouselTarget, 6.5, dt);
    const rearWidth = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * (camera.position.z + 2.5) * camera.aspect;
    const radiusX = Math.min(8.2, rearWidth * .4);
    props.forEach((prop, index) => {
        // A closed, tilted X/Z orbit: all transforms stay continuous where
        // the wrapped index crosses the back of the circle.
        const count = props.length;
        const relative = ((index - carouselPosition + count * 1.5) % count + count) % count - count / 2;
        const angle = relative * Math.PI * 2 / count;
        const depth = (1 - Math.cos(angle)) / 2;
        const prominence = Math.pow(1 - depth, 6);
        const backScale = compact ? .48 : .64;
        const targetScale = THREE.MathUtils.lerp(backScale, prop.frontScale, prominence) * (activeProp === prop ? 1.025 : 1);
        const float = reducedMotion ? 0 : Math.sin(now * .00055 + index * 1.7) * .035;
        const x = Math.sin(angle) * radiusX;
        const y = .15 - depth * 5.15 + float;
        const z = .8 - depth * 6.6;
        const damp = (from, to) => reducedMotion || snap ? to : THREE.MathUtils.damp(from, to, 9, dt);
        prop.group.position.set(damp(prop.group.position.x, x), damp(prop.group.position.y, y), damp(prop.group.position.z, z));
        prop.group.scale.setScalar(damp(prop.group.scale.x, targetScale));
        prop.group.rotation.y = damp(prop.group.rotation.y, -Math.sin(angle) * .4);
        prop.group.rotation.z = damp(prop.group.rotation.z, -Math.sin(angle) * .055);
        prop.button.setAttribute('aria-current', String(index === selectedIndex));
    });
}

function render(now) {
    if (!sceneAvailable) return;
    const dt = Math.min((now - previousFrame) / 1000 || 0, .05);
    previousFrame = now;
    if (document.hidden || !panel.hidden) return;
    layoutProps(now, dt);
    atmosphere?.update(now / 1000, dt);
    renderer.render(scene, camera);
}

try { createScene(); } catch (error) { console.warn('歌仔戲立體舞台無法啟動', error); useFallbackControls(); }
stage.dataset.selectedProp = props[selectedIndex].id;
window.addEventListener('resize', resize, { passive: true });
window.addEventListener('pagehide', event => {
    video.pause();
    if (event.persisted) return;
    clearMedia();
    clearTimeout(wheelTimer);
    renderer?.setAnimationLoop(null);
    atmosphere?.dispose();
    const geometries = new Set();
    const materials = new Set();
    const textures = new Set();
    scene?.traverse(object => {
        if (object.geometry) geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
            if (!material) continue;
            materials.add(material);
            for (const value of Object.values(material)) {
                if (value?.isTexture) textures.add(value);
            }
        }
    });
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
    textures.forEach(texture => texture.dispose());
    reflectionTarget?.dispose();
    renderer?.dispose();
}, { once: true });
void refreshPool();
