import * as THREE from "three";
import { getTodayPhotoEntries } from "./lottery-photos.js";

const stage = document.querySelector("#starshipStage");
const canvas = document.querySelector("#starshipCanvas");
const NASA_MOON_TEXTURE = "/images/moon-texture.jpg?v=1";
const STARSHIP_TEXTURE = "/images/starship.png?v=1";
const CAMERA_LAG = 16;
const STAR_COUNT = 720;
const STAR_SPEED = 18;
const STAR_SPREAD = 0.66;
const STAR_WORLD_RADIUS_X = 9.2;
const STAR_WORLD_RADIUS_Y = 6.2;
const MOON_BASE_SCALE = 1.43;
const POLAROID_SLOT_COUNT = 8;
const POLAROID_NEAR_Z = -2.4;
const POLAROID_REENTRY_FAR_MIN_Z = -42;
const POLAROID_REENTRY_FAR_MAX_Z = -28;
const POLAROID_SPEED_MIN = 4.2;
const POLAROID_SPEED_MAX = 7.2;
const PHOTO_SYNC_INTERVAL = 5000;
const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");

let width = 1;
let height = 1;
let elapsed = 0;
let lastTime = performance.now();
let frameRequest = 0;
let targetPointerX = 0;
let targetPointerY = 0;
let currentPointerX = 0;
let currentPointerY = 0;
let moonGroup;
let moonMesh;
let moonMaterial;
const polaroids = [];
const knownPhotoUrls = new Set();
const loadingPhotoUrls = new Set();
const failedPhotoUrls = new Set();
let photoSyncInFlight = false;
let photoSyncTimer = 0;
let polaroidSequence = 0;

const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance"
});
renderer.autoClear = false;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;

const backgroundScene = new THREE.Scene();
const worldScene = new THREE.Scene();
const overlayScene = new THREE.Scene();

const backgroundCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
backgroundCamera.position.z = 1;
const worldCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
const overlayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
overlayCamera.position.z = 1;

const backgroundUniforms = {
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uPointer: { value: new THREE.Vector2() }
};

const backgroundMaterial = new THREE.ShaderMaterial({
    uniforms: backgroundUniforms,
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform float uTime;
        uniform vec2 uResolution;
        uniform vec2 uPointer;
        varying vec2 vUv;

        float hash(vec2 point) {
            return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453);
        }

        void main() {
            vec2 point = vUv - 0.5;
            point.x *= uResolution.x / max(uResolution.y, 1.0);
            point -= uPointer * 0.018;

            vec3 color = vec3(0.004, 0.012, 0.026);
            float blueNebula = exp(-length((point - vec2(0.22, 0.07)) * vec2(1.05, 1.55)) * 2.35);
            float violetNebula = exp(-length((point - vec2(-0.29, -0.2)) * vec2(1.4, 0.9)) * 3.0);
            float centralGlow = exp(-length(point * vec2(0.82, 1.2)) * 4.4);
            float movement = sin((point.x + point.y) * 9.0 + uTime * 0.04) * 0.006;

            color += vec3(0.025, 0.072, 0.12) * blueNebula;
            color += vec3(0.035, 0.012, 0.075) * violetNebula;
            color += vec3(0.018, 0.036, 0.058) * centralGlow;
            color += movement;
            color *= 0.82 + 0.18 * smoothstep(-0.52, 0.48, vUv.y);

            gl_FragColor = vec4(color, 1.0);
        }
    `,
    depthWrite: false,
    depthTest: false
});
backgroundScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), backgroundMaterial));

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function randomBetween(min, max) {
    return min + Math.random() * (max - min);
}

const starData = Array.from({ length: STAR_COUNT }, () => ({
    directionX: 0,
    directionY: 0,
    z: 0,
    brightness: 1,
    size: 1,
    color: new THREE.Color()
}));
const starPositions = new Float32Array(STAR_COUNT * 3);
const starTrailPositions = new Float32Array(STAR_COUNT * 2 * 3);
const starColors = new Float32Array(STAR_COUNT * 3);
const starTrailColors = new Float32Array(STAR_COUNT * 2 * 3);
const starSizes = new Float32Array(STAR_COUNT);

function resetStar(star, initial = false) {
    star.directionX = randomBetween(-1.28, 1.28);
    star.directionY = randomBetween(-0.9, 0.9);
    star.z = initial ? randomBetween(-64, -1.6) : randomBetween(-68, -60);
    star.brightness = randomBetween(0.3, 1);
    star.size = randomBetween(0.65, 1.7);
    const tint = Math.random();
    star.color.setHex(tint > 0.84 ? 0x7cc8ff : tint > 0.74 ? 0xffd29d : 0xdbeeff);
}

function writeStarPosition(target, offset, star, z) {
    // Keep each star at a fixed world-space offset while its depth advances.
    // This makes perspective carry it from the vanishing point toward the
    // viewer instead of keeping it locked to one screen-space pixel.
    target[offset] = star.directionX * STAR_WORLD_RADIUS_X * STAR_SPREAD;
    target[offset + 1] = star.directionY * STAR_WORLD_RADIUS_Y * STAR_SPREAD;
    target[offset + 2] = z;
}

for (const star of starData) resetStar(star, true);

const starGeometry = new THREE.BufferGeometry();
starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
starGeometry.setAttribute("color", new THREE.BufferAttribute(starColors, 3));
starGeometry.setAttribute("aSize", new THREE.BufferAttribute(starSizes, 1));
const starPoints = new THREE.Points(
    starGeometry,
    new THREE.ShaderMaterial({
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        vertexShader: `
            attribute float aSize;
            varying vec3 vColor;

            void main() {
                vColor = color;
                vec4 modelViewPosition = modelViewMatrix * vec4(position, 1.0);
                gl_PointSize = clamp(aSize * (38.0 / max(-modelViewPosition.z, 1.0)), 1.2, 7.0);
                gl_Position = projectionMatrix * modelViewPosition;
            }
        `,
        fragmentShader: `
            varying vec3 vColor;

            void main() {
                float distanceToCenter = length(gl_PointCoord - vec2(0.5));
                if (distanceToCenter > 0.5) discard;

                float alpha = smoothstep(0.5, 0.04, distanceToCenter);
                gl_FragColor = vec4(vColor, alpha);
            }
        `
    })
);
starPoints.frustumCulled = false;
worldScene.add(starPoints);

const starTrailGeometry = new THREE.BufferGeometry();
starTrailGeometry.setAttribute("position", new THREE.BufferAttribute(starTrailPositions, 3));
starTrailGeometry.setAttribute("color", new THREE.BufferAttribute(starTrailColors, 3));
const starTrails = new THREE.LineSegments(
    starTrailGeometry,
    new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.42,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    })
);
starTrails.frustumCulled = false;
worldScene.add(starTrails);

function updateStarfield(deltaSeconds) {
    const speedScale = motionPreference.matches ? 0.08 : 1;
    const speed = STAR_SPEED * speedScale;

    for (let index = 0; index < STAR_COUNT; index += 1) {
        const star = starData[index];
        const oldZ = star.z;
        star.z += deltaSeconds * speed * (0.68 + star.brightness * 0.85);
        const wasReset = star.z > -0.35;
        if (wasReset) resetStar(star);

        const pointOffset = index * 3;
        const trailOffset = index * 6;
        const previousZ = wasReset
            ? star.z - 0.18
            : oldZ - Math.max(0.24, deltaSeconds * speed * 2.4);
        writeStarPosition(starPositions, pointOffset, star, star.z);
        writeStarPosition(starTrailPositions, trailOffset, star, previousZ);
        writeStarPosition(starTrailPositions, trailOffset + 3, star, star.z);

        const brightness = star.brightness * clamp((64 + star.z) / 24, 0.15, 1);
        starColors[pointOffset] = star.color.r * brightness;
        starColors[pointOffset + 1] = star.color.g * brightness;
        starColors[pointOffset + 2] = star.color.b * brightness;
        starSizes[index] = star.size * (0.62 + star.brightness * 0.5);
        for (let channel = 0; channel < 2; channel += 1) {
            const colorOffset = trailOffset + channel * 3;
            starTrailColors[colorOffset] = star.color.r * brightness * 0.72;
            starTrailColors[colorOffset + 1] = star.color.g * brightness * 0.72;
            starTrailColors[colorOffset + 2] = star.color.b * brightness * 0.72;
        }
    }

    starGeometry.attributes.position.needsUpdate = true;
    starGeometry.attributes.color.needsUpdate = true;
    starGeometry.attributes.aSize.needsUpdate = true;
    starTrailGeometry.attributes.position.needsUpdate = true;
    starTrailGeometry.attributes.color.needsUpdate = true;
}

function createLuminanceTexture(image) {
    const bumpCanvas = document.createElement("canvas");
    bumpCanvas.width = image.width;
    bumpCanvas.height = image.height;
    const context = bumpCanvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0);

    const pixels = context.getImageData(0, 0, bumpCanvas.width, bumpCanvas.height);
    for (let index = 0; index < pixels.data.length; index += 4) {
        const luminance = Math.round(
            pixels.data[index] * 0.2126 +
            pixels.data[index + 1] * 0.7152 +
            pixels.data[index + 2] * 0.0722
        );
        pixels.data[index] = luminance;
        pixels.data[index + 1] = luminance;
        pixels.data[index + 2] = luminance;
        pixels.data[index + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);

    const bumpTexture = new THREE.CanvasTexture(bumpCanvas);
    bumpTexture.colorSpace = THREE.NoColorSpace;
    bumpTexture.wrapS = THREE.RepeatWrapping;
    bumpTexture.wrapT = THREE.ClampToEdgeWrapping;
    bumpTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return bumpTexture;
}

function createMoonAtmosphere() {
    return new THREE.Mesh(
        new THREE.SphereGeometry(1.026, 96, 64),
        new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            side: THREE.BackSide,
            blending: THREE.AdditiveBlending,
            uniforms: { atmosphereColor: { value: new THREE.Color(0x79b8e8) } },
            vertexShader: `
                varying vec3 vViewNormal;
                void main() {
                    vViewNormal = normalize(normalMatrix * normal);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 atmosphereColor;
                varying vec3 vViewNormal;
                void main() {
                    float rim = pow(1.0 - max(dot(normalize(vViewNormal), vec3(0.0, 0.0, 1.0)), 0.0), 3.5);
                    gl_FragColor = vec4(atmosphereColor, rim * 0.16);
                }
            `
        })
    );
}

function createMoon() {
    moonGroup = new THREE.Group();
    moonGroup.position.set(3.65, 1.95, -14);
    moonGroup.scale.setScalar(MOON_BASE_SCALE);
    moonGroup.rotation.y = 0.75;
    worldScene.add(moonGroup);

    const moonGeometry = new THREE.SphereGeometry(1, 160, 96);
    const uvAttribute = moonGeometry.getAttribute("uv");
    if (uvAttribute) uvAttribute.needsUpdate = true;

    moonMaterial = new THREE.MeshStandardMaterial({
        color: 0xb7b9b8,
        roughness: 0.98,
        metalness: 0,
        bumpScale: 0.12
    });
    moonMesh = new THREE.Mesh(moonGeometry, moonMaterial);
    moonGroup.add(moonMesh);
    moonGroup.add(createMoonAtmosphere());

    const sunLight = new THREE.DirectionalLight(0xfff4e6, 3.25);
    sunLight.position.set(-3.4, 2.2, 4.8);
    worldScene.add(sunLight);
    worldScene.add(new THREE.HemisphereLight(0x9ec8ed, 0x080d16, 0.22));

    const textureLoader = new THREE.TextureLoader();
    textureLoader.load(NASA_MOON_TEXTURE, texture => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        moonMaterial.map = texture;
        moonMaterial.bumpMap = createLuminanceTexture(texture.image);
        moonMaterial.needsUpdate = true;
    }, undefined, error => console.error("Moon texture failed to load:", error));
}

const POLAROID_WIDTH = 1.62;
const POLAROID_HEIGHT = 2.03;
const POLAROID_DEPTH = 0.055;
const polaroidBodyGeometry = new THREE.BoxGeometry(
    POLAROID_WIDTH,
    POLAROID_HEIGHT,
    POLAROID_DEPTH
);
const polaroidFaceGeometry = new THREE.PlaneGeometry(POLAROID_WIDTH, POLAROID_HEIGHT);
const polaroidBodyMaterial = new THREE.MeshStandardMaterial({
    color: 0xf4f0e9,
    roughness: 0.9,
    metalness: 0
});
const polaroidLayouts = [
    { position: [-8.6, 4.8, -17.5], rotation: [-0.16, 0.95, -0.18], scale: 0.84 },
    { position: [8.7, 4.6, -18.2], rotation: [0.14, -0.9, 0.15], scale: 0.78 },
    { position: [-9.1, -4.0, -16.6], rotation: [0.12, 0.7, 0.2], scale: 0.9 },
    { position: [9.2, -4.2, -17.2], rotation: [-0.1, -0.72, -0.15], scale: 0.86 },
    { position: [-7.2, 2.0, -14.2], rotation: [0.08, 0.25, -0.12], scale: 0.92 },
    { position: [7.4, 1.8, -14.8], rotation: [-0.05, -0.28, 0.13], scale: 0.9 },
    { position: [-8.0, -1.8, -15.6], rotation: [0.1, 0.5, 0.12], scale: 0.84 },
    { position: [8.1, -1.9, -16.1], rotation: [-0.08, -0.52, -0.1], scale: 0.82 }
];

function createPolaroidTexture(image) {
    const cardCanvas = document.createElement("canvas");
    cardCanvas.width = 512;
    cardCanvas.height = 640;
    const context = cardCanvas.getContext("2d");
    const photoX = 36;
    const photoY = 34;
    const photoWidth = 440;
    const photoHeight = 500;

    context.fillStyle = "#f4f0e9";
    context.fillRect(0, 0, cardCanvas.width, cardCanvas.height);
    context.fillStyle = "#d8d2c9";
    context.fillRect(photoX, photoY, photoWidth, photoHeight);

    const imageWidth = image.naturalWidth || image.width;
    const imageHeight = image.naturalHeight || image.height;
    const imageAspect = imageWidth / Math.max(imageHeight, 1);
    const photoAspect = photoWidth / photoHeight;
    let sourceX = 0;
    let sourceY = 0;
    let sourceWidth = imageWidth;
    let sourceHeight = imageHeight;

    if (imageAspect > photoAspect) {
        sourceWidth = imageHeight * photoAspect;
        sourceX = (imageWidth - sourceWidth) * 0.5;
    } else {
        sourceHeight = imageWidth / photoAspect;
        sourceY = (imageHeight - sourceHeight) * 0.5;
    }

    context.save();
    context.beginPath();
    context.rect(photoX, photoY, photoWidth, photoHeight);
    context.clip();
    context.drawImage(
        image,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        photoX,
        photoY,
        photoWidth,
        photoHeight
    );
    context.restore();

    context.strokeStyle = "rgba(34, 42, 52, 0.18)";
    context.lineWidth = 3;
    context.strokeRect(photoX + 1.5, photoY + 1.5, photoWidth - 3, photoHeight - 3);

    const texture = new THREE.CanvasTexture(cardCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return texture;
}

function removePolaroidCard(polaroid) {
    if (!polaroid) return;

    worldScene.remove(polaroid.group);
    polaroid.group.traverse(object => {
        if (!object.isMesh || object.material === polaroidBodyMaterial) return;
        object.material.map?.dispose();
        object.material.dispose();
    });
}

function resetPolaroidFlight(polaroid, initial = false) {
    const layout = polaroidLayouts[polaroid.slotIndex];
    polaroid.worldX = layout.position[0] + randomBetween(-0.24, 0.24);
    polaroid.worldY = layout.position[1] + randomBetween(-0.18, 0.18);
    polaroid.depth = initial
        ? layout.position[2] - randomBetween(10, 16)
        : randomBetween(POLAROID_REENTRY_FAR_MIN_Z, POLAROID_REENTRY_FAR_MAX_Z);
    polaroid.speed = randomBetween(POLAROID_SPEED_MIN, POLAROID_SPEED_MAX);
    polaroid.phase = randomBetween(0, Math.PI * 2);
    polaroid.baseRotation.set(
        layout.rotation[0] + randomBetween(-0.08, 0.08),
        layout.rotation[1] + randomBetween(-0.14, 0.14),
        layout.rotation[2] + randomBetween(-0.08, 0.08)
    );
    polaroid.group.position.set(polaroid.worldX, polaroid.worldY, polaroid.depth);
    polaroid.group.rotation.copy(polaroid.baseRotation);
    polaroid.group.scale.setScalar(polaroid.scale);
}

function createPolaroidCard(image, url, sequenceIndex) {
    const slotIndex = sequenceIndex % POLAROID_SLOT_COUNT;
    const layout = polaroidLayouts[slotIndex];

    const existingCardIndex = polaroids.findIndex(card => card.slotIndex === slotIndex);
    if (existingCardIndex >= 0) {
        removePolaroidCard(polaroids.splice(existingCardIndex, 1)[0]);
    }

    const group = new THREE.Group();
    const body = new THREE.Mesh(polaroidBodyGeometry, polaroidBodyMaterial);
    const faceMaterial = new THREE.MeshBasicMaterial({
        map: createPolaroidTexture(image),
        side: THREE.DoubleSide,
        depthWrite: false
    });
    const face = new THREE.Mesh(polaroidFaceGeometry, faceMaterial);

    face.position.z = POLAROID_DEPTH * 0.5 + 0.004;
    group.add(body, face);
    group.rotation.set(...layout.rotation);
    group.scale.setScalar(layout.scale);
    group.renderOrder = 4;
    worldScene.add(group);

    const polaroid = {
        url,
        group,
        slotIndex,
        baseRotation: new THREE.Euler(...layout.rotation),
        scale: layout.scale,
        worldX: layout.position[0],
        worldY: layout.position[1],
        depth: layout.position[2],
        phase: sequenceIndex * 1.37,
        speed: POLAROID_SPEED_MIN
    };
    polaroids.push(polaroid);
    resetPolaroidFlight(polaroid, true);
}

function loadPolaroidImage(url) {
    return new Promise(resolve => {
        const image = new Image();
        image.decoding = "async";
        image.addEventListener("load", () => resolve(image), { once: true });
        image.addEventListener("error", () => {
            console.warn(`Today's photo failed to load: ${url}`);
            resolve(null);
        }, { once: true });
        image.src = url;
    });
}

async function syncTodayPolaroids() {
    if (photoSyncInFlight) return;
    photoSyncInFlight = true;

    try {
        const entries = await getTodayPhotoEntries();
        const pendingEntries = entries.filter(entry => {
            const url = entry?.url;
            return url &&
                !knownPhotoUrls.has(url) &&
                !loadingPhotoUrls.has(url) &&
                !failedPhotoUrls.has(url);
        });

        await Promise.all(pendingEntries.map(async entry => {
            loadingPhotoUrls.add(entry.url);
            try {
                const image = await loadPolaroidImage(entry.url);
                if (!image) {
                    failedPhotoUrls.add(entry.url);
                    return;
                }

                knownPhotoUrls.add(entry.url);
                createPolaroidCard(image, entry.url, polaroidSequence);
                polaroidSequence += 1;
            } finally {
                loadingPhotoUrls.delete(entry.url);
            }
        }));
    } catch (error) {
        console.warn("Today's photos are unavailable:", error);
    } finally {
        photoSyncInFlight = false;
    }
}

function updatePolaroids(deltaSeconds) {
    for (const polaroid of polaroids) {
        polaroid.depth += deltaSeconds * polaroid.speed;
        if (polaroid.depth > POLAROID_NEAR_Z) {
            resetPolaroidFlight(polaroid);
        }

        const motionTime = elapsed * 0.00055 * polaroid.speed + polaroid.phase;
        const pointerDrift = currentPointerX * (polaroid.worldX > 0 ? -0.08 : 0.08);

        polaroid.group.position.x = polaroid.worldX + Math.sin(motionTime * 0.7) * 0.09 + pointerDrift;
        polaroid.group.position.y = polaroid.worldY + Math.cos(motionTime * 0.58) * 0.08;
        polaroid.group.position.z = polaroid.depth + Math.sin(motionTime * 0.46) * 0.1;
        polaroid.group.rotation.x = polaroid.baseRotation.x + Math.sin(motionTime * 0.76) * 0.13;
        polaroid.group.rotation.y = polaroid.baseRotation.y + Math.cos(motionTime * 0.62) * 0.16;
        polaroid.group.rotation.z = polaroid.baseRotation.z + Math.sin(motionTime * 0.91) * 0.09;
    }
}

const cockpitMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    depthTest: false,
    depthWrite: false
});
const cockpitMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), cockpitMaterial);
cockpitMesh.renderOrder = 100;
overlayScene.add(cockpitMesh);

new THREE.TextureLoader().load(STARSHIP_TEXTURE, texture => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    cockpitMaterial.map = texture;
    cockpitMaterial.needsUpdate = true;
}, undefined, error => console.error("Cockpit texture failed to load:", error));

function resize() {
    width = Math.max(1, window.innerWidth);
    height = Math.max(1, window.innerHeight);
    const viewportAspect = width / height;
    const imageAspect = 1672 / 941;

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    worldCamera.aspect = viewportAspect;
    worldCamera.updateProjectionMatrix();
    backgroundUniforms.uResolution.value.set(width, height);

    if (viewportAspect >= imageAspect) {
        cockpitMesh.scale.set(1, viewportAspect / imageAspect, 1);
    } else {
        cockpitMesh.scale.set(imageAspect / viewportAspect, 1, 1);
    }
}

function updatePointer(event) {
    targetPointerX = clamp((event.clientX / width - 0.5) * 2, -1, 1);
    targetPointerY = clamp((event.clientY / height - 0.5) * 2, -1, 1);
}

function resetPointer() {
    targetPointerX = 0;
    targetPointerY = 0;
}

function animate(now) {
    const deltaSeconds = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
    lastTime = now;
    elapsed += deltaSeconds * 1000;

    const pointerBlend = Math.min(1, deltaSeconds * 60 / CAMERA_LAG);
    currentPointerX += (targetPointerX - currentPointerX) * pointerBlend;
    currentPointerY += (targetPointerY - currentPointerY) * pointerBlend;

    worldCamera.position.x = currentPointerX * 0.22;
    worldCamera.position.y = currentPointerY * 0.12;
    worldCamera.lookAt(currentPointerX * 0.1, currentPointerY * 0.06, -14);

    backgroundUniforms.uTime.value = elapsed * 0.001;
    backgroundUniforms.uPointer.value.set(currentPointerX, currentPointerY);
    moonGroup.position.x = 3.65 - currentPointerX * 0.3;
    moonGroup.position.y = 1.95 - currentPointerY * 0.18;
    moonGroup.rotation.y += deltaSeconds * 0.018;
    moonGroup.rotation.x = Math.sin(elapsed * 0.00012) * 0.018;
    const approachScale = MOON_BASE_SCALE * (1.018 + Math.sin(elapsed * 0.00022) * 0.012);
    moonGroup.scale.setScalar(approachScale);

    updateStarfield(deltaSeconds);
    updatePolaroids(deltaSeconds);

    renderer.clear();
    renderer.render(backgroundScene, backgroundCamera);
    renderer.clearDepth();
    renderer.render(worldScene, worldCamera);
    renderer.clearDepth();
    renderer.render(overlayScene, overlayCamera);

    frameRequest = requestAnimationFrame(animate);
}

createMoon();
syncTodayPolaroids();
photoSyncTimer = window.setInterval(syncTodayPolaroids, PHOTO_SYNC_INTERVAL);
resize();
stage.addEventListener("pointermove", updatePointer, { passive: true });
stage.addEventListener("pointerleave", resetPointer, { passive: true });
window.addEventListener("resize", resize, { passive: true });
window.addEventListener("pagehide", () => {
    cancelAnimationFrame(frameRequest);
    window.clearInterval(photoSyncTimer);
}, { once: true });
frameRequest = requestAnimationFrame(animate);
