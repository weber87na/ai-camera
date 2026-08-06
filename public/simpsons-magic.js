import * as THREE from "three";
import { OrbitControls } from "/vendor/three-addons/controls/OrbitControls.js";

// 人物畫廊候選圖庫
const REFERENCE_IMAGES = Array.from({ length: 10 }, (_, index) => {
    const number = String(index + 1).padStart(2, "0");
    return `/images/style-${number}.webp`;
});

const stage = document.querySelector("#magicStage");
const replayBtn = document.querySelector("#replayBtn");
const video = document.getElementById("sourceVideo");

// Three.js 核心組件
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x02030a);
scene.fog = new THREE.FogExp2(0x02030a, 0.015);

const camera = new THREE.PerspectiveCamera(43, window.innerWidth / window.innerHeight, 0.1, 120);
camera.position.set(0, 0, 12);

const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "high-performance"
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth < 700 ? 1.25 : 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.setSize(window.innerWidth, window.innerHeight);
stage.appendChild(renderer.domElement);

// OrbitControls 設定
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.rotateSpeed = 0.5;
controls.zoomSpeed = 0.7;
controls.enablePan = false;
controls.minDistance = 6;
controls.maxDistance = 20;
controls.target.set(0, 0, 0);

// 光照系統
scene.add(new THREE.HemisphereLight(0xfff5dd, 0x090b16, 2.2));

const mainLight = new THREE.DirectionalLight(0xfffaed, 3.2);
mainLight.position.set(5, 8, 10);
scene.add(mainLight);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
scene.add(ambientLight);

const rimLight = new THREE.PointLight(0xffd56b, 15, 25, 2);
rimLight.position.set(-6, 4, 4);
scene.add(rimLight);

// ----------------------------------------------------
// 漸層煙霧 Texture 生成器 (Procedural Soft Smoke Texture)
// ----------------------------------------------------
function createSmokeTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");

    const gradient = ctx.createRadialGradient(128, 128, 8, 128, 128, 124);
    gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
    gradient.addColorStop(0.3, "rgba(230, 230, 230, 0.8)");
    gradient.addColorStop(0.6, "rgba(180, 180, 180, 0.4)");
    gradient.addColorStop(0.9, "rgba(100, 100, 100, 0.05)");
    gradient.addColorStop(1, "rgba(0, 0, 0, 0)");

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);

    // 不規則雲團只在初始化時生成一次，避免額外下載素材。
    for (let i = 0; i < 10; i++) {
        const rx = 128 + (Math.random() - 0.5) * 80;
        const ry = 128 + (Math.random() - 0.5) * 80;
        const radius = 30 + Math.random() * 42;
        const subGrad = ctx.createRadialGradient(rx, ry, 3, rx, ry, radius);
        subGrad.addColorStop(0, "rgba(255, 255, 255, 0.5)");
        subGrad.addColorStop(1, "rgba(200, 200, 200, 0)");
        ctx.fillStyle = subGrad;
        ctx.beginPath();
        ctx.arc(rx, ry, radius, 0, Math.PI * 2);
        ctx.fill();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
}

const smokeTexture = createSmokeTexture();

// ----------------------------------------------------
// 煙霧粒子系統 (Smoke Particle System)
// 參考 Simple-Particle-Effects 的單一 Points + point sprite 架構。
// 所有粒子共用一份 geometry/material，只需 1 draw call；移動、旋轉、
// 成長與淡入淡出均由 GPU shader 執行，避免每幀建立物件或重建 attribute。
// ----------------------------------------------------
const SMOKE_COUNT = window.innerWidth < 700 ? 42 : 72;
const smokeGeometry = new THREE.BufferGeometry();
const smokePositions = new Float32Array(SMOKE_COUNT * 3);
const smokeDrifts = new Float32Array(SMOKE_COUNT * 2);
const smokeSizes = new Float32Array(SMOKE_COUNT);
const smokeAngles = new Float32Array(SMOKE_COUNT);
const smokeSpins = new Float32Array(SMOKE_COUNT);
const smokePhases = new Float32Array(SMOKE_COUNT);
const smokeDensities = new Float32Array(SMOKE_COUNT);
const smokeColumns = Math.ceil(Math.sqrt(SMOKE_COUNT * Math.max(camera.aspect, 1)));
const smokeRows = Math.ceil(SMOKE_COUNT / smokeColumns);

for (let i = 0; i < SMOKE_COUNT; i++) {
    const column = i % smokeColumns;
    const row = Math.floor(i / smokeColumns);
    const positionOffset = i * 3;
    const driftOffset = i * 2;

    // 以帶抖動的格狀分布確保全螢幕覆蓋，所需粒子遠少於純隨機分布。
    smokePositions[positionOffset] = ((column + 0.5) / smokeColumns - 0.5) * 19 + (Math.random() - 0.5) * 1.8;
    smokePositions[positionOffset + 1] = ((row + 0.5) / smokeRows - 0.5) * 11 + (Math.random() - 0.5) * 1.4;
    smokePositions[positionOffset + 2] = -1 + Math.random() * 3.5;
    smokeDrifts[driftOffset] = (Math.random() - 0.5) * 1.5;
    smokeDrifts[driftOffset + 1] = 0.45 + Math.random() * 1.1;
    smokeSizes[i] = 3.2 + Math.random() * 2.0;
    smokeAngles[i] = Math.random() * Math.PI * 2;
    smokeSpins[i] = (Math.random() - 0.5) * 0.34;
    smokePhases[i] = Math.random();
    smokeDensities[i] = 0.72 + Math.random() * 0.28;
}

smokeGeometry.setAttribute("position", new THREE.BufferAttribute(smokePositions, 3));
smokeGeometry.setAttribute("aDrift", new THREE.BufferAttribute(smokeDrifts, 2));
smokeGeometry.setAttribute("aSize", new THREE.BufferAttribute(smokeSizes, 1));
smokeGeometry.setAttribute("aAngle", new THREE.BufferAttribute(smokeAngles, 1));
smokeGeometry.setAttribute("aSpin", new THREE.BufferAttribute(smokeSpins, 1));
smokeGeometry.setAttribute("aPhase", new THREE.BufferAttribute(smokePhases, 1));
smokeGeometry.setAttribute("aDensity", new THREE.BufferAttribute(smokeDensities, 1));

const pointSizeRange = renderer.getContext().getParameter(renderer.getContext().ALIASED_POINT_SIZE_RANGE);
const smokeUniforms = {
    uSmokeTexture: { value: smokeTexture },
    uTime: { value: 0 },
    uProgress: { value: 0 },
    uOpacity: { value: 0 },
    uExpansion: { value: 0 },
    uPointMultiplier: { value: 1 },
    uMaxPointSize: { value: Math.min(pointSizeRange[1], 900) }
};

const smokeMaterial = new THREE.ShaderMaterial({
    uniforms: smokeUniforms,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NormalBlending,
    toneMapped: false,
    vertexShader: `
        uniform float uTime;
        uniform float uProgress;
        uniform float uExpansion;
        uniform float uPointMultiplier;
        uniform float uMaxPointSize;
        attribute vec2 aDrift;
        attribute float aSize;
        attribute float aAngle;
        attribute float aSpin;
        attribute float aPhase;
        attribute float aDensity;
        varying float vAngle;
        varying float vAlpha;

        void main() {
            float delay = aPhase * 0.22;
            float localProgress = clamp((uProgress - delay) / max(0.01, 1.0 - delay), 0.0, 1.0);
            float eased = localProgress * localProgress * (3.0 - 2.0 * localProgress);
            vec3 transformed = position;
            transformed.xy += aDrift * eased * (0.65 + uExpansion * 0.85);
            transformed.x += sin(uTime * 0.34 + aPhase * 9.0) * 0.12;
            transformed.y += cos(uTime * 0.27 + aPhase * 11.0) * 0.08;

            vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
            gl_Position = projectionMatrix * mvPosition;
            float growth = mix(0.62, 1.28 + uExpansion * 0.38, eased);
            gl_PointSize = min(uMaxPointSize, aSize * growth * uPointMultiplier / max(1.0, -mvPosition.z));
            vAngle = aAngle + uTime * aSpin;
            vAlpha = smoothstep(0.0, 0.22, localProgress) * aDensity;
        }
    `,
    fragmentShader: `
        uniform sampler2D uSmokeTexture;
        uniform float uOpacity;
        varying float vAngle;
        varying float vAlpha;

        void main() {
            vec2 centered = gl_PointCoord - 0.5;
            float c = cos(vAngle);
            float s = sin(vAngle);
            vec2 uv = mat2(c, s, -s, c) * centered + 0.5;
            vec4 smoke = texture2D(uSmokeTexture, uv);
            float alpha = smoke.a * uOpacity * vAlpha;
            if (alpha < 0.008) discard;
            vec3 smokeColor = mix(vec3(0.34, 0.37, 0.42), vec3(0.88, 0.89, 0.9), smoke.r);
            gl_FragColor = vec4(smokeColor, alpha);
        }
    `
});

const smokePoints = new THREE.Points(smokeGeometry, smokeMaterial);
smokePoints.frustumCulled = false;
smokePoints.renderOrder = 20;
smokePoints.visible = false;
scene.add(smokePoints);

const smokeBufferSize = new THREE.Vector2();

function updateSmokePointMultiplier() {
    renderer.getDrawingBufferSize(smokeBufferSize);
    smokeUniforms.uPointMultiplier.value = smokeBufferSize.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)));
}

function setSmokeState(progress, opacity, expansion) {
    smokePoints.visible = opacity > 0.001;
    smokeUniforms.uProgress.value = progress;
    smokeUniforms.uOpacity.value = opacity;
    smokeUniforms.uExpansion.value = expansion;
}

updateSmokePointMultiplier();

// ----------------------------------------------------
// Helper Function: 圖片加載
// ----------------------------------------------------
function loadImage(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
    });
}

// ----------------------------------------------------
// 狀態與流程控管
// ----------------------------------------------------
let videoPlane = null;
let winnerMesh = null;
let state = "playing"; // playing -> smoking -> winner
let startTime = 0;
let winnerImage = null;

// 設置影片 Plane
function setupVideoPlane() {
    const videoTexture = new THREE.VideoTexture(video);
    videoTexture.colorSpace = THREE.SRGBColorSpace;
    
    const videoMat = new THREE.MeshBasicMaterial({
        map: videoTexture,
        side: THREE.DoubleSide
    });

    const distance = camera.position.z - 0;
    const vFOV = THREE.MathUtils.degToRad(camera.fov);
    const visibleHeight = 2 * Math.tan(vFOV / 2) * distance;
    const visibleWidth = visibleHeight * camera.aspect;

    const videoAspect = video.videoWidth / video.videoHeight || (16 / 9);

    let width, height;
    if (videoAspect > camera.aspect) {
        height = visibleHeight * 1.05;
        width = height * videoAspect;
    } else {
        width = visibleWidth * 1.05;
        height = width / videoAspect;
    }

    const geometry = new THREE.PlaneGeometry(width, height);
    videoPlane = new THREE.Mesh(geometry, videoMat);
    videoPlane.position.set(0, 0, 0);
    scene.add(videoPlane);
}

// 建立抽中人物卡片 (Winner Mesh)
function createWinnerCard(img) {
    if (winnerMesh) {
        scene.remove(winnerMesh);
        if (winnerMesh.material.map) winnerMesh.material.map.dispose();
        winnerMesh.material.dispose();
        winnerMesh = null;
    }

    const texture = new THREE.CanvasTexture(img);
    texture.colorSpace = THREE.SRGBColorSpace;

    const imgAspect = img.width / img.height || 1;
    const cardHeight = 4.8;
    const cardWidth = cardHeight * imgAspect;

    const geometry = new THREE.PlaneGeometry(cardWidth, cardHeight);
    
    // 建立帶有優雅細緻質感與光澤的相框風格卡片
    const material = new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.25,
        metalness: 0.1,
        side: THREE.DoubleSide
    });

    winnerMesh = new THREE.Mesh(geometry, material);
    winnerMesh.position.set(0, 0, 2);
    winnerMesh.scale.setScalar(0.01);
    winnerMesh.visible = false;
    scene.add(winnerMesh);
}

// 隨機選擇獲勝人物
async function pickRandomWinner() {
    const randomUrl = REFERENCE_IMAGES[Math.floor(Math.random() * REFERENCE_IMAGES.length)];
    try {
        winnerImage = await loadImage(randomUrl);
        createWinnerCard(winnerImage);
    } catch (e) {
        console.error("Failed to load winner image:", e);
    }
}

// 啟動 / 重播抽卡流程
async function startMagicExperience() {
    state = "playing";
    startTime = performance.now() / 1000;
    replayBtn.style.display = "none";

    setSmokeState(0, 0, 0);

    if (winnerMesh) {
        winnerMesh.visible = false;
        winnerMesh.scale.setScalar(0.01);
    }

    if (videoPlane) {
        videoPlane.visible = true;
    }

    await pickRandomWinner();

    video.currentTime = 0;
    video.play().catch(err => console.log("Video play error:", err));
}

// ----------------------------------------------------
// 主循環與時間軸 (Animation Loop & Timeline)
// ----------------------------------------------------
const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);

    const delta = Math.min(clock.getDelta(), 0.05);
    const now = performance.now() / 1000;
    const elapsed = now - startTime;

    // 影片時間點判斷
    // 第 4 秒時煙霧開始滾滾出現
    const SMOKE_START_TIME = 4.0;
    const SMOKE_FULL_COVERAGE_TIME = 5.2;
    const SMOKE_DISSIPATE_TIME = 7.2;

    if (elapsed >= SMOKE_START_TIME && state === "playing") {
        state = "smoking";
    }

    // 煙霧粒子與覆蓋率邏輯
    if (elapsed >= SMOKE_START_TIME) {
        let smokeProgress = 0;

        if (elapsed < SMOKE_FULL_COVERAGE_TIME) {
            // 4.0s ~ 5.2s: 煙霧湧出，opacity 逐漸達到 1.0 (覆蓋全螢幕)
            smokeProgress = (elapsed - SMOKE_START_TIME) / (SMOKE_FULL_COVERAGE_TIME - SMOKE_START_TIME);
            smokeProgress = Math.min(Math.max(smokeProgress, 0), 1);
            // Ease in
            const easedSmoke = smokeProgress * smokeProgress * (3 - 2 * smokeProgress);
            setSmokeState(smokeProgress, easedSmoke * 0.86, smokeProgress * 0.2);

        } else if (elapsed < SMOKE_DISSIPATE_TIME) {
            // 煙霧全覆蓋的時刻，隱藏影片，切換成 Winner Card！
            if (videoPlane && videoPlane.visible) {
                videoPlane.visible = false;
            }
            if (winnerMesh) {
                winnerMesh.visible = true;
                state = "winner";
            }

            // 5.2s ~ 7.2s: 煙霧散去 (fade out)，露出抽中人物
            const fadeProgress = (elapsed - SMOKE_FULL_COVERAGE_TIME) / (SMOKE_DISSIPATE_TIME - SMOKE_FULL_COVERAGE_TIME);
            const fadeOpacity = Math.max(0, 0.98 * (1 - fadeProgress));

            setSmokeState(1, fadeOpacity * 0.88, 0.2 + fadeProgress * 0.8);

        } else {
            // 7.2s 以後：煙霧完全散去
            setSmokeState(1, 0, 1);
            if (replayBtn.style.display === "none") {
                replayBtn.style.display = "flex";
            }
        }
    }

    // Winner Card 的浮動登場動畫
    if (winnerMesh && winnerMesh.visible) {
        if (winnerMesh.scale.x < 1) {
            const scaleSpeed = delta * 2.5;
            const newScale = Math.min(1, winnerMesh.scale.x + scaleSpeed);
            winnerMesh.scale.setScalar(newScale);
        }

        // 溫和的 3D 浮動與傾斜動畫
        winnerMesh.position.y = Math.sin(now * 1.5) * 0.08;
        winnerMesh.rotation.y = Math.sin(now * 0.8) * 0.06;
        winnerMesh.rotation.x = Math.cos(now * 0.6) * 0.03;
    }

    smokeUniforms.uTime.value = now;
    controls.update();
    renderer.render(scene, camera);
}

// ----------------------------------------------------
// 初始化與事件監聽
// ----------------------------------------------------
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    updateSmokePointMultiplier();

    if (videoPlane && video) {
        const distance = camera.position.z - 0;
        const vFOV = THREE.MathUtils.degToRad(camera.fov);
        const visibleHeight = 2 * Math.tan(vFOV / 2) * distance;
        const visibleWidth = visibleHeight * camera.aspect;
        const videoAspect = video.videoWidth / video.videoHeight || (16 / 9);

        let width, height;
        if (videoAspect > camera.aspect) {
            height = visibleHeight * 1.05;
            width = height * videoAspect;
        } else {
            width = visibleWidth * 1.05;
            height = width / videoAspect;
        }
        videoPlane.geometry.dispose();
        videoPlane.geometry = new THREE.PlaneGeometry(width, height);
    }
}

window.addEventListener("resize", onWindowResize);
replayBtn.addEventListener("click", () => {
    startMagicExperience();
});

// 初始化
async function init() {
    const handleVideoReady = () => {
        setupVideoPlane();
        startMagicExperience();
        animate();
    };

    if (video.readyState >= 1) {
        handleVideoReady();
    } else {
        video.addEventListener("loadedmetadata", handleVideoReady, { once: true });
    }
}

init();
