import * as THREE from "three";
import { OrbitControls } from "/vendor/three-addons/controls/OrbitControls.js";
import { GLTFLoader } from "/vendor/three-addons/loaders/GLTFLoader.js";
import { DecalGeometry } from "/vendor/three-addons/geometries/DecalGeometry.js";
import { createExperiencePlayback, primeVideoFrame } from "/experience-playback.js?v=3";
import { createWinnerNameLabel, getPhotoCandidateEntries, pickRandomPhotoEntry } from "/lottery-photos.js?v=3";

const FINAL_GLOW_LEAD = 0.5;
const PARTICLE_TRANSITION_DURATION = 1.7;
const PARTICLE_COUNT = window.innerWidth < 700 ? 1800 : 3200;
const APPLE_DEPTH = 1;
const stage = document.querySelector("#magicStage");
const winnerName = createWinnerNameLabel(stage);

const video = document.querySelector("#sourceVideo");
const entryPlayback = createExperiencePlayback(video, { volume: 0.9 });

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050108);

const camera = new THREE.PerspectiveCamera(43, window.innerWidth / window.innerHeight, 0.1, 140);
camera.position.set(0, 0, 14);

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
controls.minDistance = 9;
controls.maxDistance = 20;
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
let appleGlow = null;
let glowUniforms = null;
let decalMesh = null;
let winnerImage = null;
let state = "loading"; // loading -> preview/waiting -> playing -> transitioning -> winner
let previewOnly = false;
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

function waitForUserStart() {
    state = "waiting";

    return new Promise((resolve) => {
        let listening = false;
        let resolved = false;
        const cleanup = () => {
            window.removeEventListener("pointerdown", settle);
            window.removeEventListener("keydown", settle);
            listening = false;
        };
        const listen = () => {
            if (resolved || listening) return;
            listening = true;
            window.addEventListener("pointerdown", settle, { once: true });
            window.addEventListener("keydown", settle, { once: true });
        };
        const settle = () => {
            if (resolved) return;
            cleanup();

            // Keep play() inside the trusted pointer/key event. Calling it after
            // an awaited promise can be rejected by autoplay policy even though
            // the user has already clicked.
            video.muted = false;
            video.volume = 0.9;
            entryPlayback.play({ sound: true }).then(() => {
                resolved = true;
                resolve();
            }).catch((error) => {
                video.pause();
                video.currentTime = 0;
                video.muted = true;
                video.volume = 0;
                console.warn("Video playback needs user interaction.", error);
                // Keep waiting; the next real page click will retry the gesture.
                listen();
            });
        };

        // The lottery box click grants a same-origin playback attempt. Direct
        // visits still wait for a trusted click as before.
        if (entryPlayback.requested) settle();
        else listen();
    });
}

async function getCandidateImages() {
    return getPhotoCandidateEntries();
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

function createAppleGlow(geometry) {
    glowUniforms = {
        uTime: { value: 0 },
        uOpacity: { value: 0 },
        uRadius: { value: geometry.boundingSphere?.radius || 1 }
    };

    const glowMaterial = new THREE.ShaderMaterial({
        uniforms: glowUniforms,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        side: THREE.FrontSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        vertexShader: `
            uniform float uTime;
            uniform float uOpacity;
            uniform float uRadius;
            varying vec3 vLocalPosition;
            varying vec3 vViewNormal;
            varying vec3 vViewDirection;

            void main() {
                vec3 normalizedPosition = position / max(uRadius, 0.0001);
                float lowerGlow = 1.0 - smoothstep(-0.08, 0.34, normalizedPosition.y);
                float breathing = 0.5 + 0.5 * sin(uTime * 1.8 + normalizedPosition.x * 2.4);
                float shellOffset = uRadius * (
                    0.014 + lowerGlow * (0.02 + breathing * 0.009) * uOpacity
                );
                vec3 displaced = position + normal * shellOffset;
                vec4 viewPosition = modelViewMatrix * vec4(displaced, 1.0);

                vLocalPosition = normalizedPosition;
                vViewNormal = normalize(normalMatrix * normal);
                vViewDirection = normalize(-viewPosition.xyz);
                gl_Position = projectionMatrix * viewPosition;
            }
        `,
        fragmentShader: `
            uniform float uTime;
            uniform float uOpacity;
            varying vec3 vLocalPosition;
            varying vec3 vViewNormal;
            varying vec3 vViewDirection;

            float hash21(vec2 p) {
                p = fract(p * vec2(123.34, 456.21));
                p += dot(p, p + 45.32);
                return fract(p.x * p.y);
            }

            float valueNoise(vec2 p) {
                vec2 cell = floor(p);
                vec2 local = fract(p);
                local = local * local * (3.0 - 2.0 * local);
                float a = hash21(cell);
                float b = hash21(cell + vec2(1.0, 0.0));
                float c = hash21(cell + vec2(0.0, 1.0));
                float d = hash21(cell + vec2(1.0, 1.0));
                return mix(mix(a, b, local.x), mix(c, d, local.x), local.y);
            }

            float fbm(vec2 p) {
                float value = 0.0;
                float amplitude = 0.52;
                for (int octave = 0; octave < 4; octave++) {
                    value += valueNoise(p) * amplitude;
                    p = p * 2.03 + vec2(17.13, 9.71);
                    amplitude *= 0.5;
                }
                return value;
            }

            vec2 energyWisp(vec2 point, float center, float seed, float width) {
                float flowTime = uTime * (0.36 + seed * 0.008);
                float verticalProgress = clamp((point.y + 0.82) / 0.88, 0.0, 1.0);
                float drift = sin(point.y * 5.2 + flowTime + seed) * 0.07;
                drift += (valueNoise(vec2(point.y * 3.6 + seed, flowTime * 0.42)) - 0.5) * 0.13;
                float distanceToWisp = abs(point.x - center - drift);
                float verticalFade = smoothstep(-0.86, -0.68, point.y)
                    * (1.0 - smoothstep(-0.18, 0.08, point.y));
                float breathing = 0.82 + 0.18 * sin(flowTime * 2.1 + seed + verticalProgress * 4.0);
                float glow = exp(-distanceToWisp * (7.0 / width)) * verticalFade * breathing;
                float centerGlow = exp(-distanceToWisp * (20.0 / width)) * verticalFade * breathing;
                return vec2(glow, centerGlow);
            }

            void main() {
                vec2 surfacePoint = vLocalPosition.xy;
                float facing = abs(dot(normalize(vViewNormal), normalize(vViewDirection)));
                float surfaceFacing = smoothstep(0.05, 0.32, facing);
                float lowerField = 1.0 - smoothstep(-0.02, 0.48, surfacePoint.y);

                vec2 flowUv = vec2(
                    surfacePoint.x * 2.6,
                    surfacePoint.y * 3.4 - uTime * 0.42
                );
                vec2 warp = vec2(
                    fbm(flowUv + vec2(3.7, 8.1)),
                    fbm(flowUv + vec2(11.4, 2.6))
                ) - 0.5;
                float flowingMist = fbm(flowUv + warp * 1.15);
                float mist = smoothstep(0.28, 0.82, flowingMist) * lowerField;

                vec2 leftWisp = energyWisp(surfacePoint, -0.31, 2.3, 1.0);
                vec2 centerWisp = energyWisp(surfacePoint, 0.0, 5.7, 1.15);
                vec2 rightWisp = energyWisp(surfacePoint, 0.32, 9.1, 0.92);
                float wispGlow = leftWisp.x + centerWisp.x * 0.9 + rightWisp.x;
                float wispCenter = leftWisp.y + centerWisp.y * 0.88 + rightWisp.y;

                vec2 bottomOffset = (surfacePoint - vec2(0.0, -0.78)) * vec2(0.82, 1.5);
                float bottomDistance = length(bottomOffset);
                float bottomRadiance = 1.0 - smoothstep(0.08, 0.72, bottomDistance);
                bottomRadiance *= 0.78 + flowingMist * 0.22;

                float fresnel = pow(1.0 - clamp(facing, 0.0, 1.0), 2.55);
                float rimStrength = fresnel * (0.28 + lowerField * 0.72);
                float pulse = 0.92 + 0.08 * sin(uTime * 2.2 + flowingMist * 3.0);
                float innerEnergy = bottomRadiance * 0.62
                    + mist * 0.26
                    + wispGlow * 0.28
                    + wispCenter * 0.18
                    + lowerField * 0.06;
                float alpha = uOpacity * pulse * (
                    surfaceFacing * innerEnergy
                    + rimStrength * 0.42
                );
                if (alpha < 0.006) discard;

                float verticalColor = clamp((surfacePoint.y + 0.84) / 1.2, 0.0, 1.0);
                vec3 lavenderCore = vec3(1.0, 0.38, 1.0);
                vec3 radiantPink = vec3(1.0, 0.025, 0.7);
                vec3 softViolet = vec3(0.34, 0.018, 1.0);
                vec3 radiantWhite = vec3(1.0, 0.72, 1.0);
                vec3 color = mix(lavenderCore, radiantPink, smoothstep(0.02, 0.42, verticalColor));
                color = mix(color, softViolet, smoothstep(0.34, 0.92, verticalColor));
                color = mix(color, radiantWhite, clamp(bottomRadiance * 0.34 + wispCenter * 0.1, 0.0, 0.42));
                gl_FragColor = vec4(color, min(alpha, 1.0));
            }
        `
    });

    appleGlow = new THREE.Mesh(geometry, glowMaterial);
    appleGlow.name = "guava-magical-aura";
    appleGlow.renderOrder = 3;
    appleGlow.frustumCulled = false;
    appleGlow.visible = false;
    return appleGlow;
}

function setAppleGlowOpacity(opacity) {
    if (!glowUniforms) return;
    const value = clamp01(opacity);
    glowUniforms.uOpacity.value = value;
    if (appleGlow) appleGlow.visible = value > 0.002;
}

async function preloadApple() {
    const gltf = await new GLTFLoader().loadAsync("/guava/guava.glb");
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

    if (!sourceMesh) throw new Error("guava.glb does not contain a mesh");

    // Bake the nested GLB transforms into one clean mesh. This gives the decal and
    // screen-fitting code a stable, shared coordinate system.
    const geometry = sourceMesh.geometry.clone();
    geometry.applyMatrix4(sourceMesh.matrixWorld);
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
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
    appleRoot.add(createAppleGlow(geometry));
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
    const isPortraitViewport = window.innerWidth < window.innerHeight;
    // Keep a deliberate amount of negative space around the finished apple. This
    // matches the reference framing and leaves the stem and full silhouette readable.
    const safeWidth = isPortraitViewport ? 0.92 : 0.64;
    const safeHeight = isPortraitViewport ? 0.82 : 0.64;

    appleFitScale = Math.min(
        (visibleWidth * safeWidth) / tmpSize.x,
        (visibleHeight * safeHeight) / tmpSize.y
    );
}

function createPortraitTexture(image) {
    const canvas = document.createElement("canvas");
    // The source portraits are 3:4. A taller projection keeps shoulders and
    // upper-body details instead of zooming into the face.
    canvas.width = 760;
    canvas.height = 1120;
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
    const portraitHeight = portraitWidth * (1120 / 760);
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
    const winner = pickRandomPhotoEntry(candidates);
    if (!winner) {
        stage.classList.add("has-lottery-error");
        stage.dataset.error = "今天尚未有可抽獎的照片";
        return false;
    }
    winnerName.set(winner.name);
    winnerImage = await loadImage(winner.url);
    createWinnerDecal(winnerImage);
    return true;
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
    setAppleGlowOpacity(0);
    setAppleSurfaceOpacity(0);
    setPortraitProjectionOpacity(0);
    controls.enabled = false;
}

async function startMagicExperience() {
    state = "loading";
    transitionStartedAt = null;
    stage.classList.remove("is-winner");
    winnerName.hide();

    appleRoot.visible = false;
    appleRoot.position.set(0, 0, 0);
    appleRoot.rotation.set(0, 0, 0);
    appleRoot.scale.set(1, 1, 1);
    appleParticles.visible = false;
    particleUniforms.uProgress.value = 0;
    particleUniforms.uOpacity.value = 0;
    setAppleGlowOpacity(0);
    setAppleSurfaceOpacity(0);
    setPortraitProjectionOpacity(0);
    videoPlane.visible = true;
    videoPlane.material.opacity = 1;
    video.pause();
    video.muted = true;
    video.volume = 0;

    if (!await pickRandomWinner()) {
        previewOnly = true;
        state = "preview";
        video.currentTime = 0;
        await primeVideoFrame(video);
        return;
    }
    setPortraitProjectionOpacity(0);

    video.currentTime = 0;
    await waitForUserStart();
    state = "playing";
}

async function playPreviewFromBeginning() {
    if (!previewOnly) return;
    video.pause();
    video.currentTime = 0;
    try {
        await entryPlayback.play({ sound: true });
    } catch {
        // Keep the first frame visible when the browser blocks playback.
    }
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
    const glowReveal = easeOutCubic(clamp01((progress - 0.24) / 0.54));
    const glowPulse = 0.84 + Math.sin(now * 4.2) * 0.1;
    setAppleSurfaceOpacity(appleReveal);
    setAppleGlowOpacity(glowReveal * glowPulse);
    setPortraitProjectionOpacity(portraitReveal);
    appleRoot.scale.setScalar(appleFitScale * THREE.MathUtils.lerp(0.94, 1, easeOutCubic(progress)));

    if (progress >= 1) {
        appleParticles.visible = false;
        particleUniforms.uOpacity.value = 0;
        setAppleSurfaceOpacity(1);
        setAppleGlowOpacity(0.84);
        setPortraitProjectionOpacity(1);
        state = "winner";
        controls.enabled = true;
        stage.classList.add("is-winner");
        winnerName.show();
    }
}

function animate() {
    requestAnimationFrame(animate);

    const now = performance.now() / 1000;
    if (glowUniforms) {
        glowUniforms.uTime.value = now;
    }
    if (state === "playing" || state === "transitioning") updateTimeline(now);

    if (appleRoot?.visible && state === "winner") {
        setAppleGlowOpacity(0.84 + Math.sin(now * 2.4) * 0.1);
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
stage.addEventListener("click", () => {
    if (!previewOnly) return;
    void playPreviewFromBeginning();
});

async function init() {
    try {
        await preloadApple();

        if (video.readyState < 2) {
            await new Promise((resolve) => video.addEventListener("loadeddata", resolve, { once: true }));
        }

        animate();
        setupVideoPlane();
        await startMagicExperience();
    } catch (error) {
        console.error("Disney magic experience failed to initialise:", error);
        stage.classList.add("has-error");
        stage.dataset.error = error?.message || "芭樂模型載入失敗";
    }
}

init();
