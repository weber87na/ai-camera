import * as THREE from "three";
import { OrbitControls } from "/vendor/three-addons/controls/OrbitControls.js";
import { GLTFLoader } from "/vendor/three-addons/loaders/GLTFLoader.js";
import { DecalGeometry } from "/vendor/three-addons/geometries/DecalGeometry.js";

const REFERENCE_IMAGES = Array.from({ length: 10 }, (_, index) => {
    const number = String(index + 1).padStart(2, "0");
    return `/images/style-${number}.webp`;
});

const FINAL_GLOW_LEAD = 0.5;
const PARTICLE_TRANSITION_DURATION = 1.7;
const PARTICLE_COUNT = window.innerWidth < 700 ? 1800 : 3200;
const APPLE_DEPTH = 1;

const stage = document.querySelector("#magicStage");
const video = document.querySelector("#sourceVideo");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050108);

const camera = new THREE.PerspectiveCamera(43, window.innerWidth / window.innerHeight, 0.1, 120);
camera.position.set(0, 0, 12);

const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "high-performance"
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth < 700 ? 1.5 : 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.22;
renderer.setSize(window.innerWidth, window.innerHeight);
stage.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enabled = false;
controls.enableDamping = true;
controls.dampingFactor = 0.055;
controls.rotateSpeed = 0.35;
controls.zoomSpeed = 0.55;
controls.enablePan = false;
controls.minDistance = 7.5;
controls.maxDistance = 16;
controls.target.set(0, 0, APPLE_DEPTH);

scene.add(new THREE.HemisphereLight(0xfff0d6, 0x100313, 2.8));

const keyLight = new THREE.DirectionalLight(0xfff4d7, 4.4);
keyLight.position.set(4.5, 7, 10);
scene.add(keyLight);

const fillLight = new THREE.PointLight(0xff375f, 22, 30, 2);
fillLight.position.set(-6, 0, 6);
scene.add(fillLight);

const rimLight = new THREE.PointLight(0xffc44f, 26, 28, 2);
rimLight.position.set(5, 4, -2);
scene.add(rimLight);

let videoPlane = null;
let appleRoot = null;
let appleBody = null;
let appleBounds = null;
let appleFitScale = 1;
let appleParticles = null;
let particleUniforms = null;
let decalMesh = null;
let winnerImage = null;
let state = "loading"; // loading -> playing -> transitioning -> winner
let transitionStartedAt = null;

const raycaster = new THREE.Raycaster();
const tmpSize = new THREE.Vector3();

function clamp01(value) {
    return Math.min(1, Math.max(0, value));
}

function easeOutCubic(value) {
    return 1 - Math.pow(1 - value, 3);
}

function loadImage(url) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = url;
    });
}

function localDateString() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

async function getCandidateImages() {
    try {
        const response = await fetch(`/api/photos/${localDateString()}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`Photo API returned ${response.status}`);

        const data = await response.json();
        const liveImages = Array.isArray(data.images) ? data.images.filter(Boolean) : [];
        if (liveImages.length) return liveImages;
    } catch (error) {
        console.warn("Today's portraits are unavailable; using the built-in gallery.", error);
    }

    return REFERENCE_IMAGES;
}

function setupVideoPlane() {
    const videoTexture = new THREE.VideoTexture(video);
    videoTexture.colorSpace = THREE.SRGBColorSpace;

    const material = new THREE.MeshBasicMaterial({
        map: videoTexture,
        side: THREE.DoubleSide,
        toneMapped: false,
        transparent: true,
        opacity: 1
    });

    videoPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    scene.add(videoPlane);
    updateVideoPlaneSize();
}

function updateVideoPlaneSize() {
    if (!videoPlane) return;

    const distance = camera.position.z - videoPlane.position.z;
    const visibleHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * distance;
    const visibleWidth = visibleHeight * camera.aspect;
    const videoAspect = video.videoWidth / video.videoHeight || 16 / 9;

    let width;
    let height;
    if (videoAspect > camera.aspect) {
        height = visibleHeight * 1.01;
        width = height * videoAspect;
    } else {
        width = visibleWidth * 1.01;
        height = width / videoAspect;
    }

    videoPlane.geometry.dispose();
    videoPlane.geometry = new THREE.PlaneGeometry(width, height);
}

function cloneAppleMaterial(material) {
    if (Array.isArray(material)) return material.map(cloneAppleMaterial);

    const cloned = material.clone();
    if (cloned.map) {
        cloned.map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        cloned.map.colorSpace = THREE.SRGBColorSpace;
        cloned.map.needsUpdate = true;
    }
    cloned.roughness = Math.min(cloned.roughness ?? 0.6, 0.55);
    cloned.needsUpdate = true;
    return cloned;
}

function forEachMaterial(material, callback) {
    if (Array.isArray(material)) {
        material.forEach((entry) => callback(entry));
    } else if (material) {
        callback(material);
    }
}

function setAppleSurfaceOpacity(opacity) {
    if (!appleBody) return;
    const value = clamp01(opacity);
    forEachMaterial(appleBody.material, (material) => {
        const shouldBeTransparent = value < 0.999;
        if (material.transparent !== shouldBeTransparent) {
            material.transparent = shouldBeTransparent;
            material.needsUpdate = true;
        }
        material.opacity = value;
        material.depthWrite = value > 0.84;
    });
}

function setPortraitProjectionOpacity(opacity) {
    if (!decalMesh) return;
    const value = clamp01(opacity);
    decalMesh.visible = value > 0.002;
    decalMesh.material.opacity = value * 0.8;
}

function sampleAppleSurface(geometry, count) {
    const positions = geometry.attributes.position;
    const index = geometry.index;
    const triangleCount = index ? index.count / 3 : positions.count / 3;
    const cumulativeAreas = new Float32Array(triangleCount);
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const edgeA = new THREE.Vector3();
    const edgeB = new THREE.Vector3();
    let totalArea = 0;

    const vertexIndex = (triangle, corner) => index
        ? index.getX(triangle * 3 + corner)
        : triangle * 3 + corner;

    for (let triangle = 0; triangle < triangleCount; triangle++) {
        a.fromBufferAttribute(positions, vertexIndex(triangle, 0));
        b.fromBufferAttribute(positions, vertexIndex(triangle, 1));
        c.fromBufferAttribute(positions, vertexIndex(triangle, 2));
        edgeA.subVectors(b, a);
        edgeB.subVectors(c, a);
        totalArea += edgeA.cross(edgeB).length() * 0.5;
        cumulativeAreas[triangle] = totalArea;
    }

    const samples = new Float32Array(count * 3);
    for (let sample = 0; sample < count; sample++) {
        const areaTarget = Math.random() * totalArea;
        let low = 0;
        let high = triangleCount - 1;
        while (low < high) {
            const middle = (low + high) >> 1;
            if (areaTarget <= cumulativeAreas[middle]) high = middle;
            else low = middle + 1;
        }

        a.fromBufferAttribute(positions, vertexIndex(low, 0));
        b.fromBufferAttribute(positions, vertexIndex(low, 1));
        c.fromBufferAttribute(positions, vertexIndex(low, 2));

        const root = Math.sqrt(Math.random());
        const weightA = 1 - root;
        const weightB = root * (1 - Math.random());
        const weightC = 1 - weightA - weightB;
        const offset = sample * 3;
        samples[offset] = a.x * weightA + b.x * weightB + c.x * weightC;
        samples[offset + 1] = a.y * weightA + b.y * weightB + c.y * weightC;
        samples[offset + 2] = a.z * weightA + b.z * weightB + c.z * weightC;
    }

    return samples;
}

function createAppleParticles(geometry) {
    const targets = sampleAppleSurface(geometry, PARTICLE_COUNT);
    const starts = new Float32Array(PARTICLE_COUNT * 3);
    const delays = new Float32Array(PARTICLE_COUNT);
    const seeds = new Float32Array(PARTICLE_COUNT);
    const sizes = new Float32Array(PARTICLE_COUNT);

    for (let index = 0; index < PARTICLE_COUNT; index++) {
        const offset = index * 3;
        const seed = Math.random();
        const angle = Math.random() * Math.PI * 2;
        const horizontalRadius = 92 + Math.random() * 88;
        const verticalRadius = 62 + Math.random() * 62;

        starts[offset] = Math.cos(angle) * horizontalRadius + (Math.random() - 0.5) * 22;
        starts[offset + 1] = Math.sin(angle) * verticalRadius + (Math.random() - 0.5) * 18;
        starts[offset + 2] = 12 + Math.random() * 88;
        delays[index] = Math.random() * 0.28;
        seeds[index] = seed;
        sizes[index] = 0.5 + Math.pow(Math.random(), 2) * 1.8;
    }

    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute("position", new THREE.BufferAttribute(targets, 3));
    particleGeometry.setAttribute("aStart", new THREE.BufferAttribute(starts, 3));
    particleGeometry.setAttribute("aDelay", new THREE.BufferAttribute(delays, 1));
    particleGeometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    particleGeometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));

    particleUniforms = {
        uProgress: { value: 0 },
        uOpacity: { value: 0 },
        uTime: { value: 0 },
        uPixelRatio: { value: renderer.getPixelRatio() }
    };

    const particleMaterial = new THREE.ShaderMaterial({
        uniforms: particleUniforms,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        vertexShader: `
            uniform float uProgress;
            uniform float uOpacity;
            uniform float uTime;
            uniform float uPixelRatio;
            attribute vec3 aStart;
            attribute float aDelay;
            attribute float aSeed;
            attribute float aSize;
            varying float vAlpha;
            varying float vHeat;

            void main() {
                float localProgress = clamp((uProgress - aDelay) / max(0.001, 1.0 - aDelay), 0.0, 1.0);
                float convergence = 1.0 - pow(1.0 - localProgress, 3.0);
                float orbit = sin(localProgress * 3.14159265) * (1.0 - convergence);
                float angle = aSeed * 12.0 + uTime * (0.55 + aSeed * 0.45);
                vec3 current = mix(aStart, position, convergence);
                current.xy += vec2(cos(angle), sin(angle)) * orbit * (8.0 + aSeed * 16.0);
                current.z += sin(angle * 1.7) * orbit * 13.0;

                vec4 mvPosition = modelViewMatrix * vec4(current, 1.0);
                gl_Position = projectionMatrix * mvPosition;
                float shimmer = 0.78 + sin(uTime * 5.0 + aSeed * 31.0) * 0.22;
                gl_PointSize = min(18.0, (2.0 + aSize * 3.4) * uPixelRatio * shimmer);
                vAlpha = uOpacity * smoothstep(0.0, 0.12, localProgress + uProgress * 0.55);
                vHeat = aSeed;
            }
        `,
        fragmentShader: `
            varying float vAlpha;
            varying float vHeat;

            void main() {
                vec2 point = gl_PointCoord - 0.5;
                float diamond = 1.0 - smoothstep(0.14, 0.52, abs(point.x) + abs(point.y));
                float vertical = (1.0 - smoothstep(0.025, 0.12, abs(point.x))) * (1.0 - smoothstep(0.18, 0.5, abs(point.y)));
                float horizontal = (1.0 - smoothstep(0.025, 0.12, abs(point.y))) * (1.0 - smoothstep(0.18, 0.5, abs(point.x)));
                float alpha = max(diamond, max(vertical, horizontal) * 0.72) * vAlpha;
                if (alpha < 0.01) discard;
                vec3 color = mix(vec3(1.0, 0.28, 0.035), vec3(1.0, 0.96, 0.64), vHeat);
                gl_FragColor = vec4(color, alpha);
            }
        `
    });

    appleParticles = new THREE.Points(particleGeometry, particleMaterial);
    appleParticles.name = "apple-convergence-particles";
    appleParticles.frustumCulled = false;
    appleParticles.renderOrder = 12;
    appleParticles.visible = false;
    return appleParticles;
}

async function preloadApple() {
    const gltf = await new GLTFLoader().loadAsync("/apple/apple.glb");
    gltf.scene.updateMatrixWorld(true);

    let sourceMesh = null;
    let sourceVolume = -1;
    gltf.scene.traverse((child) => {
        if (!child.isMesh || !child.geometry?.attributes?.position) return;
        const bounds = new THREE.Box3().setFromObject(child);
        const size = bounds.getSize(new THREE.Vector3());
        const volume = size.x * size.y * size.z;
        if (volume > sourceVolume) {
            sourceMesh = child;
            sourceVolume = volume;
        }
    });

    if (!sourceMesh) throw new Error("apple.glb does not contain a mesh");

    // Bake the nested GLB transforms into one clean mesh. This gives the decal and
    // screen-fitting code a stable, shared coordinate system.
    const geometry = sourceMesh.geometry.clone();
    geometry.applyMatrix4(sourceMesh.matrixWorld);
    geometry.computeBoundingBox();

    const originalBounds = geometry.boundingBox.clone();
    const center = originalBounds.getCenter(new THREE.Vector3());
    geometry.translate(-center.x, -center.y, -center.z);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    appleBody = new THREE.Mesh(geometry, cloneAppleMaterial(sourceMesh.material));
    appleBody.name = "apple-body";

    appleRoot = new THREE.Group();
    appleRoot.name = "winner-apple";
    appleRoot.add(appleBody);
    appleRoot.add(createAppleParticles(geometry));
    appleRoot.visible = false;
    scene.add(appleRoot);

    appleBounds = geometry.boundingBox.clone();
    setAppleSurfaceOpacity(0);
    updateAppleFitScale();
}

function updateAppleFitScale() {
    if (!appleBounds) return;

    appleBounds.getSize(tmpSize);
    const distance = camera.position.z - APPLE_DEPTH;
    const visibleHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * distance;
    const visibleWidth = visibleHeight * camera.aspect;
    const safeWidth = window.innerWidth < window.innerHeight ? 0.96 : 0.92;
    const safeHeight = 0.92;

    appleFitScale = Math.min(
        (visibleWidth * safeWidth) / tmpSize.x,
        (visibleHeight * safeHeight) / tmpSize.y
    );
}

function createPortraitTexture(image) {
    const canvas = document.createElement("canvas");
    canvas.width = 900;
    canvas.height = 1080;
    const context = canvas.getContext("2d");

    const sourceAspect = image.naturalWidth / image.naturalHeight;
    const targetAspect = canvas.width / canvas.height;
    let sourceX = 0;
    let sourceY = 0;
    let sourceWidth = image.naturalWidth;
    let sourceHeight = image.naturalHeight;

    if (sourceAspect > targetAspect) {
        sourceWidth = image.naturalHeight * targetAspect;
        sourceX = (image.naturalWidth - sourceWidth) * 0.5;
    } else {
        sourceHeight = image.naturalWidth / targetAspect;
        sourceY = (image.naturalHeight - sourceHeight) * 0.5;
    }

    context.drawImage(
        image,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        canvas.width,
        canvas.height
    );

    // Warm the portrait so it feels illuminated through the red apple skin.
    context.globalCompositeOperation = "soft-light";
    const warmth = context.createLinearGradient(0, 0, canvas.width, canvas.height);
    warmth.addColorStop(0, "rgba(255, 196, 92, 0.34)");
    warmth.addColorStop(0.55, "rgba(255, 112, 47, 0.18)");
    warmth.addColorStop(1, "rgba(120, 0, 22, 0.28)");
    context.fillStyle = warmth;
    context.fillRect(0, 0, canvas.width, canvas.height);

    // A long, feathered vignette removes every rectangular edge. The apple texture
    // remains visible through the outer falloff, making this read as light, not a sticker.
    context.globalCompositeOperation = "destination-in";
    context.save();
    context.translate(canvas.width * 0.5, canvas.height * 0.5);
    context.scale(1, 1.14);
    const maskRadius = canvas.width * 0.48;
    const feather = context.createRadialGradient(0, 0, maskRadius * 0.44, 0, 0, maskRadius);
    feather.addColorStop(0, "rgba(255, 255, 255, 1)");
    feather.addColorStop(0.5, "rgba(255, 255, 255, 0.98)");
    feather.addColorStop(0.72, "rgba(255, 255, 255, 0.68)");
    feather.addColorStop(0.9, "rgba(255, 255, 255, 0.14)");
    feather.addColorStop(1, "rgba(255, 255, 255, 0)");
    context.fillStyle = feather;
    context.beginPath();
    context.arc(0, 0, maskRadius, 0, Math.PI * 2);
    context.fill();
    context.restore();
    context.globalCompositeOperation = "source-over";

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
}

function disposeWinnerDecal() {
    if (!decalMesh) return;
    decalMesh.removeFromParent();
    decalMesh.geometry.dispose();
    decalMesh.material.map?.dispose();
    decalMesh.material.dispose();
    decalMesh = null;
}

function createWinnerDecal(image) {
    if (!appleRoot || !appleBody || !appleBounds) return;
    disposeWinnerDecal();

    // DecalGeometry emits world-space vertices. Reset the root while building it,
    // then parent it to the root so the portrait follows every apple animation.
    const savedPosition = appleRoot.position.clone();
    const savedQuaternion = appleRoot.quaternion.clone();
    const savedScale = appleRoot.scale.clone();
    appleRoot.position.set(0, 0, 0);
    appleRoot.quaternion.identity();
    appleRoot.scale.set(1, 1, 1);
    appleRoot.updateMatrixWorld(true);

    const size = appleBounds.getSize(new THREE.Vector3());
    const center = appleBounds.getCenter(new THREE.Vector3());
    const portraitWidth = size.x * 0.48;
    const portraitHeight = portraitWidth * 1.2;
    const portraitDepth = size.z * 0.3;

    const rayOrigin = new THREE.Vector3(center.x, center.y - size.y * 0.035, appleBounds.max.z + size.z * 0.25);
    raycaster.set(rayOrigin, new THREE.Vector3(0, 0, -1));
    const hit = raycaster.intersectObject(appleBody, false)[0];
    const projectorPosition = hit?.point || new THREE.Vector3(center.x, center.y, appleBounds.max.z - size.z * 0.04);
    const projectorSize = new THREE.Vector3(portraitWidth, portraitHeight, portraitDepth);
    const decalGeometry = new DecalGeometry(appleBody, projectorPosition, new THREE.Euler(0, 0, 0), projectorSize);

    const portraitTexture = createPortraitTexture(image);
    const decalMaterial = new THREE.MeshStandardMaterial({
        map: portraitTexture,
        emissive: new THREE.Color(0x5a1604),
        emissiveMap: portraitTexture,
        emissiveIntensity: 0.12,
        color: new THREE.Color(0xffd2ad),
        transparent: true,
        opacity: 0,
        alphaTest: 0.006,
        roughness: 0.72,
        metalness: 0,
        depthTest: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -6,
        polygonOffsetUnits: -6
    });

    decalMesh = new THREE.Mesh(decalGeometry, decalMaterial);
    decalMesh.name = "winner-portrait-decal";
    decalMesh.renderOrder = 4;
    decalMesh.visible = false;
    appleRoot.add(decalMesh);

    appleRoot.position.copy(savedPosition);
    appleRoot.quaternion.copy(savedQuaternion);
    appleRoot.scale.copy(savedScale);
    appleRoot.updateMatrixWorld(true);
}

async function pickRandomWinner() {
    const candidates = await getCandidateImages();
    const winnerUrl = candidates[Math.floor(Math.random() * candidates.length)];
    winnerImage = await loadImage(winnerUrl);
    createWinnerDecal(winnerImage);
}

function beginParticleTransition(now) {
    if (state === "transitioning" || state === "winner") return;

    transitionStartedAt = now;
    state = "transitioning";
    appleRoot.visible = true;
    appleRoot.scale.setScalar(appleFitScale * 0.94);
    appleRoot.position.set(0, 0, APPLE_DEPTH);
    appleRoot.rotation.set(0, 0, 0);
    appleParticles.visible = true;
    particleUniforms.uProgress.value = 0;
    particleUniforms.uOpacity.value = 0;
    setAppleSurfaceOpacity(0);
    setPortraitProjectionOpacity(0);
    controls.enabled = false;
}

async function startMagicExperience() {
    state = "loading";
    transitionStartedAt = null;
    stage.classList.remove("is-winner");

    appleRoot.visible = false;
    appleRoot.position.set(0, 0, 0);
    appleRoot.rotation.set(0, 0, 0);
    appleRoot.scale.set(1, 1, 1);
    appleParticles.visible = false;
    particleUniforms.uProgress.value = 0;
    particleUniforms.uOpacity.value = 0;
    setAppleSurfaceOpacity(0);
    setPortraitProjectionOpacity(0);
    videoPlane.visible = true;
    videoPlane.material.opacity = 1;

    await pickRandomWinner();
    setPortraitProjectionOpacity(0);

    video.currentTime = 0;
    await video.play().catch((error) => console.warn("Video playback needs user interaction.", error));
    state = "playing";
}

function updateTimeline(now) {
    if (state === "playing") {
        const duration = video.duration;
        const hasDuration = Number.isFinite(duration) && duration > 0;
        const isAtFinalMoment = hasDuration && video.currentTime >= Math.max(0, duration - FINAL_GLOW_LEAD);
        if (isAtFinalMoment || video.ended) beginParticleTransition(now);
        return;
    }

    if (state !== "transitioning" || transitionStartedAt === null) return;

    const progress = clamp01((now - transitionStartedAt) / PARTICLE_TRANSITION_DURATION);
    const particleAppear = easeOutCubic(clamp01(progress / 0.15));
    const particleFade = 1 - easeOutCubic(clamp01((progress - 0.72) / 0.28));
    particleUniforms.uProgress.value = progress;
    particleUniforms.uOpacity.value = particleAppear * particleFade;
    particleUniforms.uTime.value = now;

    // The video remains untouched until its final half-second has elapsed, then
    // gently gives way to the particle-built apple without a full-screen flash.
    const videoFade = easeOutCubic(clamp01((progress - 0.28) / 0.3));
    videoPlane.material.opacity = 1 - videoFade;
    if (videoFade >= 0.999) {
        videoPlane.visible = false;
        video.pause();
    }

    const appleReveal = easeOutCubic(clamp01((progress - 0.47) / 0.38));
    const portraitReveal = easeOutCubic(clamp01((progress - 0.7) / 0.25));
    setAppleSurfaceOpacity(appleReveal);
    setPortraitProjectionOpacity(portraitReveal);
    appleRoot.scale.setScalar(appleFitScale * THREE.MathUtils.lerp(0.94, 1, easeOutCubic(progress)));

    if (progress >= 1) {
        appleParticles.visible = false;
        particleUniforms.uOpacity.value = 0;
        setAppleSurfaceOpacity(1);
        setPortraitProjectionOpacity(1);
        state = "winner";
        controls.enabled = true;
        stage.classList.add("is-winner");
    }
}

function animate() {
    requestAnimationFrame(animate);

    const now = performance.now() / 1000;
    if (state === "playing" || state === "transitioning") updateTimeline(now);

    if (appleRoot?.visible && state === "winner") {
        appleRoot.position.y = Math.sin(now * 1.2) * 0.045;
        appleRoot.rotation.y = Math.sin(now * 0.42) * 0.045;
        appleRoot.rotation.x = Math.cos(now * 0.34) * 0.012;
    }

    controls.update();
    renderer.render(scene, camera);
}

function onWindowResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    camera.aspect = width / height;
    camera.fov = width < height ? 52 : 43;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, width < 700 ? 1.5 : 2));
    renderer.setSize(width, height);
    if (particleUniforms) particleUniforms.uPixelRatio.value = renderer.getPixelRatio();

    updateVideoPlaneSize();
    const previousFitScale = appleFitScale;
    updateAppleFitScale();
    if (appleRoot?.visible && previousFitScale > 0) {
        appleRoot.scale.multiplyScalar(appleFitScale / previousFitScale);
    }
}

window.addEventListener("resize", onWindowResize);

async function init() {
    try {
        await preloadApple();

        if (video.readyState < 1) {
            await new Promise((resolve) => video.addEventListener("loadedmetadata", resolve, { once: true }));
        }

        setupVideoPlane();
        await startMagicExperience();
        animate();
    } catch (error) {
        console.error("Disney magic experience failed to initialise:", error);
        stage.classList.add("has-error");
        stage.dataset.error = "蘋果模型載入失敗";
    }
}

init();
