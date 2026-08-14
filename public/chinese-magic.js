import * as THREE from "three";
import { OrbitControls } from "/vendor/three-addons/controls/OrbitControls.js";
import { createExperiencePlayback } from "/experience-playback.js?v=1";
import { createWinnerNameLabel, getPhotoCandidateEntries, pickRandomPhotoEntry } from "/lottery-photos.js?v=3";

const REFERENCE_IMAGES = Array.from({ length: 10 }, (_, index) => {
    const number = String(index + 1).padStart(2, "0");
    return `/images/style-${number}.webp`;
});

const POLL_INTERVAL = 10_000;
const SHAPE_INTERVAL = 6_200;
const MORPH_DURATION = 1.85;
const MAX_PHOTOS = 500;
const MIN_DESKTOP_CARDS = 500;
const FALLBACK_CARD_COUNT = window.innerWidth < 700 ? 200 : 500;
const LAYOUTS = ["moon", "cube", "ai", "nkust", "rabbit", "plane"];
const stage = document.querySelector("#magicStage");
const winnerName = createWinnerNameLabel(stage);

const drawButton = {
    disabled: false,
    querySelector: () => ({ textContent: '' }),
    setAttribute: () => {},
    addEventListener: () => {}
};


const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
scene.fog = new THREE.FogExp2(0x000000, 0.017);

const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 120);
camera.position.set(0, 0.3, 13.8);

const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "high-performance"
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth >= 700 ? 1.5 : 1.35));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
stage.appendChild(renderer.domElement);

const backdropUniforms = {
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uViewOffset: { value: new THREE.Vector2() },
    uFlash: { value: 0 }
};

const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
        uniforms: backdropUniforms,
        vertexShader: `
            void main() {
                gl_Position = vec4(position.xy, 1.0, 1.0);
            }
        `,
        fragmentShader: `
            precision highp float;
            uniform float uTime;
            uniform vec2 uResolution;
            uniform vec2 uViewOffset;
            uniform float uFlash;

            float hash21(vec2 p) {
                p = fract(p * vec2(123.34, 456.21));
                p += dot(p, p + 45.32);
                return fract(p.x * p.y);
            }

            float noise2(vec2 p) {
                vec2 i = floor(p);
                vec2 f = fract(p);
                f = f * f * (3.0 - 2.0 * f);
                return mix(
                    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
                    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
                    f.y
                );
            }

            float starLayer(vec2 uv, float scale, float cutoff, float seed) {
                vec2 grid = uv * scale;
                vec2 cell = floor(grid);
                vec2 local = fract(grid) - 0.5;
                float randomValue = hash21(cell + seed);
                vec2 offset = vec2(hash21(cell + seed + 13.1), hash21(cell + seed + 41.7)) - 0.5;
                float size = mix(0.018, 0.065, hash21(cell + seed + 79.2));
                float star = 1.0 - smoothstep(0.0, size, length(local - offset * 0.68));
                float twinkle = 0.68 + sin(uTime * (0.8 + randomValue * 2.2) + randomValue * 29.0) * 0.32;
                return star * step(cutoff, randomValue) * twinkle;
            }

            void main() {
                vec2 uv = gl_FragCoord.xy / uResolution.xy;
                vec2 p = (gl_FragCoord.xy - 0.5 * uResolution.xy) / uResolution.y;
                p += uViewOffset * vec2(0.04, 0.025);

                vec3 color = mix(vec3(0.001, 0.002, 0.012), vec3(0.006, 0.012, 0.038), uv.y);
                float cloudA = noise2(p * 2.0 + vec2(uTime * 0.004, -0.7));
                float cloudB = noise2(p * 4.3 - vec2(uTime * 0.003, 0.2));
                float nebula = pow(cloudA * cloudB, 2.1);
                color += vec3(0.045, 0.065, 0.16) * nebula * 0.72;

                float stars = starLayer(p, 95.0, 0.968, 4.2);
                stars += starLayer(p + vec2(0.17, 0.09), 178.0, 0.987, 18.7) * 0.78;
                stars += starLayer(p - vec2(0.11, 0.21), 270.0, 0.993, 42.4) * 0.48;
                color += mix(vec3(0.45, 0.62, 1.0), vec3(1.0), clamp(stars, 0.0, 1.0)) * stars;

                float galacticBand = exp(-pow((p.y + p.x * 0.2 - 0.12) / 0.22, 2.0));
                color += vec3(0.018, 0.022, 0.055) * galacticBand * noise2(p * 7.0) * 0.7;
                color += vec3(0.64, 0.76, 1.0) * uFlash;
                gl_FragColor = vec4(color, 1.0);
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }
        `,
        depthTest: false,
        depthWrite: false,
        fog: false
    })
);
backdrop.visible = false;
backdrop.frustumCulled = false;
backdrop.renderOrder = -1000;
scene.add(backdrop);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.055;
controls.rotateSpeed = 0.42;
controls.zoomSpeed = 0.7;
controls.enablePan = false;
controls.minDistance = 8;
controls.maxDistance = 23;
controls.minAzimuthAngle = -0.72;
controls.maxAzimuthAngle = 0.72;
controls.minPolarAngle = 1.08;
controls.maxPolarAngle = 2.02;
controls.target.set(0, 0, -1.2);

scene.add(new THREE.HemisphereLight(0xdde8ff, 0x090b16, 2.3));

const keyLight = new THREE.DirectionalLight(0xf4f7ff, 3.4);
keyLight.position.set(5, 7, 10);
scene.add(keyLight);

const coolLight = new THREE.PointLight(0x799dff, 30, 32, 2);
coolLight.position.set(-7, 0, 6);
scene.add(coolLight);

const rimLight = new THREE.PointLight(0xc9ddff, 20, 26, 2);
rimLight.position.set(7, 4, 2);
scene.add(rimLight);

const imageLibrary = [];
const loadedUrls = new Set();
const cards = [];
const frontMaterials = [];
let cardBaseInstances = null;
const gallery = new THREE.Group();
scene.add(gallery);

const cardGeometry = new THREE.PlaneGeometry(0.5, 1.4);
const cardFrontGeometry = new THREE.PlaneGeometry(0.69, 0.88);
const edgeMaterial = new THREE.MeshStandardMaterial({
    color: 0xbfc4cb,
    roughness: 0.82,
    metalness: 0.02
});
const backMaterial = new THREE.MeshStandardMaterial({
    color: 0x252a33,
    roughness: 0.86,
    metalness: 0.08
});

const forward = new THREE.Vector3(0, 0, 1);
const tempVector = new THREE.Vector3();
const tempNormal = new THREE.Vector3();
const tempQuaternion = new THREE.Quaternion();
const tempEuler = new THREE.Euler();
const cameraOffset = new THREE.Vector3();
const cameraSpherical = new THREE.Spherical();
const LOTTERY_CENTER = new THREE.Vector3(0, 0, -0.65);
const DISPLAY_CENTER = new THREE.Vector3(0, 0, -1.05);
const rotatedLotteryCenter = new THREE.Vector3();
const rotatedDisplayCenter = new THREE.Vector3();
const galleryOrigin = new THREE.Vector3();
const cardInstanceMatrix = new THREE.Matrix4();
const invisibleCardScale = new THREE.Vector3(0, 0, 0);

let state = "idle";
let currentLayout = "moon";
let currentLayoutIndex = 0;
let lastShapeChangeAt = 0;
let morphStartedAt = 0;
let morphing = false;
let pendingRefresh = false;
let lastInteractionAt = -Infinity;
let winnerEntry = null;
let winnerMesh = null;
let lotteryPhaseStartedAt = 0;
let explosionAge = Infinity;
let mosaicLayout = null;
let mosaicMaterial = null;
let mosaicCycle = 0;
const mosaicGeometries = [];

function localDateString() {
    const date = new Date();
    const pad = value => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function stableRandom(seed) {
    const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
    return value - Math.floor(value);
}

function loadImage(url) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.decoding = "async";
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = url;
    });
}

async function addImage(url) {
    if (!url || loadedUrls.has(url)) return false;
    loadedUrls.add(url);
    try {
        const image = await loadImage(url);
        imageLibrary.push({ url, image });
        return true;
    } catch {
        loadedUrls.delete(url);
        return false;
    }
}

function drawCover(context, image, x, y, width, height) {
    const natWidth = image.naturalWidth || image.width;
    const natHeight = image.naturalHeight || image.height;
    const imageRatio = natWidth / natHeight;
    const targetRatio = width / height;
    let sourceWidth = natWidth;
    let sourceHeight = natHeight;
    let sourceX = 0;
    let sourceY = 0;

    if (imageRatio > targetRatio) {
        sourceWidth = natHeight * targetRatio;
        sourceX = (natWidth - sourceWidth) / 2;
    } else {
        sourceHeight = natWidth / targetRatio;
        sourceY = (natHeight - sourceHeight) / 2;
    }
    context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
}

function createPhotoTexture(image) {
    // The winner card is displayed large, so a 256x324 canvas becomes visibly
    // pixelated. Render the polaroid at 4x resolution while keeping the same
    // proportions for its border and vignette.
    const scale = 4;
    const canvas = document.createElement("canvas");
    canvas.width = 256 * scale;
    canvas.height = 324 * scale;
    const context = canvas.getContext("2d");
    context.fillStyle = "#d8d9d7";
    context.fillRect(0, 0, canvas.width, canvas.height);
    drawCover(context, image, 8 * scale, 8 * scale, 240 * scale, 308 * scale);
    const vignette = context.createRadialGradient(
        128 * scale,
        140 * scale,
        46 * scale,
        128 * scale,
        157 * scale,
        183 * scale
    );
    vignette.addColorStop(0, "rgba(255,255,255,0)");
    vignette.addColorStop(1, "rgba(3,7,16,0.2)");
    context.fillStyle = vignette;
    context.fillRect(8 * scale, 8 * scale, 240 * scale, 308 * scale);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 4);
    return texture;
}

function textureForEntry(entry) {
    if (!entry) return null;
    if (!entry.texture && entry.image) {
        entry.texture = new THREE.Texture(entry.image);
        entry.texture.colorSpace = THREE.SRGBColorSpace;
        entry.texture.generateMipmaps = false;
        entry.texture.minFilter = THREE.LinearFilter;
        entry.texture.needsUpdate = true;
    }
    return entry.texture;
}

function mosaicTextureForEntry(entry) {
    if (!entry.mosaicTexture) {
        entry.mosaicTexture = new THREE.Texture(entry.image);
        entry.mosaicTexture.colorSpace = THREE.SRGBColorSpace;
        entry.mosaicTexture.generateMipmaps = false;
        entry.mosaicTexture.minFilter = THREE.LinearFilter;
        entry.mosaicTexture.magFilter = THREE.LinearFilter;
        entry.mosaicTexture.needsUpdate = true;
    }
    return entry.mosaicTexture;
}

function fibonacciDirection(index, count, seed = 0) {
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const y = 1 - 2 * ((index + 0.5) / count);
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = goldenAngle * index + seed;
    return new THREE.Vector3(Math.cos(theta) * radius, y, Math.sin(theta) * radius);
}

function quaternionForNormal(normal) {
    return new THREE.Quaternion().setFromUnitVectors(forward, normal.clone().normalize());
}

function shapeCardScale(count, baseScale) {
    return baseScale * Math.min(1, Math.sqrt(FALLBACK_CARD_COUNT / Math.max(1, count)));
}

function moonTarget(index, count, singleMoon = false) {
    const center = singleMoon ? LOTTERY_CENTER : DISPLAY_CENTER;
    const radius = singleMoon ? 3.22 : 3.42;
    const normal = fibonacciDirection(index, count, singleMoon ? 0 : 0.42);
    return {
        position: normal.clone().multiplyScalar(radius).add(center),
        quaternion: quaternionForNormal(normal),
        scale: shapeCardScale(count, singleMoon ? 1.06 : 1.08),
        normal
    };
}

function cubeTarget(index, count) {
    const direction = fibonacciDirection(index, count, 0.26);
    const maxAxis = Math.max(Math.abs(direction.x), Math.abs(direction.y), Math.abs(direction.z));
    const position = direction.clone().multiplyScalar(3.05 / maxAxis).add(DISPLAY_CENTER);
    const absolute = [Math.abs(direction.x), Math.abs(direction.y), Math.abs(direction.z)];
    const dominant = absolute.indexOf(Math.max(...absolute));
    const normal = new THREE.Vector3();
    normal.setComponent(dominant, Math.sign(direction.getComponent(dominant)) || 1);
    return { position, quaternion: quaternionForNormal(normal), scale: shapeCardScale(count, 1.02), normal };
}

const textPointCache = new Map();

function createTextPoints(label, count) {
    const cacheKey = `${label}-${count}`;
    if (textPointCache.has(cacheKey)) return textPointCache.get(cacheKey);

    const canvas = document.createElement("canvas");
    canvas.width = 1600;
    canvas.height = 520;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const fontSize = label === "AI" ? 430 : 320;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#fff";
    context.font = `900 ${fontSize}px "Arial Black", Arial, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(label, canvas.width / 2, canvas.height / 2 + fontSize * 0.035);

    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const candidates = [];
    let minX = canvas.width;
    let maxX = 0;
    let minY = canvas.height;
    let maxY = 0;
    for (let y = 0; y < canvas.height; y += 4) {
        for (let x = 0; x < canvas.width; x += 4) {
            if (pixels[(y * canvas.width + x) * 4 + 3] < 160) continue;
            candidates.push({ x, y });
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
        }
    }

    const targetWidth = label === "AI" ? 6.8 : 13.2;
    const targetHeight = label === "AI" ? 5.4 : 4.4;
    const textScale = Math.min(targetWidth / Math.max(1, maxX - minX), targetHeight / Math.max(1, maxY - minY));
    const centerX = (minX + maxX) * 0.5;
    const centerY = (minY + maxY) * 0.5;
    const points = [];

    for (let index = 0; index < count; index += 1) {
        const segmentStart = Math.floor(index * candidates.length / count);
        const segmentEnd = Math.max(segmentStart + 1, Math.floor((index + 1) * candidates.length / count));
        const offset = Math.floor(stableRandom(index * 131 + label.length * 977) * (segmentEnd - segmentStart));
        const sample = candidates[Math.min(candidates.length - 1, segmentStart + offset)];
        points.push(new THREE.Vector3(
            (sample.x - centerX) * textScale,
            (centerY - sample.y) * textScale,
            -1.05 + Math.sin(index * 0.73) * 0.035
        ));
    }

    textPointCache.set(cacheKey, points);
    return points;
}

function textTarget(label, index, count) {
    const points = createTextPoints(label, count);
    return {
        position: points[index].clone(),
        quaternion: new THREE.Quaternion(),
        scale: label === "AI" ? 0.34 : 0.31,
        normal: new THREE.Vector3(0, 0, 1)
    };
}

const rabbitPointCache = new Map();

function createRabbitPoints(count) {
    if (rabbitPointCache.has(count)) return rabbitPointCache.get(count);

    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 900;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.fillStyle = "#fff";

    context.save();
    context.translate(285, 285);
    context.rotate(-0.16);
    context.beginPath();
    context.ellipse(0, 0, 92, 258, 0, 0, Math.PI * 2);
    context.fill();
    context.restore();

    context.save();
    context.translate(515, 285);
    context.rotate(0.16);
    context.beginPath();
    context.ellipse(0, 0, 92, 258, 0, 0, Math.PI * 2);
    context.fill();
    context.restore();

    context.beginPath();
    context.ellipse(400, 610, 265, 225, 0, 0, Math.PI * 2);
    context.fill();

    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const candidates = [];
    let minX = canvas.width;
    let maxX = 0;
    let minY = canvas.height;
    let maxY = 0;
    for (let y = 0; y < canvas.height; y += 4) {
        for (let x = 0; x < canvas.width; x += 4) {
            if (pixels[(y * canvas.width + x) * 4 + 3] < 160) continue;
            candidates.push({ x, y });
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
        }
    }

    const targetWidth = 7.2;
    const targetHeight = 7.4;
    const rabbitScale = Math.min(targetWidth / Math.max(1, maxX - minX), targetHeight / Math.max(1, maxY - minY));
    const centerX = (minX + maxX) * 0.5;
    const centerY = (minY + maxY) * 0.5;
    const points = [];
    for (let index = 0; index < count; index += 1) {
        const segmentStart = Math.floor(index * candidates.length / count);
        const segmentEnd = Math.max(segmentStart + 1, Math.floor((index + 1) * candidates.length / count));
        const offset = Math.floor(stableRandom(index * 149 + 4201) * (segmentEnd - segmentStart));
        const sample = candidates[Math.min(candidates.length - 1, segmentStart + offset)];
        points.push(new THREE.Vector3(
            (sample.x - centerX) * rabbitScale,
            (centerY - sample.y) * rabbitScale,
            -1.08 + Math.sin(index * 0.81) * 0.035
        ));
    }

    rabbitPointCache.set(count, points);
    return points;
}

function rabbitTarget(index, count) {
    const points = createRabbitPoints(count);
    return {
        position: points[index].clone(),
        quaternion: new THREE.Quaternion(),
        scale: 0.31,
        normal: new THREE.Vector3(0, 0, 1)
    };
}

function chooseMosaicGrid(count, imageAspect) {
    let best = { columns: count, rows: 1, error: Infinity };
    for (let columns = 1; columns <= count; columns += 1) {
        if (count % columns !== 0) continue;
        const rows = count / columns;
        const gridAspect = (columns * 0.69) / (rows * 0.88);
        const error = Math.abs(Math.log(gridAspect / imageAspect));
        if (error < best.error) best = { columns, rows, error };
    }
    return best;
}

function createMosaicFracture(columns, rows, cycle) {
    const fragments = new Map();
    const breakColumn = Math.floor(columns * (0.18 + stableRandom(cycle * 1709 + 11) * 0.64));
    const breakRow = Math.floor(rows * (0.18 + stableRandom(cycle * 1801 + 23) * 0.64));
    const radius = Math.min(columns, rows) * (0.1 + stableRandom(cycle * 1901 + 37) * 0.055);

    for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
            const index = row * columns + column;
            const seed = cycle * 2003 + index * 47;
            const deltaX = column - breakColumn;
            const deltaY = breakRow - row;
            const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY * 0.82);
            const jaggedEdge = 0.72 + stableRandom(seed + 53) * 0.58;
            if (distance > radius * jaggedEdge) continue;

            let directionX = deltaX;
            let directionY = deltaY;
            if (distance < 0.01) {
                const angle = stableRandom(seed + 67) * Math.PI * 2;
                directionX = Math.cos(angle);
                directionY = Math.sin(angle);
            } else {
                directionX /= distance;
                directionY /= distance;
            }
            const force = 0.58 + stableRandom(seed + 79) * 1.15 + (1 - Math.min(1, distance / radius)) * 0.55;
            const missing = stableRandom(seed + 97) < 0.24;
            fragments.set(index, {
                offset: new THREE.Vector3(
                    directionX * force + (stableRandom(seed + 101) - 0.5) * 0.36,
                    directionY * force + (stableRandom(seed + 113) - 0.5) * 0.36,
                    0.42 + stableRandom(seed + 127) * 1.38
                ),
                quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(
                    (stableRandom(seed + 139) - 0.5) * 1.2,
                    (stableRandom(seed + 151) - 0.5) * 1.2,
                    (stableRandom(seed + 163) - 0.5) * 1.75
                )),
                scale: missing ? 0.045 : 0.58 + stableRandom(seed + 179) * 0.31
            });
        }
    }
    return fragments;
}

function restorePhotoMaterials() {
    if (!mosaicMaterial && mosaicGeometries.length === 0) return;
    cards.forEach(card => {
        const front = card.userData.front;
        if (!front) return;
        front.geometry = cardFrontGeometry;
        front.material = card.userData.photoMaterial;
    });
    mosaicGeometries.forEach(geometry => geometry.dispose());
    mosaicGeometries.length = 0;
    mosaicMaterial?.dispose();
    mosaicMaterial = null;
    mosaicLayout = null;
}

function prepareMosaic() {
    restorePhotoMaterials();
    if (cards.length === 0) return;

    const liveEntries = imageLibrary.filter(entry => !REFERENCE_IMAGES.includes(entry.url));
    const candidates = liveEntries.length > 0 ? liveEntries : imageLibrary;
    if (candidates.length === 0) return;

    mosaicCycle += 1;
    const selectedIndex = Math.floor(stableRandom(mosaicCycle * 1301 + cards.length * 17) * candidates.length);
    const entry = candidates[selectedIndex];
    const imageAspect = entry.image.naturalWidth / entry.image.naturalHeight;
    const grid = chooseMosaicGrid(cards.length, imageAspect);
    const displayAspect = (grid.columns * 0.69) / (grid.rows * 0.88);
    mosaicLayout = {
        count: cards.length,
        columns: grid.columns,
        rows: grid.rows,
        displayAspect,
        fragments: createMosaicFracture(grid.columns, grid.rows, mosaicCycle)
    };
    mosaicMaterial = new THREE.MeshBasicMaterial({
        map: mosaicTextureForEntry(entry),
        color: 0xffffff,
        toneMapped: true
    });

    let uMin = 0;
    let uMax = 1;
    let vMin = 0;
    let vMax = 1;
    if (imageAspect > displayAspect) {
        const visibleWidth = displayAspect / imageAspect;
        uMin = (1 - visibleWidth) * 0.5;
        uMax = 1 - uMin;
    } else {
        const visibleHeight = imageAspect / displayAspect;
        vMin = (1 - visibleHeight) * 0.5;
        vMax = 1 - vMin;
    }

    cards.forEach((card, index) => {
        const column = index % grid.columns;
        const row = Math.floor(index / grid.columns);
        const uStart = THREE.MathUtils.lerp(uMin, uMax, column / grid.columns);
        const uEnd = THREE.MathUtils.lerp(uMin, uMax, (column + 1) / grid.columns);
        const vTop = THREE.MathUtils.lerp(vMax, vMin, row / grid.rows);
        const vBottom = THREE.MathUtils.lerp(vMax, vMin, (row + 1) / grid.rows);
        const geometry = cardFrontGeometry.clone();
        const uv = geometry.getAttribute("uv");
        for (let vertex = 0; vertex < uv.count; vertex += 1) {
            const originalU = uv.getX(vertex);
            const originalV = uv.getY(vertex);
            uv.setXY(
                vertex,
                THREE.MathUtils.lerp(uStart, uEnd, originalU),
                THREE.MathUtils.lerp(vBottom, vTop, originalV)
            );
        }
        uv.needsUpdate = true;
        mosaicGeometries.push(geometry);
        card.userData.front.geometry = geometry;
        card.userData.front.material = mosaicMaterial;
    });
}

function planeTarget(index, count) {
    const columns = mosaicLayout?.count === count ? mosaicLayout.columns : Math.ceil(Math.sqrt(count * 1.65));
    const rows = mosaicLayout?.count === count ? mosaicLayout.rows : Math.ceil(count / columns);
    const column = index % columns;
    const row = Math.floor(index / columns);
    const availableWidth = window.innerWidth < 700 ? 8.2 : 13.2;
    const availableHeight = window.innerWidth < 700 ? 9.4 : 7.8;
    const scale = Math.min(0.94, availableWidth / (columns * 0.69), availableHeight / (rows * 0.88));
    const spacingX = 0.69 * scale * 1.015;
    const spacingY = 0.88 * scale * 1.015;
    const position = new THREE.Vector3(
        (column - (columns - 1) / 2) * spacingX,
        ((rows - 1) / 2 - row) * spacingY,
        -1.1
    );
    const fragment = mosaicLayout?.count === count ? mosaicLayout.fragments?.get(index) : null;
    if (fragment) position.add(fragment.offset);
    return {
        position,
        quaternion: fragment ? fragment.quaternion.clone() : new THREE.Quaternion(),
        scale: scale * 0.985 * (fragment?.scale ?? 1),
        normal: new THREE.Vector3(0, 0, 1)
    };
}

function targetFor(layout, index, count) {
    if (layout === "moon") return moonTarget(index, count);
    if (layout === "cube") return cubeTarget(index, count);
    if (layout === "ai") return textTarget("AI", index, count);
    if (layout === "nkust") return textTarget("NKUST", index, count);
    if (layout === "rabbit") return rabbitTarget(index, count);
    if (layout === "plane") return planeTarget(index, count);
    return moonTarget(index, count, true);
}

function keepLotteryPivotCentered() {
    rotatedLotteryCenter
        .copy(LOTTERY_CENTER)
        .multiply(gallery.scale)
        .applyQuaternion(gallery.quaternion);
    gallery.position.copy(LOTTERY_CENTER).sub(rotatedLotteryCenter);
}

function keepDisplayPivotCentered() {
    rotatedDisplayCenter
        .copy(DISPLAY_CENTER)
        .multiply(gallery.scale)
        .applyQuaternion(gallery.quaternion);
    gallery.position.copy(DISPLAY_CENTER).sub(rotatedDisplayCenter);
}

function clearGallery() {
    restorePhotoMaterials();
    cards.forEach(card => gallery.remove(card));
    if (cardBaseInstances) {
        if (Array.isArray(cardBaseInstances)) {
            cardBaseInstances.forEach(mesh => gallery.remove(mesh));
        } else {
            gallery.remove(cardBaseInstances);
        }
    }
    cardBaseInstances = [];
    frontMaterials.forEach(material => {
        material.dispose();
    });
    cards.length = 0;
    frontMaterials.length = 0;
}

function syncCardBaseInstances() {
    if (!cardBaseInstances || cardBaseInstances.length === 0) return;
    
    if (Array.isArray(cardBaseInstances)) {
        cards.forEach(card => {
            const mesh = card.userData.instancedMesh;
            const localIndex = card.userData.localIndex;
            if (!mesh || localIndex === undefined) return;
            
            if (card.visible) {
                card.updateMatrix();
                mesh.setMatrixAt(localIndex, card.matrix);
            } else {
                cardInstanceMatrix.compose(card.position, card.quaternion, invisibleCardScale);
                mesh.setMatrixAt(localIndex, cardInstanceMatrix);
            }
        });
        cardBaseInstances.forEach(mesh => {
            mesh.instanceMatrix.needsUpdate = true;
        });
    }
}

function currentGalleryEntries() {
    const liveEntries = imageLibrary
        .filter(entry => !REFERENCE_IMAGES.includes(entry.url))
        .slice(-MAX_PHOTOS);
    const referenceEntries = imageLibrary.filter(entry => REFERENCE_IMAGES.includes(entry.url));

    const sourceEntries = liveEntries.length > 0 ? liveEntries : referenceEntries;
    if (sourceEntries.length === 0) return [];

    const minimumCount = window.innerWidth >= 700 ? MIN_DESKTOP_CARDS : FALLBACK_CARD_COUNT;
    const entries = [...sourceEntries];
    while (entries.length < minimumCount) {
        const sourceIndex = Math.floor(
            stableRandom(entries.length * 37 + sourceEntries.length * 101) * sourceEntries.length
        );
        entries.push(sourceEntries[sourceIndex]);
    }
    return entries.slice(0, MAX_PHOTOS);
}

function rebuildGallery() {
    if (state !== "idle" || imageLibrary.length === 0) {
        pendingRefresh = true;
        return;
    }

    clearGallery();
    const entries = currentGalleryEntries();
    const count = entries.length;

    // Group cards by entry image to create one InstancedMesh per unique texture
    const entryGroups = new Map();
    for (let i = 0; i < count; i++) {
        const entry = entries[i];
        const groupKey = entry.image ? entry.image.src : entry.url;
        if (!entryGroups.has(groupKey)) {
            entryGroups.set(groupKey, { entry, indices: [] });
        }
        entryGroups.get(groupKey).indices.push(i);
    }

    cardBaseInstances = [];

    // Lightweight Object3D data holders
    for (let index = 0; index < count; index += 1) {
        const entry = entries[index];
        const card = new THREE.Object3D();
        card.userData.entry = entry;
        card.userData.index = index;
        card.userData.front = card;
        const target = targetFor(currentLayout, index, count);
        card.position.copy(target.position);
        card.quaternion.copy(target.quaternion);
        card.scale.setScalar(target.scale);
        card.userData.normal = target.normal;
        cards.push(card);
    }

    // Create materials and InstancedMeshes
    for (const group of entryGroups.values()) {
        const texture = textureForEntry(group.entry);
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            color: 0xffffff,
            toneMapped: true,
            transparent: true,
            alphaTest: 0.1,
            depthWrite: false,
            side: THREE.DoubleSide
        });
        frontMaterials.push(material);

        const instancedMesh = new THREE.InstancedMesh(cardFrontGeometry, material, group.indices.length);
        instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        instancedMesh.frustumCulled = false;
        
        group.indices.forEach((globalIndex, localIndex) => {
            cards[globalIndex].userData.instancedMesh = instancedMesh;
            cards[globalIndex].userData.localIndex = localIndex;
            cards[globalIndex].userData.photoMaterial = material;
        });

        cardBaseInstances.push(instancedMesh);
        gallery.add(instancedMesh);
    }

    if (currentLayout === "plane") {
        prepareMosaic();
        cards.forEach((card, index) => {
            const target = planeTarget(index, cards.length);
            card.position.copy(target.position);
            card.quaternion.copy(target.quaternion);
            card.scale.setScalar(target.scale);
            card.userData.normal = target.normal;
        });
    }
    gallery.rotation.set(0, 0, 0);
    syncCardBaseInstances();
    pendingRefresh = false;
}

function easeInOutCubic(value) {
    return value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function easeOutCubic(value) {
    return 1 - Math.pow(1 - value, 3);
}

function easeOutBack(value) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(value - 1, 3) + c1 * Math.pow(value - 1, 2);
}

function beginMorph(layout, now, isLottery = false) {
    if (cards.length === 0) return;
    if (layout === "plane") prepareMosaic();
    else restorePhotoMaterials();
    const shouldEmitParticles = !isLottery && state === "idle" && layout !== currentLayout;
    cards.forEach((card, index) => {
        const target = isLottery ? moonTarget(index, cards.length, true) : targetFor(layout, index, cards.length);
        card.userData.morph = {
            fromPosition: card.position.clone(),
            fromQuaternion: card.quaternion.clone(),
            fromScale: card.scale.x,
            toPosition: target.position,
            toQuaternion: target.quaternion,
            toScale: target.scale,
            normal: target.normal
        };
    });
    morphStartedAt = now;
    morphing = true;
    if (shouldEmitParticles) startShapeTransitionParticles(layout);
    currentLayout = layout;
}

function updateMorph(now) {
    if (!morphing) return;
    const progress = THREE.MathUtils.clamp((now - morphStartedAt) / MORPH_DURATION, 0, 1);
    const eased = easeInOutCubic(progress);
    cards.forEach(card => {
        const data = card.userData.morph;
        card.position.lerpVectors(data.fromPosition, data.toPosition, eased);
        card.quaternion.slerpQuaternions(data.fromQuaternion, data.toQuaternion, eased);
        card.scale.setScalar(THREE.MathUtils.lerp(data.fromScale, data.toScale, eased));
        if (progress >= 1) card.userData.normal = data.normal;
    });
    if (progress >= 1) morphing = false;
}

function setPhotoCharge(amount, now) {
    frontMaterials.forEach((material, index) => {
        const pulse = 0.5 + Math.sin(now * 4 + index * 0.31) * 0.5;
        material.color.setRGB(
            1 + amount * (0.035 + pulse * 0.025),
            1 + amount * (0.075 + pulse * 0.035),
            1 + amount * (0.14 + pulse * 0.05)
        );
    });
}

function createGlowTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext("2d");
    const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 128);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.16, "rgba(205,224,255,.9)");
    gradient.addColorStop(0.5, "rgba(100,146,255,.25)");
    gradient.addColorStop(1, "rgba(40,80,180,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(canvas);
}

const glowTexture = createGlowTexture();

const transitionParticleCount = window.innerWidth >= 700 ? 720 : 240;
const transitionParticlePositions = new Float32Array(transitionParticleCount * 3);
const transitionParticleVelocities = new Float32Array(transitionParticleCount * 3);
const transitionParticleColors = new Float32Array(transitionParticleCount * 3);
const transitionParticleGeometry = new THREE.BufferGeometry();
transitionParticleGeometry.setAttribute("position", new THREE.BufferAttribute(transitionParticlePositions, 3));
transitionParticleGeometry.setAttribute("color", new THREE.BufferAttribute(transitionParticleColors, 3));

const transitionParticleMaterial = new THREE.PointsMaterial({
    map: glowTexture,
    size: 0.14,
    transparent: true,
    opacity: 0,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    depthTest: true,
    depthWrite: false,
    sizeAttenuation: true
});
const transitionParticles = new THREE.Points(transitionParticleGeometry, transitionParticleMaterial);
transitionParticles.visible = false;
transitionParticles.frustumCulled = false;
scene.add(transitionParticles);

let transitionParticleAge = Infinity;
let transitionBurstId = 0;

const transitionParticleHues = {
    moon: [0.54, 0.59, 0.66],
    cube: [0.6, 0.69, 0.78],
    ai: [0.46, 0.82, 0.94],
    nkust: [0.08, 0.14, 0.6],
    rabbit: [0.53, 0.79, 0.93],
    plane: [0.3, 0.43, 0.51]
};

function startShapeTransitionParticles(layout) {
    if (cards.length === 0) return;
    transitionBurstId += 1;
    transitionParticleAge = 0;
    transitionParticles.visible = true;
    transitionParticleMaterial.opacity = 1;
    gallery.updateMatrixWorld(true);

    const color = new THREE.Color();
    const hues = transitionParticleHues[layout] || transitionParticleHues.moon;
    const center = new THREE.Vector3(0, 0, -1);
    const sourcePosition = new THREE.Vector3();
    const direction = new THREE.Vector3();
    for (let index = 0; index < transitionParticleCount; index += 1) {
        const offset = index * 3;
        const randomSeed = index + transitionBurstId * 811;
        const sourceIndex = Math.floor(stableRandom(randomSeed + 17) * cards.length);
        sourcePosition.copy(cards[sourceIndex].position).applyMatrix4(gallery.matrixWorld);
        sourcePosition.x += (stableRandom(randomSeed + 29) - 0.5) * 0.34;
        sourcePosition.y += (stableRandom(randomSeed + 43) - 0.5) * 0.34;
        sourcePosition.z += (stableRandom(randomSeed + 61) - 0.5) * 0.2;

        direction.copy(sourcePosition).sub(center).normalize();
        direction.x += (stableRandom(randomSeed + 73) - 0.5) * 0.72;
        direction.y += (stableRandom(randomSeed + 89) - 0.5) * 0.72;
        direction.z += (stableRandom(randomSeed + 101) - 0.5) * 0.48;
        direction.normalize();
        const speed = 1.6 + Math.pow(stableRandom(randomSeed + 127), 0.55) * 5.4;

        transitionParticlePositions[offset] = sourcePosition.x;
        transitionParticlePositions[offset + 1] = sourcePosition.y;
        transitionParticlePositions[offset + 2] = sourcePosition.z;
        transitionParticleVelocities[offset] = direction.x * speed;
        transitionParticleVelocities[offset + 1] = direction.y * speed;
        transitionParticleVelocities[offset + 2] = direction.z * speed;

        const hueIndex = Math.floor(stableRandom(randomSeed + 149) * hues.length);
        const hue = hues[hueIndex] + (stableRandom(randomSeed + 157) - 0.5) * 0.035;
        color.setHSL(hue, 0.56 + stableRandom(randomSeed + 163) * 0.34, 0.64 + stableRandom(randomSeed + 181) * 0.3);
        transitionParticleColors[offset] = color.r;
        transitionParticleColors[offset + 1] = color.g;
        transitionParticleColors[offset + 2] = color.b;
    }
    transitionParticleGeometry.getAttribute("position").needsUpdate = true;
    transitionParticleGeometry.getAttribute("color").needsUpdate = true;
}

function updateShapeTransitionParticles(delta) {
    if (!Number.isFinite(transitionParticleAge)) return;
    transitionParticleAge += delta;
    const drag = Math.exp(-delta * 1.08);
    for (let index = 0; index < transitionParticleCount; index += 1) {
        const offset = index * 3;
        transitionParticleVelocities[offset] *= drag;
        transitionParticleVelocities[offset + 1] *= drag;
        transitionParticleVelocities[offset + 2] *= drag;
        transitionParticlePositions[offset] += transitionParticleVelocities[offset] * delta;
        transitionParticlePositions[offset + 1] += transitionParticleVelocities[offset + 1] * delta;
        transitionParticlePositions[offset + 2] += transitionParticleVelocities[offset + 2] * delta;
    }
    transitionParticleGeometry.getAttribute("position").needsUpdate = true;

    const progress = Math.min(transitionParticleAge / 1.65, 1);
    transitionParticleMaterial.opacity = Math.pow(1 - progress, 1.45);
    transitionParticleMaterial.size = 0.14 + Math.sin(Math.min(1, transitionParticleAge / 0.34) * Math.PI) * 0.08;
    if (progress >= 1) {
        transitionParticles.visible = false;
        transitionParticleAge = Infinity;
    }
}

function createLaserTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 64;
    const context = canvas.getContext("2d");
    const horizontal = context.createLinearGradient(0, 0, 512, 0);
    horizontal.addColorStop(0, "rgba(255,255,255,0)");
    horizontal.addColorStop(0.08, "rgba(218,232,255,.18)");
    horizontal.addColorStop(0.3, "rgba(238,246,255,.92)");
    horizontal.addColorStop(0.62, "rgba(180,211,255,.52)");
    horizontal.addColorStop(1, "rgba(110,164,255,0)");
    context.fillStyle = horizontal;
    context.fillRect(0, 0, 512, 64);

    context.globalCompositeOperation = "destination-in";
    const vertical = context.createLinearGradient(0, 0, 0, 64);
    vertical.addColorStop(0, "rgba(255,255,255,0)");
    vertical.addColorStop(0.34, "rgba(255,255,255,.42)");
    vertical.addColorStop(0.5, "rgba(255,255,255,1)");
    vertical.addColorStop(0.66, "rgba(255,255,255,.42)");
    vertical.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = vertical;
    context.fillRect(0, 0, 512, 64);
    return new THREE.CanvasTexture(canvas);
}

const laserTexture = createLaserTexture();
const radiantLightGroup = new THREE.Group();
radiantLightGroup.position.copy(LOTTERY_CENTER);
radiantLightGroup.visible = false;
radiantLightGroup.renderOrder = 0;
scene.add(radiantLightGroup);

const radiantRayMaterials = [];
for (let index = 0; index < 22; index += 1) {
    const angle = stableRandom(index + 2201) * Math.PI * 2;
    const length = 5.5 + stableRandom(index + 2309) * 7.2;
    const startRadius = 2.45 + stableRandom(index + 2411) * 0.85;
    const material = new THREE.MeshBasicMaterial({
        map: laserTexture,
        color: index % 3 === 0 ? 0xffffff : (index % 2 === 0 ? 0xffc800 : 0xff9900),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide
    });
    material.userData.strength = 0.54 + stableRandom(index + 2503) * 0.46;
    material.userData.phase = stableRandom(index + 2609) * Math.PI * 2;
    radiantRayMaterials.push(material);

    const ray = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    const midpoint = startRadius + length * 0.5;
    ray.position.set(Math.cos(angle) * midpoint, Math.sin(angle) * midpoint, -3.28 + stableRandom(index + 2707) * 0.16);
    ray.rotation.z = angle;
    ray.scale.set(length, 0.1 + stableRandom(index + 2801) * 0.21, 1);
    ray.renderOrder = 0;
    radiantLightGroup.add(ray);
}

const lightTrailCount = 34;
const lightTrailPoints = 24;
const lightTrailPositions = new Float32Array(lightTrailCount * lightTrailPoints * 3);
for (let trail = 0; trail < lightTrailCount; trail += 1) {
    const angle = stableRandom(trail + 3001) * Math.PI * 2;
    const startRadius = 2.7 + stableRandom(trail + 3109) * 0.45;
    const length = 5 + stableRandom(trail + 3203) * 6.5;
    const bend = (stableRandom(trail + 3301) - 0.5) * 0.52;
    for (let point = 0; point < lightTrailPoints; point += 1) {
        const progress = point / (lightTrailPoints - 1);
        const pointAngle = angle + bend * progress * progress;
        const radius = startRadius + length * progress;
        const offset = (trail * lightTrailPoints + point) * 3;
        lightTrailPositions[offset] = Math.cos(pointAngle) * radius;
        lightTrailPositions[offset + 1] = Math.sin(pointAngle) * radius;
        lightTrailPositions[offset + 2] = -3.16 + stableRandom(trail + point + 3407) * 0.12;
    }
}

const lightTrailGeometry = new THREE.BufferGeometry();
lightTrailGeometry.setAttribute("position", new THREE.BufferAttribute(lightTrailPositions, 3));
const lightTrailMaterial = new THREE.PointsMaterial({
    map: glowTexture,
    color: 0xffe680,
    size: 0.1,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthTest: true,
    depthWrite: false,
    sizeAttenuation: true
});
const lightTrails = new THREE.Points(lightTrailGeometry, lightTrailMaterial);
lightTrails.renderOrder = 0;
radiantLightGroup.add(lightTrails);

const lunarHaloUniforms = {
    uIntensity: { value: 0 }
};

const lunarHaloGroup = new THREE.Group();
lunarHaloGroup.position.copy(LOTTERY_CENTER);
lunarHaloGroup.visible = false;
scene.add(lunarHaloGroup);

const lunarHaloMaterial = new THREE.SpriteMaterial({
    map: glowTexture,
    color: 0xffd666,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthTest: true,
    depthWrite: false
});
const lunarHalo = new THREE.Sprite(lunarHaloMaterial);
lunarHalo.position.z = -3.35;
lunarHalo.scale.set(9.2, 9.2, 1);
lunarHalo.renderOrder = 1;
lunarHaloGroup.add(lunarHalo);

const lunarRim = new THREE.Mesh(
    new THREE.SphereGeometry(3.3, 64, 40),
    new THREE.ShaderMaterial({
        uniforms: lunarHaloUniforms,
        vertexShader: `
            varying vec3 vNormal;
            varying vec3 vViewDirection;
            void main() {
                vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
                vNormal = normalize(normalMatrix * normal);
                vViewDirection = normalize(-viewPosition.xyz);
                gl_Position = projectionMatrix * viewPosition;
            }
        `,
        fragmentShader: `
            precision highp float;
            uniform float uIntensity;
            varying vec3 vNormal;
            varying vec3 vViewDirection;
            void main() {
                float fresnel = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewDirection))), 2.8);
                vec3 moonlight = mix(vec3(0.42, 0.58, 0.92), vec3(0.9, 0.96, 1.0), fresnel);
                gl_FragColor = vec4(moonlight, fresnel * uIntensity * 0.82);
            }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide
    })
);
lunarRim.renderOrder = 2;
lunarHaloGroup.add(lunarRim);

const lunarHaloLight = new THREE.PointLight(0xb8d1ff, 0, 24, 1.7);
lunarHaloGroup.add(lunarHaloLight);

const sparkCount = window.innerWidth < 700 ? 260 : 520;
const sparkPositions = new Float32Array(sparkCount * 3);
const sparkVelocities = new Float32Array(sparkCount * 3);
const sparkColors = new Float32Array(sparkCount * 3);
const sparkGeometry = new THREE.BufferGeometry();
sparkGeometry.setAttribute("position", new THREE.BufferAttribute(sparkPositions, 3));
sparkGeometry.setAttribute("color", new THREE.BufferAttribute(sparkColors, 3));

const sparkMaterial = new THREE.PointsMaterial({
    map: glowTexture,
    size: 0.34,
    transparent: true,
    opacity: 0,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true
});
const explosionSparks = new THREE.Points(sparkGeometry, sparkMaterial);
explosionSparks.visible = false;
scene.add(explosionSparks);

const shockwaveMaterial = new THREE.MeshBasicMaterial({
    color: 0xcfe0ff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false
});
const shockwave = new THREE.Mesh(new THREE.RingGeometry(0.88, 1, 128), shockwaveMaterial);
shockwave.position.copy(LOTTERY_CENTER);
shockwave.visible = false;
scene.add(shockwave);

const flashMaterial = new THREE.SpriteMaterial({
    map: glowTexture,
    color: 0xeaf2ff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false
});
const explosionFlash = new THREE.Sprite(flashMaterial);
explosionFlash.position.copy(LOTTERY_CENTER);
explosionFlash.visible = false;
scene.add(explosionFlash);

const explosionLight = new THREE.PointLight(0xc8ddff, 0, 34, 1.5);
explosionLight.position.copy(LOTTERY_CENTER);
scene.add(explosionLight);

function resetExplosion() {
    explosionAge = Infinity;
    explosionSparks.visible = false;
    sparkMaterial.opacity = 0;
    shockwave.visible = false;
    shockwaveMaterial.opacity = 0;
    explosionFlash.visible = false;
    flashMaterial.opacity = 0;
    explosionLight.intensity = 0;
    backdropUniforms.uFlash.value = 0;
}

function updateLunarHalo(intensity, pulse = 0) {
    const visibleIntensity = Math.max(0, intensity);
    lunarHaloGroup.visible = visibleIntensity > 0.001;
    lunarHaloUniforms.uIntensity.value = visibleIntensity;
    lunarHaloMaterial.opacity = visibleIntensity * 0.48;
    lunarHaloLight.intensity = visibleIntensity * 28;
    lunarHaloGroup.scale.setScalar(0.82 + visibleIntensity * 0.18 + pulse * 0.018);
}

function updateRadiantLight(intensity, now = 0, burst = 0) {
    const visibleIntensity = Math.max(0, intensity);
    radiantLightGroup.visible = visibleIntensity > 0.001;
    radiantRayMaterials.forEach((material, index) => {
        const shimmer = 0.76 + Math.sin(now * 5.4 + material.userData.phase + index * 0.17) * 0.24;
        material.opacity = Math.min(1, visibleIntensity * material.userData.strength * shimmer);
    });
    lightTrailMaterial.opacity = Math.min(0.92, visibleIntensity * 0.78);
    lightTrailMaterial.size = 0.09 + visibleIntensity * 0.055;
    radiantLightGroup.rotation.z = now * 0.035 + Math.sin(now * 0.22) * 0.035;
    radiantLightGroup.scale.setScalar(0.84 + visibleIntensity * 0.16 + burst * 0.24);
}

function startExplosion() {
    explosionAge = 0;
    explosionSparks.visible = true;
    sparkMaterial.opacity = 1;
    shockwave.visible = true;
    shockwave.scale.setScalar(0.18);
    shockwaveMaterial.opacity = 0.92;
    explosionFlash.visible = true;
    explosionFlash.scale.set(2.5, 2.5, 1);
    flashMaterial.opacity = 0.9;
    explosionLight.intensity = 75;

    const color = new THREE.Color();
    for (let index = 0; index < sparkCount; index += 1) {
        const offset = index * 3;
        const direction = fibonacciDirection(index, sparkCount, Math.random() * 0.3);
        const speed = 5 + Math.pow(Math.random(), 0.46) * 13;
        const radius = 2.5 + Math.random() * 0.7;
        sparkPositions[offset] = LOTTERY_CENTER.x + direction.x * radius;
        sparkPositions[offset + 1] = LOTTERY_CENTER.y + direction.y * radius;
        sparkPositions[offset + 2] = LOTTERY_CENTER.z + direction.z * radius;
        sparkVelocities[offset] = direction.x * speed;
        sparkVelocities[offset + 1] = direction.y * speed;
        sparkVelocities[offset + 2] = direction.z * speed;
        color.setHSL(0.57 + Math.random() * 0.08, 0.28 + Math.random() * 0.3, 0.72 + Math.random() * 0.26);
        sparkColors[offset] = color.r;
        sparkColors[offset + 1] = color.g;
        sparkColors[offset + 2] = color.b;
    }
    sparkGeometry.getAttribute("position").needsUpdate = true;
    sparkGeometry.getAttribute("color").needsUpdate = true;
}

function updateExplosion(delta) {
    if (!Number.isFinite(explosionAge)) return;
    explosionAge += delta;
    const drag = Math.exp(-delta * 0.74);

    for (let index = 0; index < sparkCount; index += 1) {
        const offset = index * 3;
        sparkVelocities[offset] *= drag;
        sparkVelocities[offset + 1] = sparkVelocities[offset + 1] * drag - delta * 0.35;
        sparkVelocities[offset + 2] *= drag;
        sparkPositions[offset] += sparkVelocities[offset] * delta;
        sparkPositions[offset + 1] += sparkVelocities[offset + 1] * delta;
        sparkPositions[offset + 2] += sparkVelocities[offset + 2] * delta;
    }
    sparkGeometry.getAttribute("position").needsUpdate = true;

    const shockProgress = Math.min(explosionAge / 0.9, 1);
    shockwave.quaternion.copy(camera.quaternion);
    shockwave.scale.setScalar(0.18 + easeOutCubic(shockProgress) * 10.5);
    shockwaveMaterial.opacity = (1 - shockProgress) * 0.92;
    explosionFlash.scale.setScalar(2.5 + easeOutCubic(Math.min(explosionAge / 0.52, 1)) * 12);
    flashMaterial.opacity = 0.9 * Math.exp(-explosionAge * 6.8);
    explosionLight.intensity = 75 * Math.exp(-explosionAge * 5.8);
    sparkMaterial.opacity = Math.max(0, 1 - explosionAge / 1.8);
    backdropUniforms.uFlash.value = 0.24 * Math.exp(-explosionAge * 7);
    updateLunarHalo(Math.max(0, 1 - explosionAge / 0.48));
    updateRadiantLight(
        Math.max(0, 1 - explosionAge / 0.78),
        explosionAge,
        easeOutCubic(Math.min(explosionAge / 0.62, 1))
    );

    if (explosionAge > 1.8) resetExplosion();
}

function beginLottery(now) {
    if (state !== "idle" || cards.length === 0) return;
    winnerEntry = window.globalWinnerEntry;
    winnerName.hide();

    if (videoPhase === 'playing') {
        videoPhase = 'morphing';
        video.morphStartTime = now;
    }
    
    state = "gathering";
    lotteryPhaseStartedAt = now;
    gallery.visible = true;
    gallery.rotation.set(0, 0, 0);
    gallery.position.set(0, 0, 0);
    resetExplosion();
    
    // Initialize cards scattered
    cards.forEach((card, index) => {
        const target = moonTarget(index, cards.length, true);
        const normal = target.normal;
        
        // ~25% of cards stay hovering scattered across full screen 3D space
        const isSurrounding = (index % 4 === 0);
        card.userData.isSurrounding = isSurrounding;
        
        let endPos = target.position.clone();
        if (isSurrounding) {
            const sx = (stableRandom(index + 710) - 0.5) * 22.0;
            const sy = (stableRandom(index + 720) - 0.5) * 13.0;
            const sz = (stableRandom(index + 730) - 0.5) * 6.0;
            endPos.set(sx, sy, sz);
        }
        
        card.userData.gather = {
            end: endPos,
            start: endPos.clone().add(normal.clone().multiplyScalar(18 + stableRandom(index) * 12))
        };
        card.position.copy(card.userData.gather.start);
        card.quaternion.copy(target.quaternion);
        card.scale.setScalar(target.scale);
        card.userData.normal = normal;
        card.visible = true;
    });

}

function revealWinner(now) {
    // Safety check for winnerEntry & image
    const entry = winnerEntry || window.globalWinnerEntry;
    if (!entry?.image) return;
    const texture = createPhotoTexture(entry.image);

    // Keep exactly ~25 cards (index % 20 === 0) visible scattered across screen
    cards.forEach((card, index) => {
        const keepVisible = (index % 20 === 0);
        card.visible = keepVisible;
        if (keepVisible) {
            const sx = (stableRandom(index + 910) - 0.5) * 18.0; // Screen width (-9 to +9)
            const sy = (stableRandom(index + 920) - 0.5) * 11.0; // Screen height (-5.5 to +5.5)
            const sz = (stableRandom(index + 930) - 0.5) * 4.0;  // Screen depth
            card.position.set(sx, sy, sz);
            
            tempEuler.set(
                (stableRandom(index + 940) - 0.5) * Math.PI,
                (stableRandom(index + 950) - 0.5) * Math.PI,
                (stableRandom(index + 960) - 0.5) * Math.PI
            );
            card.quaternion.setFromEuler(tempEuler);
            
            card.userData.winnerFloatPhase = stableRandom(index + 800) * Math.PI * 2;
            card.userData.winnerFloatSpeed = 0.4 + stableRandom(index + 850) * 0.6;
        }
    });

    const frontMaterial = new THREE.MeshBasicMaterial({
        map: texture,
        color: 0xffffff,
        transparent: true,
        side: THREE.DoubleSide
    });
    
    const imgAspect = 256 / 324;
    const winnerHeight = 5.2; // Slightly larger to accommodate the polaroid frame
    const winnerWidth = winnerHeight * imgAspect;
    const winnerGeo = new THREE.PlaneGeometry(winnerWidth, winnerHeight);
    
    if (winnerMesh) {
        scene.remove(winnerMesh);
    }
    
    winnerMesh = new THREE.Mesh(winnerGeo, frontMaterial);
    winnerMesh.position.set(0, 0, 3.2); // Positioned in front
    winnerMesh.rotation.set(0, 0, 0);
    winnerMesh.scale.setScalar(0.01);
    winnerMesh.renderOrder = 999;
    winnerMesh.userData.frontMaterial = frontMaterial;
    scene.add(winnerMesh);
    state = "winner-enter";
    lotteryPhaseStartedAt = now;
    updateLunarHalo(0);
    updateRadiantLight(0);
}

function updateLottery(now, delta) {
    
    if (state === "gathering") {
        const elapsed = now - lotteryPhaseStartedAt;
        const charge = THREE.MathUtils.clamp(elapsed / 3.0, 0, 1);
        
        // Cards fly from scattered to the sphere
        cards.forEach((card, index) => {
            if (card.userData.gather) {
                const data = card.userData.gather;
                card.position.copy(data.start).lerp(data.end, easeOutCubic(charge));
            }
        });
        
        // Fade out video sphere as talismans cover it (gone by 50%)
        if (videoPlane && videoPlane.visible) {
            const fadeOut = THREE.MathUtils.clamp(charge / 0.5, 0, 1);
            videoPlane.material.opacity = 1 - fadeOut;
            if (fadeOut >= 1) videoPlane.visible = false;
        }
        
        // Fade in laser energy sphere as video fades
        if (laserEnergySphere) {
            const glowIn = THREE.MathUtils.clamp((charge - 0.2) / 0.8, 0, 1);
            laserEnergySphere.visible = glowIn > 0;
            preExplosionUniforms.uTime.value = now;
            preExplosionUniforms.uBurst.value = glowIn;
            preExplosionUniforms.uIntensity.value = glowIn * 2.2;
            godRayUniforms.uTime.value = now;
            godRayUniforms.uIntensity.value = glowIn * 2.2;
            laserEnergySphere.rotation.y += delta * (0.2 + charge * 0.3);
            laserEnergySphere.rotation.z += delta * 0.1;
            laserEnergySphere.scale.setScalar(1 + glowIn * 0.08);
        }
        
        gallery.rotation.y += delta * (0.16 + charge * 0.26);
        keepLotteryPivotCentered();
        setPhotoCharge(charge, now);
        updateLunarHalo(charge, Math.sin(now * 2.7) * charge);
        updateRadiantLight(charge * 0.88, now);
        if (elapsed >= 3.0) {
            // Hide video sphere and fully activate laser energy sphere
            if (videoPlane) videoPlane.visible = false;
            if (laserEnergySphere) {
                laserEnergySphere.visible = true;
                preExplosionUniforms.uIntensity.value = 1.2;
            }
            
            cards.forEach((card, index) => {
                const normal = card.userData.normal || fibonacciDirection(index, cards.length);
                card.userData.explosion = {
                    start: card.position.clone(),
                    startQuaternion: card.quaternion.clone(),
                    velocity: normal.clone().multiplyScalar(8 + stableRandom(index + 1001) * 5).add(
                        new THREE.Vector3(
                            stableRandom(index + 1103) - 0.5,
                            stableRandom(index + 1201) - 0.5,
                            stableRandom(index + 1301) - 0.5
                        ).multiplyScalar(2.2)
                    ),
                    axis: new THREE.Vector3(
                        stableRandom(index + 1409) - 0.5,
                        stableRandom(index + 1511) - 0.5,
                        stableRandom(index + 1601) - 0.5
                    ).normalize()
                };
            });
            state = "exploding";
            lotteryPhaseStartedAt = now;
            startExplosion();
        }
        return;
    }

    if (state === "exploding") {
        const progress = THREE.MathUtils.clamp((now - lotteryPhaseStartedAt) / 0.8, 0, 1);
        const eased = easeOutCubic(progress);
        cards.forEach(card => {
            const data = card.userData.explosion;
            if (data) {
                card.position.copy(data.start).addScaledVector(data.velocity, eased);
                tempQuaternion.setFromAxisAngle(data.axis, eased * 5.2);
                card.quaternion.copy(data.startQuaternion).multiply(tempQuaternion);
                card.scale.setScalar(1.06 - eased * 0.58);
            }
        });
        if (progress >= 1) revealWinner(now);
        return;
    }

    if (state === "winner-enter" && winnerMesh) {
        const progress = THREE.MathUtils.clamp((now - lotteryPhaseStartedAt) / 0.8, 0, 1);
        winnerMesh.scale.setScalar(Math.max(0.01, easeOutBack(progress) * 1.0));
        winnerMesh.position.set(0, THREE.MathUtils.lerp(-1.0, 0.0, easeOutCubic(progress)), 3.2);
        if (progress >= 1) {
            state = "winner";
            winnerName.show();
            drawButton.disabled = false;
            drawButton.querySelector("span").textContent = "再抽一次";
            drawButton.setAttribute("aria-label", "再抽一次");
            controls.enabled = true;
        }
        return;
    }

    if (state === "winner" && winnerMesh) {
        winnerMesh.position.y = 0.15 + Math.sin(now * 1.2) * 0.065;
        winnerMesh.rotation.y = 0.04 + Math.sin(now * 0.63) * 0.035;
        
        // Gently float surrounding talismans across full screen
        cards.forEach((card, index) => {
            if (card.visible) {
                const phase = card.userData.winnerFloatPhase || 0;
                const speed = card.userData.winnerFloatSpeed || 0.5;
                card.position.y += Math.sin(now * speed + phase) * 0.002;
                card.rotation.z += delta * 0.08;
                card.rotation.x += delta * 0.04;
            }
        });
    }
}

function restoreGallery(now) {
    if (winnerMesh) {
        winnerMesh.userData.frontMaterial?.map?.dispose();
        winnerMesh.userData.frontMaterial?.dispose();
        scene.remove(winnerMesh);
        winnerMesh = null;
    }
    cards.forEach(card => { card.visible = true; });
    gallery.scale.setScalar(1);
    gallery.rotation.set(0, 0, 0);
    gallery.position.set(0, 0, 0);
    state = "idle";
    controls.enabled = true;
    currentLayout = "moon";
    currentLayoutIndex = 0;
    lastShapeChangeAt = now;
    drawButton.disabled = false;
    drawButton.querySelector("span").textContent = "抽獎";
    drawButton.setAttribute("aria-label", "開始抽獎");
    setPhotoCharge(0, now);
    updateLunarHalo(0);
    updateRadiantLight(0);
    beginMorph("moon", now);
    if (pendingRefresh) rebuildGallery();
}

function updateIdle(now, delta) {
    if (state !== "idle") return;
    if (now - lastShapeChangeAt >= SHAPE_INTERVAL / 1000 && !morphing) {
        currentLayoutIndex = (currentLayoutIndex + 1) % LAYOUTS.length;
        beginMorph(LAYOUTS[currentLayoutIndex], now);
        lastShapeChangeAt = now;
    }

    const targetRotation = currentLayout === "plane" ? 0 : Math.sin(now * 0.16) * 0.16;
    gallery.rotation.y = THREE.MathUtils.lerp(gallery.rotation.y, targetRotation, 1 - Math.exp(-delta * 0.7));
    gallery.rotation.x = currentLayout === "plane" ? 0 : Math.sin(now * 0.11) * 0.035;
    if (currentLayout === "plane") {
        gallery.position.lerp(galleryOrigin, 1 - Math.exp(-delta * 4));
    } else {
        keepDisplayPivotCentered();
    }

    cards.forEach((card, index) => {
        const floatAmount = morphing ? 0 : Math.sin(now * 0.72 + index * 0.37) * 0.012;
        card.position.y += floatAmount * delta;
    });
}

function updateCameraMotion(now, delta) {
    const canDrift = state === "idle" && controls.enabled && now - lastInteractionAt > 2.5;
    if (!canDrift) return;
    cameraOffset.copy(camera.position).sub(controls.target);
    cameraSpherical.setFromVector3(cameraOffset);
    const blend = 1 - Math.exp(-delta * 0.17);
    cameraSpherical.radius = THREE.MathUtils.lerp(cameraSpherical.radius, 15 + Math.sin(now * 0.12) * 0.55, blend);
    cameraSpherical.theta = THREE.MathUtils.lerp(cameraSpherical.theta, Math.sin(now * 0.075) * 0.12, blend);
    cameraSpherical.phi = THREE.MathUtils.lerp(cameraSpherical.phi, Math.PI / 2 - 0.02 + Math.sin(now * 0.09) * 0.035, blend);
    cameraOffset.setFromSpherical(cameraSpherical);
    camera.position.copy(controls.target).add(cameraOffset);
}

async function refreshPhotos() {
    try {
        const response = await fetch(`/api/photos/${localDateString()}`, { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json();
        const photoUrls = (data.images || []).slice(-MAX_PHOTOS);
        const activeUrls = new Set(photoUrls);
        const results = await Promise.all(photoUrls.map(addImage));
        let removedAny = false;

        imageLibrary.forEach(entry => {
            if (!REFERENCE_IMAGES.includes(entry.url) && !activeUrls.has(entry.url)) {
                entry.texture?.dispose();
                entry.mosaicTexture?.dispose();
                loadedUrls.delete(entry.url);
                removedAny = true;
            }
        });

        const referenceEntries = imageLibrary.filter(entry => REFERENCE_IMAGES.includes(entry.url));
        const liveEntriesByUrl = new Map(
            imageLibrary
                .filter(entry => activeUrls.has(entry.url))
                .map(entry => [entry.url, entry])
        );
        const orderedLiveEntries = photoUrls.map(url => liveEntriesByUrl.get(url)).filter(Boolean);
        imageLibrary.splice(0, imageLibrary.length, ...referenceEntries, ...orderedLiveEntries);

        if (results.some(Boolean) || removedAny) rebuildGallery();
    } catch {
        // Reference images keep the experience available when today's gallery is offline.
    }
}

function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height, false);
    renderer.getDrawingBufferSize(backdropUniforms.uResolution.value);
    camera.aspect = width / height;
    camera.fov = width < height ? 58 : 43;
    camera.updateProjectionMatrix();
}


const video = document.getElementById('sourceVideo');
const soundtrack = document.getElementById('soundtrack');
soundtrack.volume = 0.9;
const entryPlayback = createExperiencePlayback(video, { volume: 0.9, companions: [soundtrack] });
let videoPhase = 'playing';
let videoPlane;
let laserEnergySphere;
let planePositions = [];
let spherePositions = [];

const preExplosionUniforms = {
    uTime: { value: 0 },
    uIntensity: { value: 0 },
    uBurst: { value: 0 }
};

const energyVertexShader = `
    varying vec3 vNormal;
    varying vec3 vViewPosition;
    varying vec3 vWorldPosition;
    varying vec2 vUv;

    void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewPosition = -mvPosition.xyz;
        vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * mvPosition;
    }
`;

const energyFragmentShader = `
    precision highp float;

    uniform float uTime;
    uniform float uIntensity;
    uniform float uBurst;
    uniform float uGlowLayer;

    varying vec3 vNormal;
    varying vec3 vViewPosition;
    varying vec3 vWorldPosition;

    void main() {
        vec3 normal = normalize(vNormal);
        vec3 viewDir = normalize(vViewPosition);
        float fresnel = pow(1.0 - max(0.0, dot(normal, viewDir)), 1.5);

        vec3 coreWhiteGold  = vec3(1.0, 0.98, 0.88);
        vec3 brightGold     = vec3(1.0, 0.75, 0.15);
        vec3 deepAmberGold  = vec3(1.0, 0.50, 0.05);

        float pulse = 0.88 + 0.12 * sin(uTime * 4.0);
        float burst = clamp(uBurst, 0.0, 1.0);

        if (uGlowLayer > 0.5) {
            float auraFresnel = pow(1.0 - max(0.0, dot(normal, viewDir)), 2.4);
            vec3 col = mix(brightGold * 2.0, deepAmberGold * 1.5, auraFresnel);
            float alpha = auraFresnel * pulse * uIntensity * (0.9 + burst * 0.4);
            gl_FragColor = vec4(col * (2.2 + burst * 1.5), alpha);
        } else {
            vec3 col = mix(coreWhiteGold * 2.8, brightGold * 2.0, fresnel);
            float alpha = (0.85 + fresnel * 0.15) * pulse * uIntensity;
            gl_FragColor = vec4(col, alpha);
        }
    }
`;

const godRayFragmentShader = `
    precision highp float;
    uniform float uTime;
    uniform float uIntensity;
    varying vec2 vUv;

    void main() {
        vec2 p = vUv - vec2(0.5);
        float dist = length(p);
        float angle = atan(p.y, p.x);
        
        float ray1 = pow(max(0.0, sin(angle * 14.0 + uTime * 2.1)), 3.5);
        float ray2 = pow(max(0.0, cos(angle * 26.0 - uTime * 2.8)), 4.5);
        float ray3 = pow(max(0.0, sin(angle * 38.0 + uTime * 1.2)), 3.0);
        float ray4 = pow(max(0.0, cos(angle * 52.0 - uTime * 3.5)), 5.5);
        
        float rays = (ray1 * 0.45 + ray2 * 0.3 + ray3 * 0.15 + ray4 * 0.1);
        
        float decay = exp(-dist * 4.5);
        float core = exp(-dist * 15.0);
        
        vec3 coreColor  = vec3(1.0, 0.98, 0.88);
        vec3 rayColor   = vec3(1.0, 0.75, 0.12);
        vec3 outerColor = vec3(1.0, 0.45, 0.02);
        
        vec3 col = mix(coreColor * 3.0, rayColor * 2.2, smoothstep(0.04, 0.22, dist));
        col += rayColor * rays * 4.2 * decay;
        col = mix(col, outerColor * 1.4, smoothstep(0.22, 0.48, dist));
        
        float alpha = (core * 3.0 + decay * (0.4 + rays * 1.4)) * uIntensity;
        gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
    }
`;

const godRayUniforms = {
    uTime: { value: 0 },
    uIntensity: { value: 0 }
};

async function init() {
    const winnerCandidates = await getPhotoCandidateEntries();
    const winner = pickRandomPhotoEntry(winnerCandidates);
    if (!winner) {
        stage.classList.add("has-lottery-error");
        stage.dataset.error = "今天尚未有可抽獎的照片";
        return;
    }
    winnerName.set(winner.name);
    const winnerImg = await loadImage(winner.url);
    window.globalWinnerEntry = { ...winner, image: winnerImg };

    const talismanUrls = [
        '/images/符咒.png',
        '/images/符咒2.png',
        '/images/符咒3.png',
        '/images/符咒4.png',
        '/images/符咒5.png'
    ];
    const talismanImgs = await Promise.all(talismanUrls.map(url => loadImage(url)));
    for (let i = 0; i < MAX_PHOTOS; i++) {
        const imgIndex = i % talismanImgs.length;
        imageLibrary.push({ url: talismanUrls[imgIndex] + '?' + i, image: talismanImgs[imgIndex] });
    }
    rebuildGallery();
    gallery.visible = false;
    
    // Create video material
    const videoTexture = new THREE.VideoTexture(video);
    videoTexture.colorSpace = THREE.SRGBColorSpace;
    const videoMat = new THREE.MeshBasicMaterial({ map: videoTexture, transparent: true, side: THREE.DoubleSide });
    
    const startVideo = () => {
        const distance = camera.position.z - 2; // videoPlane is at z = 2
        const vFOV = THREE.MathUtils.degToRad(camera.fov);
        const visibleHeight = 2 * Math.tan(vFOV / 2) * distance;
        const visibleWidth = visibleHeight * camera.aspect;

        const videoAspect = video.videoWidth / video.videoHeight || (16 / 9);

        let width, height;
        if (videoAspect > camera.aspect) {
            height = visibleHeight * 1.02; // slight scale buffer for seamless edge
            width = height * videoAspect;
        } else {
            width = visibleWidth * 1.02;
            height = width / videoAspect;
        }
        
        const geometry = new THREE.PlaneGeometry(width, height, 32, 32);
        videoPlane = new THREE.Mesh(geometry, videoMat);
        videoPlane.position.z = 2;
        videoPlane.renderOrder = -1; // Behind talismans
        scene.add(videoPlane);
        
        // Create laser energy sphere shader replacing simple glowSphere
        const preExplosionGeometry = new THREE.SphereGeometry(3.05, 48, 32);
        laserEnergySphere = new THREE.Group();
        const preExplosionSurface = new THREE.Mesh(
            preExplosionGeometry,
            new THREE.ShaderMaterial({
                uniforms: { ...preExplosionUniforms, uGlowLayer: { value: 0 } },
                vertexShader: energyVertexShader,
                fragmentShader: energyFragmentShader,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                depthTest: true,
                side: THREE.FrontSide
            })
        );
        const preExplosionGlow = new THREE.Mesh(
            preExplosionGeometry,
            new THREE.ShaderMaterial({
                uniforms: { ...preExplosionUniforms, uGlowLayer: { value: 1 } },
                vertexShader: energyVertexShader,
                fragmentShader: energyFragmentShader,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                depthTest: true,
                side: THREE.FrontSide
            })
        );
        preExplosionGlow.scale.setScalar(1.015);
        laserEnergySphere.add(preExplosionSurface);
        laserEnergySphere.add(preExplosionGlow);

        // Add 3D Volumetric God Rays Shader Planes
        const godRayGeo = new THREE.PlaneGeometry(18, 18);
        const godRayMat = new THREE.ShaderMaterial({
            uniforms: godRayUniforms,
            vertexShader: energyVertexShader,
            fragmentShader: godRayFragmentShader,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: false,
            side: THREE.DoubleSide
        });

        for (let i = 0; i < 4; i++) {
            const godRayMesh = new THREE.Mesh(godRayGeo, godRayMat);
            godRayMesh.rotation.z = (Math.PI / 4) * i;
            godRayMesh.rotation.y = (Math.PI / 6) * i;
            godRayMesh.renderOrder = 3;
            laserEnergySphere.add(godRayMesh);
        }

        laserEnergySphere.position.copy(LOTTERY_CENTER);
        laserEnergySphere.visible = false;
        scene.add(laserEnergySphere);
        
        const posAttribute = geometry.attributes.position;
        const sphereRadius = 3.42;
        
        for (let i = 0; i < posAttribute.count; i++) {
            const x = posAttribute.getX(i);
            const y = posAttribute.getY(i);
            const z = posAttribute.getZ(i);
            planePositions.push(new THREE.Vector3(x, y, z));
            
            const u = (x / width) + 0.5;
            const v = (y / height) + 0.5;
            
            const theta = (u - 0.5) * Math.PI * 2; 
            const phi = (v - 0.5) * Math.PI; 
            
            const sx = sphereRadius * Math.cos(phi) * Math.sin(theta);
            const sy = sphereRadius * Math.sin(phi);
            const sz = sphereRadius * Math.cos(phi) * Math.cos(theta);
            
            spherePositions.push(new THREE.Vector3(sx, sy, sz));
        }
        
        entryPlayback.play().catch(e => console.log('Video play error:', e));
    };

    if (video.readyState >= 1) {
        startVideo();
    } else {
        video.addEventListener('loadedmetadata', startVideo);
    }

    const clock = new THREE.Clock();
    renderer.setAnimationLoop(() => {
        const delta = Math.min(clock.getDelta(), 0.05);
        const elapsed = clock.elapsedTime;
        const now = performance.now() / 1000;
        
        // Video Logic
        if (videoPhase === 'playing') {
            // Check if video is near end (3.0s remaining)
            if (video.duration > 0 && video.currentTime >= video.duration - 3.0) {
                videoPhase = 'morphing';
                video.morphStartTime = now;
                // Start talismans flying in at the same time as the video morphs
                gallery.visible = true;
                beginLottery(now);
            }
        } else if (videoPhase === 'morphing' && videoPlane) {
            let progress = Math.min((now - video.morphStartTime) / 3.0, 1);
            progress = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
            
            const posAttribute = videoPlane.geometry.attributes.position;
            for (let i = 0; i < posAttribute.count; i++) {
                const p1 = planePositions[i];
                const p2 = spherePositions[i];
                posAttribute.setXYZ(
                    i,
                    THREE.MathUtils.lerp(p1.x, p2.x, progress),
                    THREE.MathUtils.lerp(p1.y, p2.y, progress),
                    THREE.MathUtils.lerp(p1.z, p2.z, progress)
                );
            }
            posAttribute.needsUpdate = true;
            videoPlane.position.z = THREE.MathUtils.lerp(2, LOTTERY_CENTER.z, progress);
            
            if (progress >= 1) {
                videoPhase = 'lottery';
            }
        }

        updateMorph(now);
        if (state !== "idle" || videoPhase === 'morphing' || videoPhase === 'lottery') {
            updateLottery(now, delta);
            updateExplosion(delta);
            updateShapeTransitionParticles(delta);
            
            // Animate and fade out laser energy sphere during explosion
            if (laserEnergySphere && laserEnergySphere.visible && state === "exploding") {
                const expProgress = THREE.MathUtils.clamp((now - lotteryPhaseStartedAt) / 0.5, 0, 1);
                preExplosionUniforms.uTime.value = now;
                preExplosionUniforms.uBurst.value = 1.0;
                preExplosionUniforms.uIntensity.value = Math.max(0, 2.2 * (1 - expProgress));
                godRayUniforms.uTime.value = now;
                godRayUniforms.uIntensity.value = Math.max(0, 2.2 * (1 - expProgress));
                laserEnergySphere.rotation.y += delta * 0.5;
                laserEnergySphere.scale.setScalar(1.08 + easeOutCubic(expProgress) * 2.0);
                if (expProgress >= 1) laserEnergySphere.visible = false;
            }
            
            if (state === "winner-enter" || state === "winner") {
                if (videoPlane && videoPlane.visible) videoPlane.visible = false;
                if (laserEnergySphere) laserEnergySphere.visible = false;
            }
        }
        
        controls.update();
        syncCardBaseInstances();
        backdropUniforms.uTime.value = elapsed;
        backdropUniforms.uViewOffset.value.set(camera.rotation.y, camera.rotation.x);
        renderer.render(scene, camera);
    });
}
drawButton.addEventListener("click", () => {
    const now = performance.now() / 1000;
    if (state === "winner") {
        restoreGallery(now);
        requestAnimationFrame(() => beginLottery(performance.now() / 1000));
        return;
    }
    beginLottery(now);
});

renderer.domElement.addEventListener("wheel", () => {
    lastInteractionAt = performance.now() / 1000;
}, { passive: true });

controls.addEventListener("start", () => {
    lastInteractionAt = performance.now() / 1000;
});

controls.addEventListener("end", () => {
    lastInteractionAt = performance.now() / 1000;
});

window.addEventListener("resize", resize, { passive: true });
window.addEventListener("pagehide", () => renderer.setAnimationLoop(null), { once: true });

resize();
init();
