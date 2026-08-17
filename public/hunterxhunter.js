import * as THREE from "three";
import { OrbitControls } from "/vendor/three-addons/controls/OrbitControls.js";
import { createExperiencePlayback, primeVideoFrame } from "/experience-playback.js?v=5";
import { createWinnerNameLabel, getPhotoCandidateEntries, pickRandomPhotoEntry } from "/lottery-photos.js?v=3";
import {
    isCenturyDisplay,
    isCompactDisplay,
    preserveDisplayModeLinks,
    updateDisplayFrame
} from "/display-mode.js?v=2";

const stage = document.querySelector("#magicStage");
const initialDisplay = updateDisplayFrame();
preserveDisplayModeLinks();
const winnerName = createWinnerNameLabel(stage);
const video = document.getElementById("sourceVideo");
const soundtrack = document.getElementById("soundtrack");
soundtrack.volume = 0.9;
const entryPlayback = createExperiencePlayback(video, { volume: 0.9, companions: [soundtrack], container: stage });

// ----------------------------------------------------
// Three.js 核心組件與場景建立
// ----------------------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050508);
scene.fog = new THREE.FogExp2(0x050508, 0.015);

const camera = new THREE.PerspectiveCamera(43, initialDisplay.aspect, 0.1, 120);
camera.position.set(0, 0, 12);

const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "high-performance"
});
renderer.setPixelRatio(isCenturyDisplay ? 1 : Math.min(window.devicePixelRatio || 1, isCompactDisplay() ? 1.25 : 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
renderer.setSize(initialDisplay.width, initialDisplay.height);
stage.appendChild(renderer.domElement);

// OrbitControls 設定
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.enableRotate = false;
controls.enableZoom = false;
controls.enablePan = false;
controls.minDistance = 6;
controls.maxDistance = 20;
controls.target.set(0, 0, 0);

// 光照系統 (質質感金屬與明亮舞台燈光)
scene.add(new THREE.HemisphereLight(0xffffff, 0x0a0a14, 2.2));

const mainLight = new THREE.DirectionalLight(0xffffff, 3.2);
mainLight.position.set(6, 10, 12);
scene.add(mainLight);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
scene.add(ambientLight);

const rimLight = new THREE.PointLight(0xff3333, 12, 25, 2);
rimLight.position.set(-6, 4, 5);
scene.add(rimLight);

const goldLight = new THREE.PointLight(0xffcc00, 10, 25, 2);
goldLight.position.set(6, -4, 4);
scene.add(goldLight);

// ----------------------------------------------------
// 3D 鎖鏈 (Chains) 生成與動畫系統
// ----------------------------------------------------
const chainMaterial = new THREE.MeshStandardMaterial({
    color: 0xd0d8e5,
    metalness: 0.9,
    roughness: 0.22,
    envMapIntensity: 1.5
});

const backgroundChainMaterial = new THREE.MeshStandardMaterial({
    color: 0x7f8796,
    metalness: 0.88,
    roughness: 0.32,
    transparent: true,
    opacity: 0.68,
    depthWrite: true
});

// 單一鎖鏈環幾何體 (橢圓鏈環)
function createSingleLinkGeometry() {
    const geom = new THREE.TorusGeometry(0.26, 0.07, 14, 28);
    geom.scale(1.4, 1.0, 1.0);
    return geom;
}

const singleLinkGeom = createSingleLinkGeometry();

// 建立一條長鎖鏈 (InstancedMesh)
function createChainLine(linkCount, material = chainMaterial) {
    const instancedMesh = new THREE.InstancedMesh(singleLinkGeom, material, linkCount);
    instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // 實例每幀都會從畫面外移入；避免沿用第一幀的包圍球而被錯誤裁掉。
    instancedMesh.frustumCulled = false;
    return instancedMesh;
}

const ambientChains = [];
const coveringChains = [];
const winnerBackgroundChains = [];
const ambientDummy = new THREE.Object3D();
const coveringDummy = new THREE.Object3D();
const winnerBackgroundDummy = new THREE.Object3D();

const AMBIENT_LINK_SPACING = 0.48;
const COVERING_CHAIN_COUNT = 64;
const COVERING_LINK_SPACING = 0.43;
const WINNER_BACKGROUND_CHAIN_COUNT = 15;
const WINNER_BACKGROUND_LINK_SPACING = 0.48;

// 計算畫面上可見寬度與高度
function getVisibleSizeAtDepth(depth = 0) {
    const distance = camera.position.z - depth;
    const vFOV = THREE.MathUtils.degToRad(camera.fov);
    const visibleHeight = 2 * Math.tan(vFOV / 2) * distance;
    const visibleWidth = visibleHeight * camera.aspect;
    return { width: visibleWidth, height: visibleHeight };
}

function clamp01(value) {
    return Math.min(Math.max(value, 0), 1);
}

function smoothstep(value) {
    const t = clamp01(value);
    return t * t * (3 - 2 * t);
}

function getEdgeMetrics(chain) {
    const { width, height } = getVisibleSizeAtDepth(1.8);
    const horizontal = chain.side === 0 || chain.side === 2;
    const lanePadding = 0.34 + chain.laneIndex * 0.24;
    // 延伸到可視範圍外一點，確保每一條鏈都完整填滿整個邊。
    const halfSpan = Math.max(1.1, (horizontal ? width : height) * 0.5 + 0.18);
    const edgeCoordinate = (horizontal ? height : width) * 0.5 - lanePadding;
    return { horizontal, halfSpan, edgeCoordinate };
}

// 四個邊彼此獨立，各自隨機生成 1～4 條，不再組成繞場一圈的固定框。
function initAmbientChains() {
    for (let side = 0; side < 4; side++) {
        const countOnSide = 1 + Math.floor(Math.random() * 4);

        for (let laneIndex = 0; laneIndex < countOnSide; laneIndex++) {
            const chain = {
                side,
                laneIndex,
                seed: Math.random() * Math.PI * 2,
                speed: 0.75 + Math.random() * 0.45
            };
            const { halfSpan } = getEdgeMetrics(chain);
            const linkCount = Math.max(5, Math.ceil((halfSpan * 2) / AMBIENT_LINK_SPACING) + 1);
            const instancedMesh = createChainLine(linkCount);
            instancedMesh.renderOrder = 4 + side * 4 + laneIndex;
            scene.add(instancedMesh);

            ambientChains.push({ ...chain, instancedMesh, linkCount });
        }
    }
}

function randomBoundaryPoint(side, spread = 0.54) {
    const along = (Math.random() - 0.5) * spread * 2;
    if (side === 0) return new THREE.Vector3(along, 0.62, 0); // 上
    if (side === 1) return new THREE.Vector3(0.62, along, 0); // 右
    if (side === 2) return new THREE.Vector3(along, -0.62, 0); // 下
    return new THREE.Vector3(-0.62, along, 0);                // 左
}

function normalizedToStage(point, width, height, z) {
    return new THREE.Vector3(point.x * width, point.y * height, z);
}

// 結尾鎖鏈由四邊輪流進場，每條都有自己的彎曲路徑與退場方向。
function initCoveringChains() {
    const { width, height } = getVisibleSizeAtDepth(2.2);

    for (let i = 0; i < COVERING_CHAIN_COUNT; i++) {
        const startSide = i % 4;
        const sideOffset = Math.random() < 0.72 ? 2 : (Math.random() < 0.5 ? 1 : 3);
        const endSide = (startSide + sideOffset) % 4;
        const startNormalized = randomBoundaryPoint(startSide);
        const endNormalized = randomBoundaryPoint(endSide);
        const bend = 0.12 + Math.random() * 0.24;
        const bendAngle = Math.random() * Math.PI * 2;
        const bendVector = new THREE.Vector3(Math.cos(bendAngle) * bend, Math.sin(bendAngle) * bend, 0);
        const controlA = startNormalized.clone().lerp(endNormalized, 0.33).add(bendVector);
        const controlB = startNormalized.clone().lerp(endNormalized, 0.68).addScaledVector(bendVector, -0.8);
        const z = 1.55 + Math.random() * 2.1;
        const curve = new THREE.CatmullRomCurve3([
            normalizedToStage(startNormalized, width, height, z),
            normalizedToStage(controlA, width, height, z + (Math.random() - 0.5) * 0.8),
            normalizedToStage(controlB, width, height, z + (Math.random() - 0.5) * 0.8),
            normalizedToStage(endNormalized, width, height, z)
        ], false, "centripetal", 0.5);

        const linkCount = Math.ceil(curve.getLength() / COVERING_LINK_SPACING) + 3;
        const instancedMesh = createChainLine(linkCount);
        instancedMesh.visible = false;
        instancedMesh.renderOrder = 20 + i;
        scene.add(instancedMesh);

        coveringChains.push({
            instancedMesh,
            linkCount,
            curve,
            delay: Math.random() * 0.14,
            exitDelay: Math.random() * 0.22,
            exitAngle: Math.atan2(startNormalized.y + endNormalized.y, startNormalized.x + endNormalized.x)
                + (Math.random() - 0.5) * 1.2,
            seed: Math.random() * Math.PI * 2
        });
    }
}

// 人物揭曉後使用的隨機背景鏈，固定鏈環數量並放在人物卡後方。
function initWinnerBackgroundChains() {
    const { width, height } = getVisibleSizeAtDepth(0.8);

    for (let i = 0; i < WINNER_BACKGROUND_CHAIN_COUNT; i++) {
        const startSide = i % 4;
        const endSide = (startSide + 1 + Math.floor(Math.random() * 3)) % 4;
        const startNormalized = randomBoundaryPoint(startSide, 0.58);
        const endNormalized = randomBoundaryPoint(endSide, 0.58);
        const bendAngle = Math.random() * Math.PI * 2;
        const bendAmount = 0.08 + Math.random() * 0.2;
        const bend = new THREE.Vector3(
            Math.cos(bendAngle) * bendAmount,
            Math.sin(bendAngle) * bendAmount,
            0
        );
        const z = 0.35 + Math.random() * 0.85;
        const curve = new THREE.CatmullRomCurve3([
            normalizedToStage(startNormalized, width, height, z),
            normalizedToStage(startNormalized.clone().lerp(endNormalized, 0.34).add(bend), width, height, z),
            normalizedToStage(startNormalized.clone().lerp(endNormalized, 0.68).addScaledVector(bend, -0.75), width, height, z),
            normalizedToStage(endNormalized, width, height, z)
        ], false, "centripetal", 0.5);
        const linkCount = Math.ceil(curve.getLength() / WINNER_BACKGROUND_LINK_SPACING) + 2;
        const instancedMesh = createChainLine(linkCount, backgroundChainMaterial);
        instancedMesh.visible = false;
        instancedMesh.renderOrder = 2 + i;
        scene.add(instancedMesh);

        winnerBackgroundChains.push({
            instancedMesh,
            linkCount,
            curve,
            seed: Math.random() * Math.PI * 2,
            scale: 0.78 + Math.random() * 0.22
        });
    }
}

// 每條鏈只沿著自己的單一邊活動，端點不轉彎、不與相鄰邊連接。
function updateAmbientChains(time) {
    ambientChains.forEach((chain) => {
        const metrics = getEdgeMetrics(chain);
        const tangentAngle = [0, -Math.PI / 2, Math.PI, Math.PI / 2][chain.side];
        const inwardX = chain.side === 1 ? -1 : chain.side === 3 ? 1 : 0;
        const inwardY = chain.side === 0 ? -1 : chain.side === 2 ? 1 : 0;

        for (let i = 0; i < chain.linkCount; i++) {
            const progress = chain.linkCount <= 1 ? 0 : i / (chain.linkCount - 1);
            const endpointEnvelope = Math.sin(progress * Math.PI);
            const longitudinalDrift = Math.sin(time * chain.speed + i * 0.22 + chain.seed) * 0.055 * endpointEnvelope;
            const along = THREE.MathUtils.lerp(-metrics.halfSpan, metrics.halfSpan, progress) + longitudinalDrift;
            const wave = (
                Math.sin(i * 0.5 + time * (1.05 + chain.laneIndex * 0.13) + chain.seed) * 0.075
                + Math.sin(i * 0.16 - time * 0.55 + chain.side) * 0.04
            ) * (0.35 + endpointEnvelope * 0.65);

            let x;
            let y;
            if (chain.side === 0) {
                x = along;
                y = metrics.edgeCoordinate;
            } else if (chain.side === 1) {
                x = metrics.edgeCoordinate;
                y = -along;
            } else if (chain.side === 2) {
                x = -along;
                y = -metrics.edgeCoordinate;
            } else {
                x = -metrics.edgeCoordinate;
                y = along;
            }

            ambientDummy.position.set(
                x + inwardX * wave,
                y + inwardY * wave,
                1.58 + chain.laneIndex * 0.2 + Math.sin(i * 0.31 + time * 1.25 + chain.seed) * 0.18
            );
            ambientDummy.rotation.set(0, 0, tangentAngle);
            ambientDummy.rotateX((i + chain.laneIndex) % 2 === 0 ? 0 : Math.PI / 2);
            ambientDummy.rotateY(Math.sin(time * 1.35 + i * 0.19 + chain.side) * 0.13);
            ambientDummy.scale.setScalar(0.94 + Math.sin(i * 0.21 + time + chain.laneIndex) * 0.04);
            ambientDummy.updateMatrix();
            chain.instancedMesh.setMatrixAt(i, ambientDummy.matrix);
        }
        chain.instancedMesh.instanceMatrix.needsUpdate = true;
    });
}

// 四面八方的曲線鎖鏈先覆蓋全畫面，再分批向外甩開退去。
function updateCoveringChains(coverProgress, retreatProgress, time) {
    coveringChains.forEach((chainObj, index) => {
        if ((coverProgress <= 0.001 && retreatProgress <= 0.001) || retreatProgress >= 0.999) {
            chainObj.instancedMesh.visible = false;
            return;
        }

        const activeCover = clamp01((coverProgress - chainObj.delay) / (1 - chainObj.delay));
        const localRetreat = smoothstep((retreatProgress - chainObj.exitDelay) / (1 - chainObj.exitDelay));
        const fadeScale = Math.max(0.001, Math.pow(1 - localRetreat, 0.72));
        const visibleLinks = Math.ceil(chainObj.linkCount * activeCover);
        const exitDistance = localRetreat * 12;
        const exitX = Math.cos(chainObj.exitAngle) * exitDistance;
        const exitY = Math.sin(chainObj.exitAngle) * exitDistance;

        chainObj.instancedMesh.visible = activeCover > 0.001 && fadeScale > 0.001;

        for (let i = 0; i < chainObj.linkCount; i++) {
            if (i >= visibleLinks || fadeScale <= 0.001) {
                coveringDummy.scale.setScalar(0.001);
                coveringDummy.updateMatrix();
                chainObj.instancedMesh.setMatrixAt(i, coveringDummy.matrix);
                continue;
            }

            const t = chainObj.linkCount <= 1 ? 0 : i / (chainObj.linkCount - 1);
            const point = chainObj.curve.getPointAt(t);
            const tangent = chainObj.curve.getTangentAt(t);
            const wave = Math.sin(time * 3.2 + i * 0.28 + chainObj.seed) * 0.12;
            point.x += exitX - tangent.y * wave;
            point.y += exitY + tangent.x * wave;
            point.z += localRetreat * 4.5 + Math.cos(time * 2.1 + i * 0.17 + index) * 0.08;

            coveringDummy.position.copy(point);
            coveringDummy.rotation.set(0, 0, Math.atan2(tangent.y, tangent.x));
            coveringDummy.rotateX((i + index) % 2 === 0 ? 0 : Math.PI / 2);
            coveringDummy.rotateY(Math.sin(time * 1.5 + i * 0.12 + index) * 0.13);
            coveringDummy.scale.setScalar(fadeScale);
            coveringDummy.updateMatrix();
            chainObj.instancedMesh.setMatrixAt(i, coveringDummy.matrix);
        }
        chainObj.instancedMesh.instanceMatrix.needsUpdate = true;
    });
}

function updateWinnerBackgroundChains(time, revealProgress) {
    const revealScale = smoothstep(revealProgress);

    winnerBackgroundChains.forEach((chain, chainIndex) => {
        if (revealScale <= 0.001) {
            chain.instancedMesh.visible = false;
            return;
        }

        chain.instancedMesh.visible = true;
        for (let i = 0; i < chain.linkCount; i++) {
            const progress = chain.linkCount <= 1 ? 0 : i / (chain.linkCount - 1);
            const point = chain.curve.getPointAt(progress);
            const tangent = chain.curve.getTangentAt(progress);
            const wave = Math.sin(i * 0.32 + time * 0.72 + chain.seed) * 0.075;
            point.x -= tangent.y * wave;
            point.y += tangent.x * wave;
            point.z += Math.sin(time * 0.58 + i * 0.18 + chainIndex) * 0.035;

            winnerBackgroundDummy.position.copy(point);
            winnerBackgroundDummy.rotation.set(0, 0, Math.atan2(tangent.y, tangent.x));
            winnerBackgroundDummy.rotateX((i + chainIndex) % 2 === 0 ? 0 : Math.PI / 2);
            winnerBackgroundDummy.rotateY(Math.sin(time * 0.7 + i * 0.13 + chain.seed) * 0.1);
            winnerBackgroundDummy.scale.setScalar(
                Math.max(0.001, revealScale * chain.scale * (0.96 + Math.sin(time + i * 0.2) * 0.04))
            );
            winnerBackgroundDummy.updateMatrix();
            chain.instancedMesh.setMatrixAt(i, winnerBackgroundDummy.matrix);
        }
        chain.instancedMesh.instanceMatrix.needsUpdate = true;
    });
}

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
// 影片與 Winner Card 管理
// ----------------------------------------------------
let videoPlane = null;
let winnerMesh = null;
let state = "playing"; // playing -> covering -> retreating -> winner
let startTime = 0;
let videoFinishedTime = null;
let winnerRevealTime = null;
let sequenceId = 0;
let sequenceReady = false;
let previewOnly = false;
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
        winnerMesh.geometry.dispose();
        winnerMesh = null;
    }

    const texture = new THREE.CanvasTexture(img);
    texture.colorSpace = THREE.SRGBColorSpace;

    const imgAspect = img.width / img.height || 1;
    const cardHeight = 4.8;
    const cardWidth = cardHeight * imgAspect;

    const geometry = new THREE.PlaneGeometry(cardWidth, cardHeight);
    
    const material = new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.25,
        metalness: 0.1,
        side: THREE.DoubleSide
    });

    winnerMesh = new THREE.Mesh(geometry, material);
    winnerMesh.position.set(0, 0, 1.8);
    winnerMesh.scale.setScalar(0.01);
    winnerMesh.visible = false;
    scene.add(winnerMesh);
}

// 隨機選擇獲勝人物
async function pickRandomWinner() {
    const candidates = await getPhotoCandidateEntries();
    const randomPhoto = pickRandomPhotoEntry(candidates);
    if (!randomPhoto) {
        previewOnly = true;
        stage.classList.add("has-lottery-error");
        stage.dataset.error = "今天尚未有可抽獎的照片";
        return false;
    }
    try {
        winnerName.set(randomPhoto.name);
        winnerImage = await loadImage(randomPhoto.url);
        createWinnerCard(winnerImage);
        previewOnly = false;
        return true;
    } catch (e) {
        console.error("Failed to load winner image:", e);
        stage.classList.add("has-lottery-error");
        stage.dataset.error = "今日照片載入失敗，請重新整理頁面";
        return false;
    }
}

async function playPreviewFromBeginning() {
    if (!previewOnly) return;
    sequenceReady = false;
    state = "blocked";
    videoFinishedTime = null;
    winnerRevealTime = null;
    video.pause();
    soundtrack.pause();
    video.currentTime = 0;
    soundtrack.currentTime = 0;
    try {
        await entryPlayback.play({ sound: true });
    } catch {
        // Keep the first frame visible when the browser blocks playback.
    }
}

// 啟動抽卡流程
async function startMagicExperience({ sound = false } = {}) {
    const currentSequenceId = ++sequenceId;
    state = "playing";
    sequenceReady = false;
    videoFinishedTime = null;
    winnerRevealTime = null;
    winnerName.hide();
    video.pause();
    video.currentTime = 0;

    updateCoveringChains(0, 0, 0);
    updateWinnerBackgroundChains(0, 0);
    ambientChains.forEach(({ instancedMesh }) => {
        instancedMesh.visible = true;
    });

    if (winnerMesh) {
        winnerMesh.visible = false;
        winnerMesh.scale.setScalar(0.01);
    }

    if (videoPlane) {
        videoPlane.visible = true;
    }

    if (!await pickRandomWinner()) {
        state = "blocked";
        await primeVideoFrame(video);
        return;
    }
    if (currentSequenceId !== sequenceId) return;

    startTime = performance.now() / 1000;
    sequenceReady = true;
    entryPlayback.play({ sound }).catch(err => console.log("Video play error:", err));
}

// ----------------------------------------------------
// 主循環與時間軸 (Animation Loop & Timeline)
// ----------------------------------------------------
function animate() {
    requestAnimationFrame(animate);

    const now = performance.now() / 1000;
    const elapsed = now - startTime;

    // 四邊各自 1～4 條有機鎖鏈持續獨立飄動
    updateAmbientChains(now);

    if (!sequenceReady) {
        updateCoveringChains(0, 0, now);
        updateWinnerBackgroundChains(now, 0);
        controls.update();
        renderer.render(scene, camera);
        return;
    }

    // 時間軸控制
    const duration = video.duration && !isNaN(video.duration) ? video.duration : 8.5;
    const playhead = video.ended
        ? duration
        : Math.min(duration, Math.max(video.currentTime || 0, video.paused ? elapsed : 0));
    const COVER_START_TIME = Math.max(0, duration - 0.8);
    const FULL_COVER_TIME = Math.max(COVER_START_TIME + 0.45, duration - 0.03);
    const HOLD_AFTER_VIDEO = 0.26;
    const RETREAT_DURATION = 2.45;
    const WINNER_REVEAL_POINT = 0.4;

    if (videoFinishedTime === null && (video.ended || playhead >= duration - 0.04)) {
        videoFinishedTime = now;
    }
    const afterVideo = videoFinishedTime === null ? 0 : now - videoFinishedTime;

    if (playhead < COVER_START_TIME) {
        // 播放中：四邊獨立鎖鏈自然活動，中央保持乾淨。
        state = "playing";
        updateCoveringChains(0, 0, now);

    } else if (playhead < FULL_COVER_TIME) {
        // 影片即將結束：四面八方亂數鎖鏈纏繞住整個畫面
        state = "covering";
        const progress = (playhead - COVER_START_TIME) / (FULL_COVER_TIME - COVER_START_TIME);
        const easedProgress = Math.sin(clamp01(progress) * Math.PI / 2);
        updateCoveringChains(easedProgress, 0, now);

    } else if (videoFinishedTime === null || afterVideo < HOLD_AFTER_VIDEO) {
        // 影片最後一刻維持滿版鎖鏈，只先藏起影片，人物仍保持隱藏。
        state = "covering";
        updateCoveringChains(1.0, 0, now);

        if (videoPlane && videoPlane.visible) {
            videoPlane.visible = false;
        }

    } else if (afterVideo < HOLD_AFTER_VIDEO + RETREAT_DURATION) {
        // 鎖鏈分批向四面退去；退到中段才真正彈出抽中的人物。
        state = "retreating";
        const retreatProgress = clamp01((afterVideo - HOLD_AFTER_VIDEO) / RETREAT_DURATION);
        const easedRetreat = smoothstep(retreatProgress);
        updateCoveringChains(1.0, easedRetreat, now);

        if (retreatProgress >= WINNER_REVEAL_POINT && winnerMesh && !winnerMesh.visible) {
            winnerMesh.visible = true;
            winnerRevealTime = now;
            winnerName.show();
        }

    } else {
        // 退去結束：覆蓋鏈退場，改由人物後方的隨機背景鏈接手。
        state = "winner";
        updateCoveringChains(0, 1.0, now);

        if (winnerMesh && !winnerMesh.visible) {
            winnerMesh.visible = true;
            winnerRevealTime = now;
            winnerName.show();
        }

    }

    // 彈出抽到的人物卡片與 3D 浮動動畫
    if (winnerMesh && winnerMesh.visible) {
        const revealElapsed = Math.max(0, now - (winnerRevealTime ?? now));
        const popScale = 1 - Math.exp(-6.2 * revealElapsed) * Math.cos(10.5 * revealElapsed);
        winnerMesh.scale.setScalar(Math.max(0.01, Math.min(popScale, 1.12)));
        winnerMesh.position.y = Math.sin(now * 1.6) * 0.08 - Math.exp(-5 * revealElapsed) * 0.34;
        winnerMesh.rotation.y = Math.sin(now * 0.9) * 0.06;
        winnerMesh.rotation.x = Math.cos(now * 0.6) * 0.03;
    }

    const winnerIsVisible = Boolean(winnerMesh && winnerMesh.visible);
    ambientChains.forEach(({ instancedMesh }) => {
        instancedMesh.visible = !winnerIsVisible;
    });
    const backgroundRevealProgress = winnerIsVisible
        ? clamp01((now - (winnerRevealTime ?? now)) / 0.9)
        : 0;
    updateWinnerBackgroundChains(now, backgroundRevealProgress);

    controls.update();
    renderer.render(scene, camera);
}

// ----------------------------------------------------
// 視窗調整與初始化
// ----------------------------------------------------
function onWindowResize() {
    const display = updateDisplayFrame();
    camera.aspect = display.aspect;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(isCenturyDisplay ? 1 : Math.min(window.devicePixelRatio || 1, isCompactDisplay() ? 1.25 : 1.5));
    renderer.setSize(display.width, display.height);

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

    ambientChains.forEach(({ instancedMesh }) => scene.remove(instancedMesh));
    coveringChains.forEach(({ instancedMesh }) => scene.remove(instancedMesh));
    winnerBackgroundChains.forEach(({ instancedMesh }) => scene.remove(instancedMesh));
    ambientChains.length = 0;
    coveringChains.length = 0;
    winnerBackgroundChains.length = 0;
    initAmbientChains();
    initCoveringChains();
    initWinnerBackgroundChains();
}

window.addEventListener("resize", onWindowResize);
stage.addEventListener("click", () => {
    if (state !== "blocked") return;
    if (previewOnly) void playPreviewFromBeginning();
    else void startMagicExperience({ sound: true });
});

// 初始化入口
async function init() {
    initAmbientChains();
    initCoveringChains();
    initWinnerBackgroundChains();

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
