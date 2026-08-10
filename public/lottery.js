import * as THREE from "three";
import { requestExperiencePlayback } from "/experience-playback.js?v=1";

const VIDEO_SOURCES = [
    { url: "/videos/辛普森.mp4", poster: "/example-images/video-first-frame-01.jpg", route: "/simpsons-magic", label: "辛普森", code: "ROLL 01", accent: "#f0b94b", boxTexture: "/images/simpsons-packaging.png" },
    { url: "/videos/迪士尼女巫.mp4", poster: "/example-images/video-first-frame-02.jpg", route: "/disney", label: "迪士尼女巫", code: "ROLL 02", accent: "#9d68ca", boxTexture: "/images/guava-packaging.png" },
    { url: "/videos/道士.mp4", poster: "/example-images/video-first-frame-03.jpg", route: "/chinese-magic", label: "道士", code: "ROLL 03", accent: "#d76c45", boxTexture: "/images/talisman-packaging.png" },
    { url: "/videos/鎖鏈殺手.mp4", poster: "/example-images/video-first-frame-04.jpg", route: "/hunterxhunter", label: "鎖鏈殺手", code: "ROLL 04", accent: "#777b81", boxTexture: "/images/chain-packaging.png" },
    { url: "/videos/顏料吸收.mp4", poster: "/example-images/video-first-frame-05.jpg", route: "/painter", label: "顏料吸收", code: "ROLL 05", accent: "#398a83", boxTexture: "/images/paint-packaging.png" }
];

const EXAMPLE_IMAGES = Array.from({ length: 10 }, (_, index) => {
    const number = String(index + 1).padStart(2, "0");
    return `/example-images/${number}.jpg`;
});
const MIN_FILM_PHOTO_COUNT = EXAMPLE_IMAGES.length;

const ROLL_SOURCE_INDEXES = [0, 1];
const BOX_SOURCE_INDEXES = [0, 1, 2, 3, 4];
const ROLL_DIRECTIONS = [1, -1];
const ROLL_RADIAL_SCALE = 0.72;
const BOX_SCALE_MULTIPLIER = 1.25;
const BOX_ROW_MARGIN = 0.14;
const ROW_Y = [2.65, -1.05];
const NARROW_ROW_Y = [2.35, -0.25];
const BASE_RIBBON_WIDTH = 20;
const RIBBON_HEIGHT = 3.35;
const FILM_CELL_LAYOUT_WIDTH = 216;
const FILM_CELL_LAYOUT_HEIGHT = 310;
const FILM_ATLAS_SCALE = 3;
const FILM_CELL_WIDTH = FILM_CELL_LAYOUT_WIDTH * FILM_ATLAS_SCALE;
const FILM_CELL_HEIGHT = FILM_CELL_LAYOUT_HEIGHT * FILM_ATLAS_SCALE;
const FILM_FRAME_INSET_X = 8 * FILM_ATLAS_SCALE;
const FILM_FRAME_INSET_Y = 34 * FILM_ATLAS_SCALE;
const FILM_SPEED_MULTIPLIER = 2.5;
const PHOTO_POLL_INTERVAL = 15_000;
const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");

const stage = document.querySelector("#filmStage");
const lobbyMusic = document.querySelector("#lobbyMusic");
lobbyMusic.volume = 0.2;

function removeLobbyMusicUnlockListeners() {
    window.removeEventListener("pointerdown", handleLobbyMusicUnlock, true);
    window.removeEventListener("keydown", handleLobbyMusicUnlock, true);
}

async function startLobbyMusic() {
    if (document.hidden) return false;
    try {
        await lobbyMusic.play();
        removeLobbyMusicUnlockListeners();
        return true;
    } catch {
        return false;
    }
}

function handleLobbyMusicUnlock() {
    void startLobbyMusic();
}

window.addEventListener("pointerdown", handleLobbyMusicUnlock, true);
window.addEventListener("keydown", handleLobbyMusicUnlock, true);
void startLobbyMusic();

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x000000, 0.025);

const camera = new THREE.PerspectiveCamera(39, 1, 0.1, 80);
camera.position.set(0, 0.68, 18.2);
camera.lookAt(0, -0.25, 0);

const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: "high-performance"
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.domElement.setAttribute("aria-hidden", "true");
stage.appendChild(renderer.domElement);

const filmNoiseScene = new THREE.Scene();
const filmNoiseCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
filmNoiseCamera.position.z = 1;

const filmNoiseUniforms = {
    uTime: { value: 0 },
    uSeed: { value: Math.random() * 1000 },
    uBurst: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) }
};

const filmNoiseMaterial = new THREE.ShaderMaterial({
    uniforms: filmNoiseUniforms,
    vertexShader: `
        varying vec2 vUv;

        void main() {
            vUv = uv;
            gl_Position = vec4(position.xy, 0.0, 1.0);
        }
    `,
    fragmentShader: `
        precision mediump float;

        uniform float uTime;
        uniform float uSeed;
        uniform float uBurst;
        uniform vec2 uResolution;
        varying vec2 vUv;

        float hash12(vec2 value) {
            value = fract(value * vec2(123.34, 456.21));
            value += dot(value, value + 45.32);
            return fract(value.x * value.y);
        }

        void main() {
            vec2 uv = vUv;
            float frame = floor(uTime * 24.0);

            float grain = hash12(floor(uv * uResolution * 0.55) + vec2(frame, uSeed));
            grain = smoothstep(0.08, 0.92, grain);

            float thinColumns = 150.0;
            float thinColumnId = floor(uv.x * thinColumns + uSeed * 0.003);
            float thinPosition = fract(uv.x * thinColumns + uSeed * 0.003);
            float thinWidth = mix(0.025, 0.11, hash12(vec2(thinColumnId, uSeed + 13.0)));
            float thinLine = 1.0 - smoothstep(0.0, thinWidth, abs(thinPosition - 0.5));
            thinLine *= step(0.86, hash12(vec2(thinColumnId, uSeed + 3.0)));
            thinLine *= mix(0.35, 1.0, hash12(vec2(thinColumnId, frame + uSeed)));
            thinLine *= mix(
                0.6,
                1.0,
                hash12(vec2(thinColumnId + floor(uv.y * 22.0), frame + uSeed * 0.7))
            );

            float broadColumns = 18.0;
            float broadColumnId = floor(uv.x * broadColumns + uSeed * 0.0017);
            float broadPosition = fract(uv.x * broadColumns + uSeed * 0.0017);
            float broadWidth = mix(0.08, 0.26, hash12(vec2(broadColumnId, uSeed + 29.0)));
            float broadLine = 1.0 - smoothstep(0.0, broadWidth, abs(broadPosition - 0.5));
            broadLine *= step(0.76, hash12(vec2(broadColumnId, uSeed + 57.0)));
            broadLine *= smoothstep(0.25, 0.9, hash12(vec2(broadColumnId, floor(uTime * 9.0) + uSeed)));

            float scratch = clamp(thinLine + broadLine * 0.8, 0.0, 1.0);
            float darkScratch = scratch * step(
                0.91,
                hash12(vec2(floor(uv.x * 120.0), uSeed + 88.0))
            );

            float colorSeed = hash12(vec2(floor(uv.x * 32.0), uSeed + 23.0));
            vec3 warmScratch = vec3(1.0, 0.54, 0.2);
            vec3 coolScratch = vec3(0.25, 0.65, 1.0);
            vec3 scratchColor = mix(warmScratch, coolScratch, smoothstep(0.25, 0.8, colorSeed));
            scratchColor = mix(scratchColor, vec3(1.0, 0.91, 0.76), grain * 0.28);
            scratchColor = mix(scratchColor, vec3(0.03, 0.015, 0.01), darkScratch * 0.7);

            float scanline = 0.5 + 0.5 * sin(uv.y * uResolution.y * 0.16 + uTime * 11.0);
            float alpha = uBurst * (
                scratch * 0.62
                + broadLine * 0.14
                + grain * 0.055
                + scanline * grain * 0.018
            );

            gl_FragColor = vec4(scratchColor, clamp(alpha, 0.0, 0.5));
        }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false
});

const filmNoiseMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), filmNoiseMaterial);
filmNoiseScene.add(filmNoiseMesh);
renderer.autoClear = false;

scene.add(new THREE.HemisphereLight(0xffe9cd, 0x10151b, 1.38));

const keyLight = new THREE.DirectionalLight(0xffd2a4, 3.25);
keyLight.position.set(-7, 9, 12);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.camera.near = 1;
keyLight.shadow.camera.far = 40;
keyLight.shadow.camera.left = -16;
keyLight.shadow.camera.right = 16;
keyLight.shadow.camera.top = 10;
keyLight.shadow.camera.bottom = -10;
scene.add(keyLight);

const rimLight = new THREE.PointLight(0x8fc9ff, 42, 34, 2);
rimLight.position.set(10, 2.8, 7);
scene.add(rimLight);

const floorLight = new THREE.PointLight(0xe07e40, 25, 22, 2);
floorLight.position.set(-6, -5.2, 5);
scene.add(floorLight);

const sceneRoot = new THREE.Group();
scene.add(sceneRoot);

const rolls = [];
const ribbons = [];
const boxes = [];
const boxHitMeshes = [];
const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();
let dust = null;
let floor = null;
let initialized = false;
let lastFrameTime = performance.now();
let filmPhotoSignature = "";
let photoRefreshBusy = false;
let cardboardSurfaceTexture = null;
let filmNoiseNextBurstAt = performance.now() / 1000 + 3.5 + Math.random() * 4.5;
let filmNoiseBurstStartedAt = -Infinity;
let filmNoiseBurstDuration = 0;

function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
}

function lerp(start, end, amount) {
    return start + (end - start) * amount;
}

function smoothstep(edge0, edge1, value) {
    const x = clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return x * x * (3 - 2 * x);
}

function wrap01(value) {
    return ((value % 1) + 1) % 1;
}

function imageDimensions(image) {
    return {
        width: image.videoWidth || image.naturalWidth || image.width || 1,
        height: image.videoHeight || image.naturalHeight || image.height || 1
    };
}

function drawCover(context, image, x, y, width, height) {
    const source = imageDimensions(image);
    const scale = Math.max(width / source.width, height / source.height);
    const sourceWidth = width / scale;
    const sourceHeight = height / scale;
    const sourceX = (source.width - sourceWidth) / 2;
    const sourceY = (source.height - sourceHeight) / 2;
    context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
}

function drawContain(context, image, x, y, width, height) {
    const source = imageDimensions(image);
    const scale = Math.min(width / source.width, height / source.height);
    const drawWidth = source.width * scale;
    const drawHeight = source.height * scale;
    const drawX = x + (width - drawWidth) / 2;
    const drawY = y + (height - drawHeight) / 2;
    context.fillStyle = "#050505";
    context.fillRect(x, y, width, height);
    context.drawImage(image, drawX, drawY, drawWidth, drawHeight);
}

async function loadFirstFrames() {
    return Promise.all(VIDEO_SOURCES.map((source, index) => loadPhotoFrame(source.poster, index)));
}

function getTodayString() {
    const date = new Date();
    const pad = value => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function fetchFilmPhotoUrls() {
    let todayPhotos = [];
    try {
        const response = await fetch(`/api/photos/${getTodayString()}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`photo API ${response.status}`);
        const data = await response.json();
        todayPhotos = Array.isArray(data.images)
            ? [...new Set(data.images.filter(url => typeof url === "string" && url.length > 0))]
            : [];
    } catch (error) {
        console.warn("無法讀取今日拍照圖片，膠捲將使用範例圖片補足。", error);
    }

    const missingCount = Math.max(0, MIN_FILM_PHOTO_COUNT - todayPhotos.length);
    // Keep today's images at the end so the texture-size limit retains them
    // even on devices whose maximum texture is smaller than the full atlas.
    return EXAMPLE_IMAGES.slice(0, missingCount).concat(todayPhotos);
}

function createPhotoFallback(index) {
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    const context = canvas.getContext("2d");
    const hue = (index * 47 + 22) % 360;
    const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, `hsl(${hue} 38% 28%)`);
    gradient.addColorStop(1, "#11100f");
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "rgba(255,255,255,.2)";
    context.lineWidth = 16;
    context.beginPath();
    context.arc(canvas.width * 0.5, canvas.height * 0.5, 160, 0, Math.PI * 2);
    context.stroke();
    return canvas;
}

function loadPhotoFrame(url, index) {
    return new Promise(resolve => {
        const image = new Image();
        image.decoding = "async";
        image.addEventListener("load", () => resolve(image), { once: true });
        image.addEventListener("error", () => {
            console.warn(`無法載入底片照片：${url}`);
            resolve(createPhotoFallback(index));
        }, { once: true });
        image.src = url;
    });
}

function limitPhotoUrls(urls) {
    const textureLimit = Math.max(1, Math.floor(renderer.capabilities.maxTextureSize / FILM_CELL_WIDTH));
    const frameLimit = Math.min(16, textureLimit);
    return urls.slice(-frameLimit);
}

async function loadFilmPhotoSet() {
    const urls = limitPhotoUrls(await fetchFilmPhotoUrls());
    const frames = await Promise.all(urls.map(loadPhotoFrame));
    return { urls, frames };
}

function canvasTexture(canvas) {
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    texture.needsUpdate = true;
    return texture;
}

function drawPerforations(context, x, width, canvasHeight) {
    const scale = canvasHeight / FILM_CELL_LAYOUT_HEIGHT;
    const spacing = 47 * scale;
    const holeWidth = 24 * scale;
    const holeHeight = 13 * scale;
    context.save();
    context.globalCompositeOperation = "destination-out";
    for (let holeX = x + 13 * scale; holeX < x + width - 8 * scale; holeX += spacing) {
        for (const holeY of [10 * scale, canvasHeight - holeHeight - 10 * scale]) {
            context.beginPath();
            context.roundRect(holeX, holeY, holeWidth, holeHeight, 3 * scale);
            context.fill();
        }
    }
    context.restore();
}

function createFilmAtlas(frames, rowIndex) {
    const cellWidth = FILM_CELL_WIDTH;
    const cellHeight = FILM_CELL_HEIGHT;
    const canvas = document.createElement("canvas");
    canvas.width = cellWidth * frames.length;
    canvas.height = cellHeight;
    const context = canvas.getContext("2d");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.clearRect(0, 0, canvas.width, canvas.height);

    for (let cellIndex = 0; cellIndex < frames.length; cellIndex += 1) {
        const sourceIndex = (cellIndex + rowIndex * 2) % frames.length;
        const x = cellIndex * cellWidth;

        context.fillStyle = "#281a10";
        context.fillRect(x, 0, cellWidth, cellHeight);
        context.fillStyle = "#120f0d";
        context.fillRect(
            x,
            32 * FILM_ATLAS_SCALE,
            cellWidth,
            cellHeight - 64 * FILM_ATLAS_SCALE
        );
        const frameX = x + FILM_FRAME_INSET_X;
        const frameY = FILM_FRAME_INSET_Y;
        const frameWidth = cellWidth - FILM_FRAME_INSET_X * 2;
        const frameHeight = cellHeight - FILM_FRAME_INSET_Y * 2;
        drawContain(context, frames[sourceIndex], frameX, frameY, frameWidth, frameHeight);

        context.strokeStyle = "rgba(238,175,103,.6)";
        context.lineWidth = 2 * FILM_ATLAS_SCALE;
        context.strokeRect(
            frameX - 2 * FILM_ATLAS_SCALE,
            frameY - 2 * FILM_ATLAS_SCALE,
            frameWidth + 4 * FILM_ATLAS_SCALE,
            frameHeight + 4 * FILM_ATLAS_SCALE
        );
        context.fillStyle = "rgba(238,175,103,.72)";
        context.fillRect(
            x + cellWidth - 2 * FILM_ATLAS_SCALE,
            0,
            2 * FILM_ATLAS_SCALE,
            cellHeight
        );
        drawPerforations(context, x, cellWidth, cellHeight);
    }

    const texture = canvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.userData.frameCount = frames.length;
    return texture;
}

function createRollLabelTexture(frame, source) {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 720;
    const context = canvas.getContext("2d");
    drawCover(context, frame, 0, 0, canvas.width, canvas.height);

    const shade = context.createLinearGradient(0, 0, canvas.width, 0);
    shade.addColorStop(0, "rgba(9,8,7,.88)");
    shade.addColorStop(0.22, "rgba(9,8,7,.1)");
    shade.addColorStop(0.72, "rgba(9,8,7,.15)");
    shade.addColorStop(1, "rgba(9,8,7,.92)");
    context.fillStyle = shade;
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.fillStyle = "rgba(20,14,10,.92)";
    context.fillRect(0, 0, canvas.width, 72);
    context.fillRect(0, canvas.height - 72, canvas.width, 72);
    context.fillStyle = source.accent;
    context.fillRect(74, 72, 18, canvas.height - 144);
    context.fillRect(canvas.width - 92, 72, 18, canvas.height - 144);
    context.fillStyle = "#090807";
    for (let holeX = 24; holeX < canvas.width; holeX += 62) {
        context.beginPath();
        context.roundRect(holeX, 22, 34, 22, 5);
        context.fill();
        context.beginPath();
        context.roundRect(holeX, canvas.height - 45, 34, 22, 5);
        context.fill();
    }

    const bottomFade = context.createLinearGradient(0, canvas.height * 0.68, 0, canvas.height);
    bottomFade.addColorStop(0, "rgba(0,0,0,0)");
    bottomFade.addColorStop(0.7, "rgba(0,0,0,.82)");
    bottomFade.addColorStop(1, "rgba(0,0,0,1)");
    context.fillStyle = bottomFade;
    context.fillRect(0, canvas.height * 0.68, canvas.width, canvas.height * 0.32);

    const texture = canvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    return texture;
}

function seededRandom(seed) {
    let value = seed >>> 0;
    return () => {
        value = (value * 1664525 + 1013904223) >>> 0;
        return value / 4294967296;
    };
}

function addCardboardGrain(context, width, height, seed) {
    const random = seededRandom(seed);
    context.save();
    for (let index = 0; index < 1400; index += 1) {
        const alpha = 0.018 + random() * 0.045;
        const light = random() > 0.52 ? 255 : 18;
        context.fillStyle = `rgba(${light},${light},${light},${alpha})`;
        context.fillRect(random() * width, random() * height, 1 + random() * 3, 1 + random() * 2);
    }
    context.strokeStyle = "rgba(255,255,255,.035)";
    context.lineWidth = 1;
    for (let index = 0; index < 34; index += 1) {
        const y = random() * height;
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(width, y + (random() - 0.5) * 5);
        context.stroke();
    }
    context.restore();
}

function createBoxFaceTexture(frame, source, boxIndex, face) {
    const dimensions = face === "side" ? [512, 720] : face === "top" || face === "bottom" ? [1024, 576] : [1024, 720];
    const isFullBleedPackaging = Boolean(source.boxTexture);
    const canvas = document.createElement("canvas");
    [canvas.width, canvas.height] = dimensions;
    const context = canvas.getContext("2d");
    const { width, height } = canvas;

    context.fillStyle = "#141210";
    context.fillRect(0, 0, width, height);
    context.save();
    if (face === "back") {
        context.translate(width, 0);
        context.scale(-1, 1);
    }
    context.globalAlpha = isFullBleedPackaging
        ? face === "side" ? 0.92 : face === "bottom" ? 0.68 : 1
        : face === "side" ? 0.66 : face === "bottom" ? 0.28 : 1;
    drawCover(context, frame, 0, 0, width, height);
    context.restore();

    const shade = context.createLinearGradient(0, 0, width, height);
    shade.addColorStop(0, isFullBleedPackaging ? "rgba(5,4,3,.02)" : face === "front" ? "rgba(5,4,3,.05)" : "rgba(5,4,3,.3)");
    shade.addColorStop(0.58, isFullBleedPackaging ? "rgba(5,4,3,.08)" : "rgba(5,4,3,.12)");
    shade.addColorStop(1, isFullBleedPackaging ? "rgba(5,4,3,.4)" : "rgba(5,4,3,.72)");
    context.fillStyle = shade;
    context.fillRect(0, 0, width, height);

    if (!isFullBleedPackaging) {
        context.save();
        context.globalAlpha = face === "front" || face === "back" ? 0.9 : 0.72;
        context.fillStyle = source.accent;
        if (face === "side") {
            context.fillRect(0, 0, width * 0.15, height);
            context.fillRect(width * 0.72, 0, width * 0.28, height);
        } else if (face === "top" || face === "bottom") {
            context.fillRect(0, 0, width, height * 0.18);
            context.fillRect(width * 0.74, 0, width * 0.26, height);
        } else {
            context.fillRect(0, 0, width * 0.042, height);
            context.fillRect(0, height * 0.84, width, height * 0.16);
        }
        context.restore();
    }

    context.strokeStyle = "rgba(8,6,5,.82)";
    context.lineWidth = Math.max(10, width * 0.014);
    context.strokeRect(4, 4, width - 8, height - 8);
    context.strokeStyle = "rgba(255,244,224,.16)";
    context.lineWidth = 2;
    context.strokeRect(15, 15, width - 30, height - 30);

    if (!isFullBleedPackaging && (face === "front" || face === "back")) {
        context.strokeStyle = "rgba(255,248,234,.56)";
        context.lineWidth = 7;
        context.beginPath();
        context.arc(width - 118, height - 112, 48 + boxIndex * 3, 0, Math.PI * 2);
        context.stroke();
    }

    addCardboardGrain(context, width, height, 911 + boxIndex * 101 + face.length * 17);
    return canvasTexture(canvas);
}

function createBoxFaceTextures(frame, source, boxIndex) {
    return {
        front: createBoxFaceTexture(frame, source, boxIndex, "front"),
        back: createBoxFaceTexture(frame, source, boxIndex, "back"),
        side: createBoxFaceTexture(frame, source, boxIndex, "side"),
        top: createBoxFaceTexture(frame, source, boxIndex, "top"),
        bottom: createBoxFaceTexture(frame, source, boxIndex, "bottom")
    };
}

function getCardboardSurfaceTexture() {
    if (cardboardSurfaceTexture) return cardboardSurfaceTexture;
    const size = 128;
    const data = new Uint8Array(size * size * 4);
    const random = seededRandom(24681357);
    for (let index = 0; index < size * size; index += 1) {
        const value = Math.round(150 + random() * 92);
        const offset = index * 4;
        data[offset] = value;
        data[offset + 1] = value;
        data[offset + 2] = value;
        data[offset + 3] = 255;
    }
    cardboardSurfaceTexture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    cardboardSurfaceTexture.colorSpace = THREE.NoColorSpace;
    cardboardSurfaceTexture.wrapS = THREE.RepeatWrapping;
    cardboardSurfaceTexture.wrapT = THREE.RepeatWrapping;
    cardboardSurfaceTexture.repeat.set(3, 3);
    cardboardSurfaceTexture.minFilter = THREE.LinearFilter;
    cardboardSurfaceTexture.magFilter = THREE.LinearFilter;
    cardboardSurfaceTexture.needsUpdate = true;
    return cardboardSurfaceTexture;
}

function createRoll(frame, source, rollIndex) {
    const group = new THREE.Group();
    const labelTexture = createRollLabelTexture(frame, source);
    const labelMaterial = new THREE.MeshStandardMaterial({
        map: labelTexture,
        roughness: 0.5,
        metalness: 0.08
    });
    const endMaterial = new THREE.MeshPhysicalMaterial({
        color: 0x0b0a09,
        roughness: 0.28,
        metalness: 0.58,
        clearcoat: 0.65,
        clearcoatRoughness: 0.22
    });
    const hiddenBottomMaterial = new THREE.MeshBasicMaterial({
        color: 0x000000,
        toneMapped: false
    });
    const trimMaterial = new THREE.MeshStandardMaterial({
        color: 0x3e342c,
        roughness: 0.34,
        metalness: 0.72
    });

    const body = new THREE.Mesh(
        new THREE.CylinderGeometry(
            0.94 * ROLL_RADIAL_SCALE,
            0.94 * ROLL_RADIAL_SCALE,
            2.22,
            64,
            1,
            false
        ),
        [labelMaterial, endMaterial, hiddenBottomMaterial]
    );
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    for (const y of [1.16]) {
        const flange = new THREE.Mesh(
            new THREE.CylinderGeometry(
                1.08 * ROLL_RADIAL_SCALE,
                1.08 * ROLL_RADIAL_SCALE,
                0.15,
                64
            ),
            endMaterial
        );
        flange.position.y = y;
        flange.castShadow = true;
        group.add(flange);

        const ring = new THREE.Mesh(
            new THREE.TorusGeometry(0.91 * ROLL_RADIAL_SCALE, 0.042, 12, 64),
            trimMaterial
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.y = y + Math.sign(y) * 0.084;
        group.add(ring);
    }

    const topHub = new THREE.Mesh(
        new THREE.CylinderGeometry(
            0.34 * ROLL_RADIAL_SCALE,
            0.37 * ROLL_RADIAL_SCALE,
            0.32,
            48
        ),
        endMaterial
    );
    topHub.position.y = 1.38;
    topHub.castShadow = true;
    group.add(topHub);

    const hubRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.33 * ROLL_RADIAL_SCALE, 0.032, 10, 48),
        trimMaterial
    );
    hubRing.rotation.x = Math.PI / 2;
    hubRing.position.y = 1.55;
    group.add(hubRing);

    group.rotation.x = -0.055 - rollIndex * 0.012;
    group.rotation.z = [0.015, -0.025, 0.022][rollIndex];
    group.userData.direction = ROLL_DIRECTIONS[rollIndex];
    group.userData.spinSpeed = [0.03, 0.028][rollIndex] * ROLL_DIRECTIONS[rollIndex];
    group.userData.labelTexture = labelTexture;
    sceneRoot.add(group);
    rolls.push(group);
}

function createRibbon(frames, rowIndex) {
    const geometry = new THREE.PlaneGeometry(BASE_RIBBON_WIDTH, RIBBON_HEIGHT, 128, 3);
    const positions = geometry.attributes.position;
    geometry.userData.basePositions = new Float32Array(positions.array);

    const atlas = createFilmAtlas(frames, rowIndex);
    atlas.repeat.set(1.5, 1);
    const material = new THREE.MeshBasicMaterial({
        map: atlas,
        color: 0xffffff,
        transparent: true,
        alphaTest: 0.16,
        side: THREE.DoubleSide,
        toneMapped: false
    });

    const ribbon = new THREE.Mesh(geometry, material);
    ribbon.frustumCulled = false;
    ribbon.receiveShadow = true;
    ribbon.userData = {
        atlas,
        phase: [0.2, 2.1, 4.4][rowIndex],
        amplitude: [0.32, 0.28][rowIndex],
        depth: [0.46, 0.4][rowIndex],
        cellsPerSecond: [0.07, 0.06][rowIndex] * FILM_SPEED_MULTIPLIER,
        direction: ROLL_DIRECTIONS[rowIndex],
        flowOffset: rowIndex * 0.17
    };

    sceneRoot.add(ribbon);
    ribbons.push(ribbon);
}

function createFilmBox(frame, source, boxIndex) {
    const group = new THREE.Group();
    const faceTextures = createBoxFaceTextures(frame, source, boxIndex);
    const surfaceTexture = getCardboardSurfaceTexture();
    const createPackageMaterial = (map, roughness = 0.88) => new THREE.MeshStandardMaterial({
        map,
        roughness,
        roughnessMap: surfaceTexture,
        bumpMap: surfaceTexture,
        bumpScale: 0.018,
        metalness: 0.015
    });
    const sideMaterial = createPackageMaterial(faceTextures.side, 0.92);
    const topMaterial = createPackageMaterial(faceTextures.top, 0.86);
    const bottomMaterial = createPackageMaterial(faceTextures.bottom, 0.96);
    const frontMaterial = createPackageMaterial(faceTextures.front, 0.84);
    const backMaterial = createPackageMaterial(faceTextures.back, 0.9);
    const geometry = new THREE.BoxGeometry(2.32, 1.62, 1.3);
    const mesh = new THREE.Mesh(geometry, [sideMaterial, sideMaterial, topMaterial, bottomMaterial, frontMaterial, backMaterial]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);

    const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({ color: 0x32261d, transparent: true, opacity: 0.3 })
    );
    group.add(outline);

    group.userData = {
        source,
        route: source.route,
        faceTextures,
        slot: boxIndex,
        jitterX: [0, -0.005, 0.004, -0.004, 0][boxIndex],
        jitterY: [0.05, 0.1, 0.02, 0.08, 0.04][boxIndex],
        rotationX: -0.13 + (Math.random() - 0.5) * 0.05,
        rotationY: [0.58, -0.34, 0.27, -0.42, 0.36][boxIndex] + (Math.random() - 0.5) * 0.15,
        rotationZ: (Math.random() - 0.5) * 0.13,
        spinSpeed: [0.011, -0.009, 0.01, -0.012, 0.008][boxIndex] * (0.9 + Math.random() * 0.2),
        floatPhase: Math.random() * Math.PI * 2
    };
    mesh.userData.boxGroup = group;
    mesh.userData.route = source.route;
    boxHitMeshes.push(mesh);
    group.rotation.set(group.userData.rotationX, group.userData.rotationY, group.userData.rotationZ);
    sceneRoot.add(group);
    boxes.push(group);
}

function createFloor() {
    floor = new THREE.Mesh(
        new THREE.PlaneGeometry(60, 16),
        new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -6.22, -0.8);
    floor.receiveShadow = false;
    sceneRoot.add(floor);
}

function createDust() {
    const count = 180;
    const positions = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
        positions[index * 3] = (Math.random() - 0.5) * 36;
        positions[index * 3 + 1] = (Math.random() - 0.5) * 14;
        positions[index * 3 + 2] = -2 - Math.random() * 8;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    dust = new THREE.Points(
        geometry,
        new THREE.PointsMaterial({ color: 0xd0a375, size: 0.024, transparent: true, opacity: 0.28, depthWrite: false })
    );
    sceneRoot.add(dust);
}

function viewBoundsAtDepth(depth = 0) {
    const distance = camera.position.z - depth;
    const height = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * distance;
    const width = height * camera.aspect;
    return {
        width,
        height,
        left: -width / 2,
        right: width / 2,
        top: height / 2,
        bottom: -height / 2
    };
}

function layoutScene() {
    if (!initialized) return;
    const bounds = viewBoundsAtDepth(0);
    const narrow = bounds.width < 9;
    const baseBoxScale = narrow ? clamp(bounds.width / 8.5, 0.62, 0.78) : clamp(bounds.width / 19, 1.12, 1.28);
    const boxScale = baseBoxScale * BOX_SCALE_MULTIPLIER;
    const boxRowY = narrow ? NARROW_ROW_Y[1] : ROW_Y[1];
    const bottomRowY = bounds.bottom + 1.7 * baseBoxScale;
    const rollScale = narrow ? clamp(bounds.width / 5.8, 0.9, 1.08) : 1.55;
    const rollExtent = 1.08 * rollScale;
    const leftReelX = bounds.left + rollExtent * 1.35;
    const rightReelX = bounds.right - rollExtent * 1.35;
    const reelX = [leftReelX, rightReelX, leftReelX];

    rolls.forEach((roll, index) => {
        const rowY = index === 1
            ? bottomRowY
            : narrow ? NARROW_ROW_Y[index] : ROW_Y[index];
        roll.scale.setScalar(rollScale);
        roll.position.set(reelX[index], rowY, 0.62 + index * 0.04);
    });

    ribbons.forEach((ribbon, index) => {
        const rowY = index === 1
            ? bottomRowY
            : narrow ? NARROW_ROW_Y[index] : ROW_Y[index];
        const direction = ribbon.userData.direction;
        const startX = direction > 0 ? reelX[index] + 0.52 * rollScale : bounds.left - 1.15;
        const endX = direction > 0 ? bounds.right + 1.15 : reelX[index] - 0.52 * rollScale;
        const width = Math.max(endX - startX, 3.8);
        ribbon.position.set((startX + endX) / 2, rowY, -0.03 - index * 0.035);
        const ribbonScaleY = narrow ? 0.58 : 1;
        ribbon.scale.set(width / BASE_RIBBON_WIDTH, ribbonScaleY, 1);
        const frameCount = Math.max(ribbon.userData.atlas.userData.frameCount || 1, 1);
        const targetCellWidth = RIBBON_HEIGHT
            * ribbonScaleY
            * FILM_CELL_LAYOUT_WIDTH
            / FILM_CELL_LAYOUT_HEIGHT;
        ribbon.userData.atlas.repeat.x = clamp((width / targetCellWidth) / frameCount, 0.055, 1.1);

    });

    const boxLeft = narrow ? bounds.left + 1.58 * boxScale : bounds.left + bounds.width * BOX_ROW_MARGIN;
    const boxRight = narrow ? bounds.right - 1.58 * boxScale : bounds.right - bounds.width * BOX_ROW_MARGIN;
    const available = Math.max(boxRight - boxLeft, 0.7);

    boxes.forEach((box, index) => {
        const slot = boxes.length > 1 ? index / (boxes.length - 1) : 0.5;
        const x = boxLeft + available * slot + available * box.userData.jitterX;
        const y = boxRowY + box.userData.jitterY;
        box.scale.setScalar(boxScale);
        box.position.set(x, y, 1.02 + (index % 3) * 0.12);
    });

    if (floor) floor.position.y = bounds.bottom + 0.24;
}

function updateRibbon(ribbon, elapsedSeconds) {
    const positions = ribbon.geometry.attributes.position;
    const base = ribbon.geometry.userData.basePositions;
    const reduced = motionPreference.matches;
    const time = reduced ? 0 : elapsedSeconds;
    const phase = ribbon.userData.phase;

    for (let index = 0; index < positions.count; index += 1) {
        const offset = index * 3;
        const x = base[offset];
        const originalY = base[offset + 1];
        const u = (x + BASE_RIBBON_WIDTH / 2) / BASE_RIBBON_WIDTH;
        const curveU = ribbon.userData.direction > 0 ? u : 1 - u;
        const envelope = smoothstep(0.04, 0.23, curveU);
        const primary = Math.sin(curveU * Math.PI * 3.35 - time * 0.22 + phase);
        const secondary = Math.sin(curveU * Math.PI * 7.2 + time * 0.1 + phase * 0.7);
        const waveY = envelope * ribbon.userData.amplitude * (primary + secondary * 0.1);
        const waveZ = envelope * ribbon.userData.depth * Math.sin(curveU * Math.PI * 2.55 + time * 0.18 + phase);
        const twist = envelope * (originalY / RIBBON_HEIGHT) * Math.sin(curveU * Math.PI * 4.4 - time * 0.13 + phase) * 0.08;
        positions.setXYZ(index, x, originalY + waveY, waveZ + twist);
    }
    positions.needsUpdate = true;
}

function updateFilmNoise(elapsedSeconds, reduced) {
    if (reduced) {
        filmNoiseUniforms.uTime.value = 0;
        filmNoiseUniforms.uBurst.value = 0;
        filmNoiseBurstStartedAt = -Infinity;
        return;
    }

    if (elapsedSeconds >= filmNoiseNextBurstAt) {
        filmNoiseBurstStartedAt = elapsedSeconds;
        filmNoiseBurstDuration = 0.2 + Math.random() * 0.42;
        filmNoiseUniforms.uSeed.value = Math.random() * 1000;
        filmNoiseNextBurstAt = elapsedSeconds + 5.5 + Math.random() * 9.5;
    }

    const burstAge = elapsedSeconds - filmNoiseBurstStartedAt;
    const burstProgress = filmNoiseBurstDuration > 0
        ? burstAge / filmNoiseBurstDuration
        : 2;
    const fadeIn = smoothstep(0, 0.18, burstProgress);
    const fadeOut = 1 - smoothstep(0.42, 1, burstProgress);

    filmNoiseUniforms.uTime.value = elapsedSeconds;
    filmNoiseUniforms.uBurst.value = clamp(fadeIn * fadeOut, 0, 1);
}

function resize() {
    const width = Math.max(stage.clientWidth, 1);
    const height = Math.max(stage.clientHeight, 1);
    camera.aspect = width / height;
    camera.fov = width < 720 ? 42 : 39;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, width < 720 ? 1.4 : 1.75));
    renderer.setSize(width, height, false);
    filmNoiseUniforms.uResolution.value.set(renderer.domElement.width, renderer.domElement.height);
    layoutScene();
}

function getBoxAtPointer(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointerNdc.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(pointerNdc, camera);
    const hit = raycaster.intersectObjects(boxHitMeshes, false)[0];
    return hit?.object.userData.boxGroup || null;
}

function updateBoxHover(event) {
    if (!initialized) return;
    stage.classList.toggle("is-box-hovered", Boolean(getBoxAtPointer(event)));
}

function handleBoxClick(event) {
    if (!initialized) return;
    const box = getBoxAtPointer(event);
    if (box?.userData.route) {
        lobbyMusic.pause();
        requestExperiencePlayback(box.userData.route);
        window.location.assign(box.userData.route);
    }
}

function tick(now) {
    const deltaSeconds = Math.min((now - lastFrameTime) / 1000, 0.05);
    const elapsedSeconds = now / 1000;
    lastFrameTime = now;
    const reduced = motionPreference.matches;

    updateFilmNoise(elapsedSeconds, reduced);

    ribbons.forEach(ribbon => {
        if (!reduced) {
            const frameCount = Math.max(ribbon.userData.atlas.userData.frameCount || 1, 1);
            ribbon.userData.flowOffset = wrap01(
                ribbon.userData.flowOffset
                - ribbon.userData.cellsPerSecond / frameCount * deltaSeconds * ribbon.userData.direction
            );
        }
        ribbon.userData.atlas.offset.x = ribbon.userData.flowOffset;
        updateRibbon(ribbon, elapsedSeconds);
    });

    if (!reduced) {
        rolls.forEach(roll => {
            roll.rotation.y -= roll.userData.spinSpeed * deltaSeconds;
        });
        boxes.forEach(box => {
            box.rotation.x = box.userData.rotationX + Math.sin(elapsedSeconds * 0.38 + box.userData.floatPhase) * 0.012;
            box.rotation.y += box.userData.spinSpeed * deltaSeconds;
        });
        if (dust) dust.rotation.z = Math.sin(elapsedSeconds * 0.035) * 0.02;
    }

    renderer.clear();
    renderer.render(scene, camera);
    if (!reduced && filmNoiseUniforms.uBurst.value > 0.001) {
        renderer.clearDepth();
        renderer.render(filmNoiseScene, filmNoiseCamera);
    }
    window.requestAnimationFrame(tick);
}

function replaceRibbonAtlases(frames) {
    ribbons.forEach((ribbon, rowIndex) => {
        const previousAtlas = ribbon.userData.atlas;
        const nextAtlas = createFilmAtlas(frames, rowIndex);
        nextAtlas.offset.copy(previousAtlas.offset);
        ribbon.userData.atlas = nextAtlas;
        ribbon.material.map = nextAtlas;
        ribbon.material.needsUpdate = true;
        previousAtlas.dispose();
    });
    layoutScene();
}

async function refreshFilmPhotos() {
    if (photoRefreshBusy) return;
    photoRefreshBusy = true;
    try {
        const urls = limitPhotoUrls(await fetchFilmPhotoUrls());
        const signature = urls.join("|");
        if (signature === filmPhotoSignature) return;
        const frames = await Promise.all(urls.map(loadPhotoFrame));
        replaceRibbonAtlases(frames);
        filmPhotoSignature = signature;
    } catch (error) {
        console.warn("更新今日底片照片失敗。", error);
    } finally {
        photoRefreshBusy = false;
    }
}

async function initialize() {
    resize();
    const [videoFrames, filmPhotoSet, boxTextureFrames] = await Promise.all([
        loadFirstFrames(),
        loadFilmPhotoSet(),
        Promise.all(VIDEO_SOURCES.map((source, index) => (
            source.boxTexture ? loadPhotoFrame(source.boxTexture, index) : Promise.resolve(null)
        )))
    ]);
    filmPhotoSignature = filmPhotoSet.urls.join("|");

    createFloor();
    ROLL_SOURCE_INDEXES.forEach((sourceIndex, rollIndex) => {
        createRibbon(filmPhotoSet.frames, rollIndex);
        createRoll(videoFrames[sourceIndex], VIDEO_SOURCES[sourceIndex], rollIndex);
    });
    BOX_SOURCE_INDEXES.forEach((sourceIndex, boxIndex) => {
        const source = VIDEO_SOURCES[sourceIndex];
        const boxFrame = boxTextureFrames[sourceIndex] || videoFrames[sourceIndex];
        createFilmBox(boxFrame, source, boxIndex);
    });

    initialized = true;
    layoutScene();
    stage.classList.add("is-ready");
    window.requestAnimationFrame(tick);
    window.setInterval(refreshFilmPhotos, PHOTO_POLL_INTERVAL);
}

renderer.domElement.addEventListener("pointermove", updateBoxHover);
renderer.domElement.addEventListener("click", handleBoxClick);
renderer.domElement.addEventListener("pointerleave", () => {
    stage.classList.remove("is-box-hovered");
});
window.addEventListener("resize", resize, { passive: true });
document.addEventListener("visibilitychange", () => {
    lastFrameTime = performance.now();
    if (document.hidden) {
        lobbyMusic.pause();
    } else {
        void startLobbyMusic();
    }
});
window.addEventListener("pageshow", () => {
    void startLobbyMusic();
});
window.addEventListener("pagehide", () => {
    lobbyMusic.pause();
});

initialize().catch(error => {
    console.error("膠捲場景初始化失敗", error);
    stage.classList.add("has-error");
});
