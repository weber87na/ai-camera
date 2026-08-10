import * as THREE from "three";
import { createExperiencePlayback } from "/experience-playback.js?v=2";

const stage = document.querySelector("#painterStage");
const video = document.querySelector("#sourceVideo");
const soundtrack = document.querySelector("#soundtrack");
soundtrack.volume = 0.9;
const entryPlayback = createExperiencePlayback(video, { volume: 0.9, companions: [soundtrack] });
const loadingMessage = document.querySelector("#loadingMessage");

const FALLBACK_WINNER = "/images/style-04.webp";
const ABSORB_START = 3.75;
const ABSORB_FADE_OUT_START = 6.9;
const ABSORB_FADE_OUT_END = 7.12;
const PRINT_START = 5.45;
const PRINT_DURATION = 2.05;
const DEFAULT_SPIRAL_PALETTE = [
    0xe84b3c,
    0xf2a72e,
    0x25a9b8,
    0x5a55c8,
    0xd94d91
];

const scene = new THREE.Scene();
const camera = new THREE.Camera();
const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "high-performance"
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth < 700 ? 1.5 : 2));
// This shader is a display-space compositor: keeping the renderer and both
// media textures untagged preserves the exact colors decoded by the browser.
// Applying the renderer's sRGB conversion here would also re-encode the video.
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
stage.appendChild(renderer.domElement);

const videoTexture = new THREE.VideoTexture(video);
videoTexture.colorSpace = THREE.NoColorSpace;
videoTexture.minFilter = THREE.LinearFilter;
videoTexture.magFilter = THREE.LinearFilter;

const winnerTexture = new THREE.Texture();
winnerTexture.colorSpace = THREE.NoColorSpace;
winnerTexture.minFilter = THREE.LinearFilter;
winnerTexture.magFilter = THREE.LinearFilter;

const uniforms = {
    uVideo: { value: videoTexture },
    uWinner: { value: winnerTexture },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uVideoResolution: { value: new THREE.Vector2(1, 1) },
    uWinnerResolution: { value: new THREE.Vector2(1, 1) },
    uPalette: { value: DEFAULT_SPIRAL_PALETTE.map((hex) => new THREE.Color(hex)) },
    // The supplied 1280x720 clip places the white painting canvas here.
    // Keeping the print inside this rect makes the video remain visible.
    uCanvasRect: { value: new THREE.Vector4(0.155, 0.075, 0.69, 0.882) },
    uTime: { value: 0 },
    uAbsorb: { value: 0 },
    uPrint: { value: 0 }
};

const vertexShader = `
    varying vec2 vUv;

    void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
    }
`;

const fragmentShader = `
    precision highp float;

    uniform sampler2D uVideo;
    uniform sampler2D uWinner;
    uniform vec2 uResolution;
    uniform vec2 uVideoResolution;
    uniform vec2 uWinnerResolution;
    uniform vec3 uPalette[5];
    uniform vec4 uCanvasRect;
    uniform float uTime;
    uniform float uAbsorb;
    uniform float uPrint;

    varying vec2 vUv;

    const vec3 PAPER = vec3(0.965, 0.952, 0.916);

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

    // Keep the media filling the screen without stretching it. The same
    // mapping is used for the video and the image printed above it.
    vec2 coverUv(vec2 uv, vec2 sourceSize, vec2 targetSize) {
        float sourceAspect = sourceSize.x / max(sourceSize.y, 1.0);
        float targetAspect = targetSize.x / max(targetSize.y, 1.0);
        if (sourceAspect > targetAspect) {
            float crop = targetAspect / sourceAspect;
            uv.x = (uv.x - 0.5) * crop + 0.5;
        } else {
            float crop = sourceAspect / targetAspect;
            uv.y = (uv.y - 0.5) * crop + 0.5;
        }
        return uv;
    }

    vec4 sampleVideo(vec2 contentUv) {
        vec2 uv = coverUv(contentUv, uVideoResolution, uResolution);
        float inside = step(0.0, contentUv.x) * step(contentUv.x, 1.0)
            * step(0.0, contentUv.y) * step(contentUv.y, 1.0);
        vec3 color = texture2D(uVideo, clamp(uv, 0.0, 1.0)).rgb;
        return vec4(mix(PAPER, color, inside), inside);
    }

    vec2 containUv(vec2 uv, vec2 sourceSize, vec2 targetSize) {
        float sourceAspect = sourceSize.x / max(sourceSize.y, 1.0);
        float targetAspect = targetSize.x / max(targetSize.y, 1.0);
        if (sourceAspect > targetAspect) {
            float fit = targetAspect / sourceAspect;
            uv.y = (uv.y - 0.5) / fit + 0.5;
        } else {
            float fit = sourceAspect / targetAspect;
            uv.x = (uv.x - 0.5) / fit + 0.5;
        }
        return uv;
    }

    vec3 paletteColor(float phase) {
        float slot = fract(phase) * 5.0;
        if (slot < 1.0) return mix(uPalette[0], uPalette[1], slot);
        if (slot < 2.0) return mix(uPalette[1], uPalette[2], slot - 1.0);
        if (slot < 3.0) return mix(uPalette[2], uPalette[3], slot - 2.0);
        if (slot < 4.0) return mix(uPalette[3], uPalette[4], slot - 3.0);
        return mix(uPalette[4], uPalette[0], slot - 4.0);
    }

    void main() {
        float absorb = smoothstep(0.0, 1.0, uAbsorb);
        vec3 color = sampleVideo(vUv).rgb;
        const float TAU = 6.2831853;

        // uCanvasRect is measured in source-video UV space. Using the same
        // cover mapping as the base video keeps the effect locked to the real
        // canvas at every viewport aspect ratio.
        vec2 videoUv = coverUv(vUv, uVideoResolution, uResolution);
        vec2 canvasUv = (videoUv - uCanvasRect.xy) / uCanvasRect.zw;
        float canvasEdge = min(
            min(canvasUv.x, 1.0 - canvasUv.x),
            min(canvasUv.y, 1.0 - canvasUv.y)
        );
        float canvasMask = smoothstep(0.0, 0.018, canvasEdge);

        // The clip already contains the complete paint spiral. Preserve its
        // geometry and only add a very small pigment-density lift, preventing
        // a second synthetic spiral from fighting the recorded movement.
        float videoLuma = dot(color, vec3(0.299, 0.587, 0.114));
        vec3 denserPigment = clamp(mix(vec3(videoLuma), color, 1.045), 0.0, 1.0);
        color = mix(color, denserPigment, absorb * canvasMask * 0.14);

        // The winner stays upright and is revealed by the same paint clearing
        // already visible in the clip. A softly irregular spiral front only
        // controls opacity; it never twists the image into a competing vortex.
        float printProgress = smoothstep(0.0, 1.0, uPrint);
        float canvasSoft = smoothstep(0.0, 0.03, canvasEdge);
        float canvasMargin = 0.045;
        vec2 photoUv = (canvasUv - vec2(canvasMargin)) / (1.0 - canvasMargin * 2.0);
        float photoEdge = min(
            min(photoUv.x, 1.0 - photoUv.x),
            min(photoUv.y, 1.0 - photoUv.y)
        );
        float photoSoft = smoothstep(-0.035, 0.045, photoEdge);
        vec2 imageUv = containUv(
            photoUv,
            uWinnerResolution,
            uCanvasRect.zw * uVideoResolution * (1.0 - canvasMargin * 2.0)
        );
        float imageEdge = min(
            min(imageUv.x, 1.0 - imageUv.x),
            min(imageUv.y, 1.0 - imageUv.y)
        );
        float imageEdgeNoise = (noise2(imageUv * 13.0 + vec2(uTime * 0.04, -uTime * 0.03)) - 0.5) * 0.045;
        float imageSoft = smoothstep(-0.035, 0.045, imageEdge + imageEdgeNoise);
        // Both sources are sampled in display space so the final print and
        // the source video retain their original visible colors.
        vec3 printed = texture2D(uWinner, clamp(imageUv, 0.0, 1.0)).rgb;

        // Use an ellipse that follows the photo's own proportions. It keeps
        // the round painted-in silhouette while revealing substantially more
        // of portrait and landscape winners than a strict pixel-perfect circle.
        vec2 imageQ = (imageUv - 0.5) / 0.5;
        float printRadius = length(imageQ);
        float printAngle = atan(imageQ.y, imageQ.x);
        float broadNoise = noise2(photoUv * 10.0 + vec2(uTime * 0.018, -uTime * 0.012));
        float fineNoise = noise2(photoUv * 31.0 - vec2(uTime * 0.025, uTime * 0.016));
        float spiralCoordinate = printRadius
            + sin(printAngle * 2.0 - printRadius * 6.4 + broadNoise * 0.72) * 0.07
            + (fineNoise - 0.5) * 0.105;

        // White areas exposed by the source paint animation advance the photo
        // slightly sooner, making both layers feel like one continuous action.
        vec3 localVideo = texture2D(uVideo, clamp(videoUv, 0.0, 1.0)).rgb;
        float paperDistance = length(localVideo - PAPER);
        float clearedCanvas = 1.0 - smoothstep(0.12, 0.62, paperDistance);
        float circularStage = smoothstep(0.0, 0.9, printProgress);
        float revealRadius = mix(-0.10, 1.0, circularStage);
        revealRadius += (clearedCanvas - 0.5) * 0.055 * (1.0 - printProgress);
        float printMask = 1.0 - smoothstep(
            revealRadius - 0.115,
            revealRadius + 0.055,
            spiralCoordinate
        );
        printMask *= canvasSoft * photoSoft * imageSoft * smoothstep(0.0, 0.28, printProgress);

        float joiningEdge = 1.0 - smoothstep(
            0.025,
            0.16,
            abs(spiralCoordinate - revealRadius)
        );
        joiningEdge *= canvasSoft * photoSoft * imageSoft
            * smoothstep(0.03, 0.24, printProgress) * (1.0 - printProgress * 0.5);
        vec3 joiningPigment = mix(localVideo, printed, 0.48);
        color = mix(color, joiningPigment, joiningEdge * 0.28);
        color = mix(color, printed, clamp(printMask, 0.0, 1.0));

        gl_FragColor = vec4(color, 1.0);
    }
`;

const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
    toneMapped: false
});

const screen = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
screen.frustumCulled = false;
scene.add(screen);

const textureLoader = new THREE.TextureLoader();
textureLoader.setCrossOrigin("anonymous");

let state = "loading";
let winnerUrl = FALLBACK_WINNER;
let videoDuration = 8;
let winnerReady = false;
let printStartedAt = null;

function localDateString() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${now.getFullYear()}-${month}-${day}`;
}

function isUsableImageUrl(value) {
    if (!value || typeof value !== "string") return false;
    if (value.startsWith("data:image/")) return true;
    try {
        const url = new URL(value, window.location.origin);
        return ["http:", "https:"].includes(url.protocol);
    } catch {
        return false;
    }
}

function readImageOverride() {
    const params = new URLSearchParams(window.location.search);
    const queryValue = params.get("winner") || params.get("image") || params.get("winnerImage");
    if (isUsableImageUrl(queryValue)) return queryValue;

    for (const key of ["painterWinnerImage", "aiCameraWinnerImage", "winnerImage", "resultImage"]) {
        try {
            const storedValue = window.localStorage.getItem(key);
            if (isUsableImageUrl(storedValue)) return storedValue;
        } catch {
            // Private browsing can deny localStorage; the API fallback still works.
        }
    }
    return "";
}

async function getRandomPhotoUrl() {
    try {
        const response = await fetch(`/api/photos/${localDateString()}`, { cache: "no-store" });
        if (!response.ok) return "";
        const data = await response.json();
        const images = Array.isArray(data.images) ? data.images.filter(isUsableImageUrl) : [];
        if (images.length === 0) return "";
        return images[Math.floor(Math.random() * images.length)];
    } catch {
        return "";
    }
}

function loadImageTexture(url) {
    return new Promise((resolve, reject) => {
        textureLoader.load(
            url,
            (texture) => {
                texture.colorSpace = THREE.NoColorSpace;
                texture.minFilter = THREE.LinearFilter;
                texture.magFilter = THREE.LinearFilter;
                resolve(texture);
            },
            undefined,
            reject
        );
    });
}

function rgbToHsv(red, green, blue) {
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const delta = max - min;
    let hue = 0;

    if (delta > 0) {
        if (max === red) hue = ((green - blue) / delta) % 6;
        else if (max === green) hue = (blue - red) / delta + 2;
        else hue = (red - green) / delta + 4;
        hue /= 6;
        if (hue < 0) hue += 1;
    }

    return {
        h: hue,
        s: max === 0 ? 0 : delta / max,
        v: max
    };
}

function hsvToRgb(hue, saturation, value) {
    const sector = (hue * 6) % 6;
    const index = Math.floor(sector);
    const fraction = sector - index;
    const p = value * (1 - saturation);
    const q = value * (1 - fraction * saturation);
    const t = value * (1 - (1 - fraction) * saturation);
    const colors = [
        [value, t, p],
        [q, value, p],
        [p, value, t],
        [p, q, value],
        [t, p, value],
        [value, p, q]
    ];
    const color = colors[(index + 6) % 6];
    return { r: color[0], g: color[1], b: color[2] };
}

function analyzeImagePalette(image) {
    if (!image) return null;

    const sampleSize = 48;
    const canvas = document.createElement("canvas");
    canvas.width = sampleSize;
    canvas.height = sampleSize;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;

    try {
        context.drawImage(image, 0, 0, sampleSize, sampleSize);
    } catch {
        // A remote image without CORS permission cannot be sampled; the
        // default palette remains a safe and colorful fallback.
        return null;
    }

    let pixels;
    try {
        pixels = context.getImageData(0, 0, sampleSize, sampleSize).data;
    } catch {
        return null;
    }

    const points = [];
    for (let index = 0; index < pixels.length; index += 4) {
        const alpha = pixels[index + 3] / 255;
        if (alpha < 0.5) continue;
        const red = pixels[index] / 255;
        const green = pixels[index + 1] / 255;
        const blue = pixels[index + 2] / 255;
        const hsv = rgbToHsv(red, green, blue);
        const weight = 0.3 + hsv.s * 1.8 + (hsv.v > 0.12 && hsv.v < 0.96 ? 0.12 : 0);
        points.push({ r: red, g: green, b: blue, weight });
    }

    if (points.length === 0) return null;
    points.sort((left, right) => right.weight - left.weight);

    const centers = [];
    for (const point of points) {
        const farEnough = centers.every((center) => {
            const distance = Math.hypot(center.r - point.r, center.g - point.g, center.b - point.b);
            return distance > 0.16;
        });
        if (farEnough) centers.push({ r: point.r, g: point.g, b: point.b });
        if (centers.length >= 5) break;
    }
    while (centers.length < 5) {
        const point = points[centers.length % points.length];
        centers.push({ r: point.r, g: point.g, b: point.b });
    }

    for (let iteration = 0; iteration < 4; iteration += 1) {
        const sums = centers.map(() => ({ r: 0, g: 0, b: 0, weight: 0 }));
        for (const point of points) {
            let closest = 0;
            let closestDistance = Infinity;
            centers.forEach((center, centerIndex) => {
                const distance = Math.pow(center.r - point.r, 2)
                    + Math.pow(center.g - point.g, 2)
                    + Math.pow(center.b - point.b, 2);
                if (distance < closestDistance) {
                    closest = centerIndex;
                    closestDistance = distance;
                }
            });
            const sum = sums[closest];
            sum.r += point.r * point.weight;
            sum.g += point.g * point.weight;
            sum.b += point.b * point.weight;
            sum.weight += point.weight;
        }
        centers.forEach((center, index) => {
            const sum = sums[index];
            if (sum.weight > 0) {
                center.r = sum.r / sum.weight;
                center.g = sum.g / sum.weight;
                center.b = sum.b / sum.weight;
            }
        });
    }

    return centers
        .map((center) => {
            const hsv = rgbToHsv(center.r, center.g, center.b);
            // A slight saturation lift keeps the image's palette visible in
            // the luminous spiral without changing its basic hue family.
            return hsvToRgb(
                hsv.h,
                Math.min(1, Math.max(hsv.s, 0.48)),
                Math.min(1, Math.max(hsv.v, 0.42))
            );
        })
        .sort((left, right) => rgbToHsv(left.r, left.g, left.b).h - rgbToHsv(right.r, right.g, right.b).h);
}

function setSpiralPalette(palette) {
    if (!Array.isArray(palette) || palette.length < 5) return;
    palette.slice(0, 5).forEach((color, index) => {
        uniforms.uPalette.value[index].setRGB(color.r, color.g, color.b);
    });
}

async function loadWinnerImage() {
    const override = readImageOverride();
    const randomPhoto = override ? "" : await getRandomPhotoUrl();
    const candidates = [...new Set([override, randomPhoto, FALLBACK_WINNER].filter(Boolean))];

    for (const candidate of candidates) {
        try {
            const texture = await loadImageTexture(candidate);
            winnerUrl = candidate;
            uniforms.uWinner.value = texture;
            uniforms.uWinnerResolution.value.set(
                texture.image?.naturalWidth || texture.image?.width || 1,
                texture.image?.naturalHeight || texture.image?.height || 1
            );
            const palette = analyzeImagePalette(texture.image);
            if (palette) setSpiralPalette(palette);
            winnerReady = true;
            if (printStartedAt === null && (state === "finished" || video.currentTime >= PRINT_START)) {
                // A late result starts its longer spiral reveal on the held
                // final frame; an early result can join the planned window.
                printStartedAt = performance.now() / 1000;
            }
            return;
        } catch {
            // Try the next source. The bundled style image guarantees a final fallback.
        }
    }
}

function hideLoadingMessage() {
    loadingMessage.classList.add("is-hidden");
}

function showLoadingMessage(message) {
    loadingMessage.textContent = message;
    loadingMessage.classList.remove("is-hidden");
}

function setVideoResolution() {
    uniforms.uVideoResolution.value.set(video.videoWidth || 1, video.videoHeight || 1);
    videoDuration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 8;
}

function updateTimeline() {
    const time = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    // Give the opening a restrained hint of the same colorful spiral, then
    // let it breathe before the much stronger absorption beat begins.
    const introIn = THREE.MathUtils.smoothstep(time, 0.0, 0.6);
    const introOut = 1 - THREE.MathUtils.smoothstep(time, 2.1, 3.35);
    const introAbsorb = introIn * introOut * 0.16;

    // The spiral is a transition treatment. It fades back to the unmodified
    // video before the print is complete, so the last video frame (the real
    // painting canvas) remains visible behind the winner image.
    const absorbIn = THREE.MathUtils.clamp((time - ABSORB_START) / 0.55, 0, 1);
    const absorbOut = 1 - THREE.MathUtils.clamp(
        (time - ABSORB_FADE_OUT_START) / (ABSORB_FADE_OUT_END - ABSORB_FADE_OUT_START),
        0,
        1
    );
    const mainAbsorb = absorbIn * absorbOut;
    const absorb = state === "finished" ? 0 : Math.max(introAbsorb, mainAbsorb);
    const now = performance.now() / 1000;
    if (winnerReady && printStartedAt === null && time >= PRINT_START) {
        printStartedAt = now;
    }
    let print = 0;
    if (winnerReady && printStartedAt !== null) {
        print = THREE.MathUtils.clamp((now - printStartedAt) / PRINT_DURATION, 0, 1);
    }
    uniforms.uTime.value = time;
    uniforms.uAbsorb.value = absorb;
    uniforms.uPrint.value = print;
}

function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, width < 700 ? 1.5 : 2));
    renderer.setSize(width, height, false);
    renderer.getDrawingBufferSize(uniforms.uResolution.value);
}

async function playFromBeginning() {
    state = "playing";
    video.pause();
    soundtrack.pause();
    video.currentTime = 0;
    soundtrack.currentTime = 0;
    printStartedAt = null;
    uniforms.uAbsorb.value = 0;
    uniforms.uPrint.value = 0;
    // Do not leave a loading pill over the artwork while the play promise is
    // settling. It is only shown again when the browser actually blocks play.
    hideLoadingMessage();

    try {
        await entryPlayback.play();
    } catch {
        video.pause();
        soundtrack.pause();
        video.currentTime = 0;
        soundtrack.currentTime = 0;
        state = "blocked";
        showLoadingMessage("點擊畫面播放顏料吸收與聲音");
    }
}

function finish() {
    state = "finished";
    video.pause();
    uniforms.uAbsorb.value = 0;
    if (winnerReady && printStartedAt === null) {
        printStartedAt = performance.now() / 1000;
    }
    hideLoadingMessage();
}

function render() {
    updateTimeline();
    renderer.render(scene, camera);
}

video.addEventListener("loadedmetadata", setVideoResolution);
video.addEventListener("loadeddata", setVideoResolution, { once: true });
video.addEventListener("playing", () => {
    state = "playing";
    hideLoadingMessage();
});
video.addEventListener("ended", finish);
video.addEventListener("error", () => {
    state = "blocked";
    showLoadingMessage("影片載入失敗，請重新整理頁面");
});

stage.addEventListener("click", () => {
    if (state === "blocked") void playFromBeginning();
});

stage.addEventListener("dblclick", () => {
    if (state === "finished") void playFromBeginning();
});

window.addEventListener("resize", resize, { passive: true });
window.addEventListener("pagehide", () => {
    renderer.setAnimationLoop(null);
    video.pause();
    soundtrack.pause();
}, { once: true });

async function init() {
    resize();
    showLoadingMessage("正在載入顏料影片…");
    await new Promise((resolve) => {
        if (video.readyState >= 1) {
            setVideoResolution();
            resolve();
            return;
        }
        video.addEventListener("loadedmetadata", () => {
            setVideoResolution();
            resolve();
        }, { once: true });
        video.addEventListener("error", resolve, { once: true });
        video.load();
    });

    renderer.setAnimationLoop(render);
    // Start the clip immediately. The lottery result is allowed to arrive in
    // parallel; if it is late, finish() holds the final video frame for it.
    void playFromBeginning();
    void loadWinnerImage();
}

init();
