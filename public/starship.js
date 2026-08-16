import * as THREE from "three";
import { GLTFLoader } from "/vendor/three-addons/loaders/GLTFLoader.js";
import { getTodayPhotoEntries } from "./lottery-photos.js";

const stage = document.querySelector("#starshipStage");
const canvas = document.querySelector("#starshipCanvas");
const starshipMusic = document.querySelector("#starshipMusic");
const NASA_MOON_TEXTURE = "/images/moon-texture.jpg?v=1";
const STARSHIP_TEXTURE = "/images/starship.png?v=1";
const GUAVA_MODEL_PATH = "/guava/guava.glb";
const CRT_WIDTH = 0.78;
const CRT_HEIGHT = 0.72;
const PLANET_TEXTURE_PATHS = [
    "/images/chain-packaging.png",
    "/images/guava-packaging.png",
    "/images/paint-packaging.png",
    "/images/simpsons-packaging.png",
    "/images/talisman-packaging.png"
];
const CAMERA_LAG = 16;
const STAR_COUNT = 720;
const STAR_SPEED = 18;
const STAR_SPREAD = 0.66;
const STAR_WORLD_RADIUS_X = 9.2;
const STAR_WORLD_RADIUS_Y = 6.2;
const MOON_BASE_SCALE = 1.43;
const MOON_POSITION_ANCHORS = [
    { x: -3.65, y: 1.95, z: -14 },
    { x: 0, y: 1.95, z: -14 },
    { x: 0.85, y: 2.8, z: -14 }
];
const MOON_THEME = {
    primary: 0x12405c,
    secondary: 0x26124d,
    accent: 0x1b9bb5,
    transition: 0xa9ddff,
    transitionSecondary: 0x27466e,
    transitionThird: 0xf1f8ff
};
const PLANET_THEMES = [
    { primary: 0x0b4660, secondary: 0x26124d, accent: 0x1b9bb5, transition: 0x9d5cff, transitionSecondary: 0x24003e, transitionThird: 0xf0a0ff },
    { primary: 0x1b5b3e, secondary: 0x49300f, accent: 0xc77732, transition: 0x35ff63, transitionSecondary: 0x0b3d1e, transitionThird: 0x9dff56 },
    { primary: 0x163f82, secondary: 0x4d104b, accent: 0x1689bd, transition: 0xff2d9a, transitionSecondary: 0x18d9ff, transitionThird: 0xffd231 },
    { primary: 0x173e70, secondary: 0x5d460a, accent: 0xd3aa26, transition: 0xffd51f, transitionSecondary: 0x030303, transitionThird: 0x916d00 },
    { primary: 0x5d1e1d, secondary: 0x3c1609, accent: 0xd48d31, transition: 0xffe24a, transitionSecondary: 0xb51c20, transitionThird: 0xff5a22 }
];
const PLANET_ROUTES = [
    "/hunterxhunter",
    "/disney",
    "/painter",
    "/simpsons-magic",
    "/chinese-magic"
];
const PLANET_CYCLE_SEQUENCE = [-1, 3, 0, 2, 1, 4];
const PLANET_CYCLE_INTERVAL = 20000;
const POLAROID_NEAR_Z = -2.4;
const POLAROID_REENTRY_FAR_MIN_Z = -42;
const POLAROID_REENTRY_FAR_MAX_Z = -28;
const POLAROID_SPEED_MIN = 4.2;
const POLAROID_SPEED_MAX = 7.2;
const PHOTO_SYNC_INTERVAL = 5000;
const POLAROID_MIN_COUNT = 10;
const POLAROID_MAX_COUNT = 15;
const BASE_CAMERA_FOV = 50;
const PLANET_TRANSITION_WAIT = 1.25;
const PLANET_TRANSITION_ACCELERATION = 3;
const PLANET_TRANSITION_MAX_SPEED = 14;
const PLANET_ENTRY_DURATION = 1.05;
const PLANET_ENTRY_SCALE_MULTIPLIER = 4;
const PLANET_ENTRY_MAX_SPEED = 6.5;
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
let moonAtmosphere;
let nasaMoonTexture;
let nasaMoonBumpTexture;
let chainPlanetGroup;
let guavaPlanetGroup;
let guavaPlanetReady = false;
let activePlanetThemeIndex = -1;
const moonAnchor = new THREE.Vector3(0, 1.95, -14);
const moonTargetPosition = new THREE.Vector3(0, 1.95, -14);
const polaroids = [];
const knownPhotoUrls = new Set();
const loadingPhotoUrls = new Set();
const failedPhotoUrls = new Set();
let photoSyncInFlight = false;
let photoSyncTimer = 0;
let polaroidSequence = 0;
let planetTransition = null;
let planetEntry = null;
let transitionIntensity = 0;
let planetCyclePosition = 0;
let planetCycleTimer = 0;

function startBackgroundMusic() {
    if (!starshipMusic) return;
    starshipMusic.volume = 0.34;
    if (starshipMusic.paused) {
        starshipMusic.play().catch(() => {
            // Browsers may wait for the first user gesture before allowing audio.
        });
    }
}

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
const worldCamera = new THREE.PerspectiveCamera(BASE_CAMERA_FOV, 1, 0.1, 100);
const overlayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
overlayCamera.position.z = 1;

const backgroundUniforms = {
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uPointer: { value: new THREE.Vector2() },
    uThemePrimary: { value: new THREE.Color(0x12405c) },
    uThemeSecondary: { value: new THREE.Color(0x26124d) },
    uThemeAccent: { value: new THREE.Color(0x1b9bb5) },
    uTravelColor: { value: new THREE.Color(0x54e9ff) },
    uTravelSecondary: { value: new THREE.Color(0x24003e) },
    uTravelThird: { value: new THREE.Color(0xf0a0ff) },
    uTravel: { value: 0 }
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
        uniform vec3 uThemePrimary;
        uniform vec3 uThemeSecondary;
        uniform vec3 uThemeAccent;
        uniform vec3 uTravelColor;
        uniform vec3 uTravelSecondary;
        uniform vec3 uTravelThird;
        uniform float uTravel;
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
            vec3 themeBase = mix(uThemeSecondary, uThemePrimary, smoothstep(0.05, 0.95, vUv.y));

            color += vec3(0.025, 0.072, 0.12) * blueNebula;
            color += vec3(0.035, 0.012, 0.075) * violetNebula;
            color += vec3(0.018, 0.036, 0.058) * centralGlow;
            color += themeBase * 0.26;
            color += uThemePrimary * blueNebula * 0.105;
            color += uThemeSecondary * violetNebula * 0.09;
            color += uThemeAccent * centralGlow * 0.065;
            float travelGlow = exp(-length(point * vec2(0.8, 1.15)) * 3.2);
            float travelPalette = 0.5 + 0.5 * sin((point.x - point.y) * 8.0 + uTime * 2.2);
            vec3 travelColor = mix(uTravelColor, uTravelSecondary, smoothstep(0.2, 0.72, travelPalette));
            travelColor = mix(travelColor, uTravelThird, smoothstep(0.72, 0.98, travelPalette));
            color += travelColor * travelGlow * uTravel * 0.12;
            color += movement;
            color *= 0.82 + 0.18 * smoothstep(-0.52, 0.48, vUv.y);

            gl_FragColor = vec4(color, 1.0);
        }
    `,
    depthWrite: false,
    depthTest: false
});
backgroundScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), backgroundMaterial));

const travelUniforms = {
    uTime: { value: 0 },
    uIntensity: { value: 0 },
    uColor: { value: new THREE.Color(0x9d5cff) },
    uSecondary: { value: new THREE.Color(0x24003e) },
    uThird: { value: new THREE.Color(0xf0a0ff) }
};
const travelOverlay = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
        uniforms: travelUniforms,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.NormalBlending,
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform float uTime;
            uniform float uIntensity;
            uniform vec3 uColor;
            uniform vec3 uSecondary;
            uniform vec3 uThird;
            varying vec2 vUv;

            void main() {
                vec2 point = vUv - 0.5;
                point.x *= 1.78;
                float radius = length(point);
                float edge = 1.0 - smoothstep(0.18, 0.82, radius);
                float rayAngle = atan(point.y, point.x);
                float rays = pow(0.5 + 0.5 * sin(rayAngle * 44.0 + uTime * 3.5), 5.0);
                float centerPulse = 1.0 - smoothstep(0.0, 0.34, radius);
                float alpha = uIntensity * (edge * 0.12 + rays * edge * 0.16 + centerPulse * 0.08);
                float palettePhase = 0.5 + 0.5 * sin(rayAngle * 3.0 - uTime * 0.4);
                vec3 color = mix(uColor, uSecondary, smoothstep(0.22, 0.7, palettePhase));
                color = mix(color, uThird, smoothstep(0.7, 0.98, palettePhase));
                color *= 0.65 + rays * 1.2 + centerPulse * 0.5;
                gl_FragColor = vec4(color, alpha);
            }
        `
    })
);
travelOverlay.renderOrder = 150;
travelOverlay.frustumCulled = false;
overlayScene.add(travelOverlay);

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function randomBetween(min, max) {
    return min + Math.random() * (max - min);
}

function randomInteger(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffled(items) {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
    }
    return result;
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

function updateStarfield(deltaSeconds, travelSpeed = 1) {
    const speedScale = motionPreference.matches ? 0.08 : 1;
    const speed = STAR_SPEED * speedScale * travelSpeed;

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

function createChainPlanet() {
    const group = new THREE.Group();
    group.name = "chain-wrapped-planet";

    // The ring geometry and alternating orientation follow the physical link
    // language used by the Hunter x Hunter experience, but are placed on a
    // spherical surface so the chain reads as an object orbiting the planet.
    const linkGeometry = new THREE.TorusGeometry(0.115, 0.032, 10, 24);
    linkGeometry.scale(1.55, 1, 1);
    const linkMaterial = new THREE.MeshStandardMaterial({
        color: 0xd6e0ec,
        metalness: 0.94,
        roughness: 0.2,
        envMapIntensity: 1.7
    });
    const dummy = new THREE.Object3D();
    const radial = new THREE.Vector3();
    const tangent = new THREE.Vector3();
    const firstAxis = new THREE.Vector3();
    const secondAxis = new THREE.Vector3();
    const normalAxis = new THREE.Vector3();
    const basis = new THREE.Matrix4();
    const chains = [
        { latitude: -0.48, turns: 1.08, phase: 0.12 },
        { latitude: 0.02, turns: 1.22, phase: Math.PI * 0.64 },
        { latitude: 0.48, turns: 1.08, phase: Math.PI * 1.22 }
    ];

    chains.forEach((chain, chainIndex) => {
        const linkCount = 34;
        const links = new THREE.InstancedMesh(
            linkGeometry,
            linkMaterial.clone(),
            linkCount
        );
        links.name = `chain-strand-${chainIndex + 1}`;
        links.frustumCulled = false;
        links.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

        for (let index = 0; index < linkCount; index += 1) {
            const progress = index / linkCount;
            const longitude = chain.phase + progress * Math.PI * 2 * chain.turns;
            const latitude = chain.latitude + Math.sin(progress * Math.PI * 4 + chain.phase) * 0.035;
            const cosLatitude = Math.cos(latitude);

            radial.set(
                cosLatitude * Math.cos(longitude),
                Math.sin(latitude),
                cosLatitude * Math.sin(longitude)
            ).normalize();
            tangent.set(-Math.sin(longitude), 0, Math.cos(longitude)).normalize();

            if (index % 2 === 0) {
                firstAxis.copy(tangent);
                secondAxis.copy(radial);
            } else {
                firstAxis.copy(radial);
                secondAxis.copy(tangent);
            }
            normalAxis.crossVectors(firstAxis, secondAxis).normalize();
            basis.makeBasis(firstAxis, secondAxis, normalAxis);

            dummy.position.copy(radial).multiplyScalar(1.035);
            dummy.quaternion.setFromRotationMatrix(basis);
            dummy.scale.setScalar(0.86);
            dummy.updateMatrix();
            links.setMatrixAt(index, dummy.matrix);
        }

        links.instanceMatrix.needsUpdate = true;
        group.add(links);
    });

    return group;
}

function updatePlanetVisibility() {
    const usingGuava = activePlanetThemeIndex === 1;
    const usingChains = activePlanetThemeIndex === 0;

    if (moonMesh) moonMesh.visible = !usingGuava || !guavaPlanetReady;
    if (chainPlanetGroup) chainPlanetGroup.visible = usingChains;
    if (guavaPlanetGroup) guavaPlanetGroup.visible = usingGuava && guavaPlanetReady;
}

function loadGuavaPlanetModel() {
    new GLTFLoader().load(GUAVA_MODEL_PATH, gltf => {
        const source = gltf.scene;
        source.updateMatrixWorld(true);
        const model = new THREE.Group();
        model.name = "guava-glb-baked-model";

        source.traverse(child => {
            if (!child.isMesh || !child.geometry?.attributes?.position) return;
            const geometry = child.geometry.clone();
            geometry.applyMatrix4(child.matrixWorld);
            if (!geometry.attributes.normal) geometry.computeVertexNormals();
            const material = Array.isArray(child.material)
                ? child.material.map(entry => entry.clone())
                : child.material?.clone();
            const mesh = new THREE.Mesh(geometry, material);
            mesh.castShadow = false;
            mesh.receiveShadow = false;
            mesh.frustumCulled = false;
            model.add(mesh);
        });

        const bounds = new THREE.Box3().setFromObject(model);
        const center = bounds.getCenter(new THREE.Vector3());
        const size = bounds.getSize(new THREE.Vector3());
        const largestDimension = Math.max(size.x, size.y, size.z, 0.001);

        model.position.set(-center.x, -center.y, -center.z);
        model.scale.setScalar(1.86 / largestDimension);

        guavaPlanetGroup.add(model);
        guavaPlanetReady = true;
        updatePlanetVisibility();
    }, undefined, error => {
        console.warn("Guava planet model failed to load:", error);
    });
}

function createMoon() {
    moonGroup = new THREE.Group();
    const initialMoonPosition = MOON_POSITION_ANCHORS[1];
    moonAnchor.set(initialMoonPosition.x, initialMoonPosition.y, initialMoonPosition.z);
    moonTargetPosition.copy(moonAnchor);
    moonGroup.position.copy(moonAnchor);
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
    moonAtmosphere = createMoonAtmosphere();
    moonGroup.add(moonAtmosphere);

    chainPlanetGroup = createChainPlanet();
    chainPlanetGroup.visible = false;
    moonGroup.add(chainPlanetGroup);

    guavaPlanetGroup = new THREE.Group();
    guavaPlanetGroup.name = "guava-planet-model";
    guavaPlanetGroup.visible = false;
    moonGroup.add(guavaPlanetGroup);
    loadGuavaPlanetModel();

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
        nasaMoonTexture = texture;
        nasaMoonBumpTexture = createLuminanceTexture(texture.image);
        if (activePlanetThemeIndex < 0) {
            moonMaterial.map = nasaMoonTexture;
            moonMaterial.bumpMap = nasaMoonBumpTexture;
            moonMaterial.needsUpdate = true;
        }
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

function resetPolaroidFlight(polaroid, initial = false) {
    const layout = polaroidLayouts[polaroid.layoutIndex];
    polaroid.worldX = layout.position[0] + randomBetween(-0.8, 0.8);
    polaroid.worldY = layout.position[1] + randomBetween(-0.6, 0.6);
    polaroid.depth = initial
        ? -18 - (polaroid.sequenceIndex % 11) * 2.2 - randomBetween(0, 1.6)
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
    const layoutIndex = sequenceIndex % polaroidLayouts.length;
    const layout = polaroidLayouts[layoutIndex];

    const group = new THREE.Group();
    const body = new THREE.Mesh(polaroidBodyGeometry, polaroidBodyMaterial);
    const faceTexture = createPolaroidTexture(image);
    const faceMaterial = new THREE.MeshBasicMaterial({
        map: faceTexture,
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
        layoutIndex,
        sequenceIndex,
        baseRotation: new THREE.Euler(...layout.rotation),
        scale: layout.scale,
        worldX: layout.position[0],
        worldY: layout.position[1],
        depth: layout.position[2],
        phase: sequenceIndex * 1.37,
        speed: POLAROID_SPEED_MIN,
        faceMaterial
    };
    polaroids.push(polaroid);
    resetPolaroidFlight(polaroid, true);
}

function removePolaroidCard(polaroid) {
    worldScene.remove(polaroid.group);
    polaroid.faceMaterial.map?.dispose();
    polaroid.faceMaterial.dispose();
    const index = polaroids.indexOf(polaroid);
    if (index >= 0) polaroids.splice(index, 1);
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
        const rawEntries = await getTodayPhotoEntries();
        const entries = [...new Map(
            rawEntries
                .filter(entry => entry?.url)
                .map(entry => [entry.url, entry])
        ).values()];
        const poolUrls = new Set(entries.map(entry => entry.url));
        const freshEntries = entries.filter(entry => !knownPhotoUrls.has(entry.url));
        const poolChanged = poolUrls.size !== knownPhotoUrls.size ||
            [...poolUrls].some(url => !knownPhotoUrls.has(url));

        // Keep the current composition stable between polls. Re-randomize only
        // when today's pool changes, so polling does not constantly rebuild cards.
        if (!poolChanged && polaroids.length >= Math.min(POLAROID_MIN_COUNT, entries.length)) {
            return;
        }

        const targetCount = Math.min(
            entries.length,
            randomInteger(POLAROID_MIN_COUNT, POLAROID_MAX_COUNT)
        );
        const shuffledEntries = shuffled(entries);
        const selectedEntries = shuffledEntries.slice(0, targetCount);

        // A newly arrived lottery image always gets a chance to enter the scene.
        if (freshEntries.length > 0 && targetCount > 0) {
            const freshEntry = freshEntries[randomInteger(0, freshEntries.length - 1)];
            if (!selectedEntries.some(entry => entry.url === freshEntry.url)) {
                selectedEntries[selectedEntries.length - 1] = freshEntry;
            }
        }

        const selectedUrls = new Set(selectedEntries.map(entry => entry.url));
        for (const polaroid of [...polaroids]) {
            if (!selectedUrls.has(polaroid.url)) removePolaroidCard(polaroid);
        }

        const activeUrls = new Set(polaroids.map(polaroid => polaroid.url));
        await Promise.all(selectedEntries.map(async entry => {
            if (activeUrls.has(entry.url) || loadingPhotoUrls.has(entry.url) || failedPhotoUrls.has(entry.url)) {
                return;
            }

            loadingPhotoUrls.add(entry.url);
            try {
                const image = await loadPolaroidImage(entry.url);
                if (!image) {
                    failedPhotoUrls.add(entry.url);
                    return;
                }

                createPolaroidCard(image, entry.url, polaroidSequence);
                polaroidSequence += 1;
            } finally {
                loadingPhotoUrls.delete(entry.url);
            }
        }));

        knownPhotoUrls.clear();
        poolUrls.forEach(url => knownPhotoUrls.add(url));
    } catch (error) {
        console.warn("Today's photos are unavailable:", error);
    } finally {
        photoSyncInFlight = false;
    }

    crtUniforms.uSurfaceAspect.value = (CRT_WIDTH * width) / (CRT_HEIGHT * height);
}

function updatePolaroids(deltaSeconds, travelSpeed = 1) {
    for (const polaroid of polaroids) {
        polaroid.depth += deltaSeconds * polaroid.speed * Math.min(travelSpeed, 5.0);
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

const crtUniforms = {
    uMap: { value: new THREE.Texture() },
    uTime: { value: 0 },
    uImageAspect: { value: 1 },
    uSurfaceAspect: { value: 1.8 }
};
const crtGroup = new THREE.Group();
const crtButtonHitTargets = [];
const crtRaycaster = new THREE.Raycaster();
const crtPointer = new THREE.Vector2();
const planetRaycaster = new THREE.Raycaster();
const planetPointer = new THREE.Vector2();
let selectedPlanetIndex = 0;

const crtMaterial = new THREE.ShaderMaterial({
    uniforms: crtUniforms,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    vertexShader: `
        varying vec2 vUv;

        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D uMap;
        uniform float uTime;
        uniform float uImageAspect;
        uniform float uSurfaceAspect;
        varying vec2 vUv;

        float hash(vec2 point) {
            return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453);
        }

        vec2 fitImage(vec2 uv) {
            vec2 centered = uv - 0.5;
            if (uImageAspect > uSurfaceAspect) {
                centered.x *= uSurfaceAspect / uImageAspect;
            } else {
                centered.y *= uImageAspect / uSurfaceAspect;
            }
            return centered + 0.5;
        }

        void main() {
            vec2 curvedUv = vUv - 0.5;
            curvedUv *= 1.0 - dot(curvedUv, curvedUv) * 0.08;
            curvedUv += 0.5;

            vec2 sampleUv = fitImage(curvedUv);
            vec2 chromaOffset = vec2(0.0025, 0.0);
            float red = texture2D(uMap, clamp(sampleUv + chromaOffset, 0.001, 0.999)).r;
            float green = texture2D(uMap, clamp(sampleUv, 0.001, 0.999)).g;
            float blue = texture2D(uMap, clamp(sampleUv - chromaOffset, 0.001, 0.999)).b;
            vec3 color = vec3(red, green, blue);

            float scanlines = 0.93 + 0.07 * sin(curvedUv.y * 720.0 + uTime * 4.0);
            float phosphor = 0.985 + 0.015 * sin(curvedUv.x * 980.0);
            float flicker = 0.97 + 0.03 * sin(uTime * 16.0);
            float noise = (hash(curvedUv * vec2(900.0, 620.0) + uTime) - 0.5) * 0.035;
            float vignette = 1.0 - smoothstep(0.28, 0.78, length((curvedUv - 0.5) * vec2(0.92, 1.08)));

            color *= scanlines * phosphor * flicker;
            color *= 0.74 + vignette * 0.34;
            color = mix(color, color * vec3(0.72, 1.08, 0.99), 0.38);
            color += vec3(0.02, 0.055, 0.045) + noise;

            vec2 corner = abs(vUv - 0.5) - vec2(0.47, 0.43);
            float roundedMask = 1.0 - smoothstep(0.0, 0.022, length(max(corner, 0.0)));
            float edgeGlow = 1.0 - smoothstep(0.0, 0.065, length(max(corner, 0.0)));
            color += vec3(0.02, 0.13, 0.11) * edgeGlow;

            if (roundedMask < 0.01) discard;
            gl_FragColor = vec4(color, roundedMask * 0.96);
        }
    `
});

const crtScreenMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(CRT_WIDTH, CRT_HEIGHT),
    crtMaterial
);
crtScreenMesh.position.z = 0.04;
crtScreenMesh.renderOrder = 210;
crtScreenMesh.userData.isCrtScreen = true;
crtScreenMesh.frustumCulled = false;
crtGroup.add(crtScreenMesh);

function createCrtButton(direction) {
    const buttonGroup = new THREE.Group();
    buttonGroup.position.set(direction * (CRT_WIDTH * 0.5 + 0.105), 0.02, 0.05);

    const hitArea = new THREE.Mesh(
        new THREE.PlaneGeometry(0.16, 0.16),
        new THREE.MeshBasicMaterial({
            transparent: true,
            opacity: 0,
            depthTest: false,
            depthWrite: false
        })
    );
    hitArea.userData.crtDirection = direction;
    hitArea.renderOrder = 219;

    const arrowShape = new THREE.Shape();
    if (direction < 0) {
        arrowShape.moveTo(0.024, 0.036);
        arrowShape.lineTo(-0.026, 0);
        arrowShape.lineTo(0.024, -0.036);
    } else {
        arrowShape.moveTo(-0.024, 0.036);
        arrowShape.lineTo(0.026, 0);
        arrowShape.lineTo(-0.024, -0.036);
    }
    arrowShape.closePath();

    const arrow = new THREE.Mesh(
        new THREE.ShapeGeometry(arrowShape),
        new THREE.MeshBasicMaterial({
            color: 0xc9fff5,
            transparent: true,
            opacity: 0.96,
            depthTest: false,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        })
    );
    arrow.renderOrder = 222;

    buttonGroup.add(hitArea, arrow);
    crtGroup.add(buttonGroup);
    crtButtonHitTargets.push(hitArea);
}

createCrtButton(-1);
createCrtButton(1);

crtGroup.visible = false;
crtGroup.renderOrder = 200;
overlayScene.add(crtGroup);

const planetOptions = PLANET_TEXTURE_PATHS.map(path => ({
    path,
    texture: null,
    aspect: 1,
    bumpTexture: null
}));

function applySelectedPlanet() {
    const option = planetOptions[selectedPlanetIndex];
    if (!option?.texture) return;
    crtUniforms.uMap.value = option.texture;
    crtUniforms.uImageAspect.value = option.aspect;
    crtMaterial.needsUpdate = true;
}

function selectPlanet(index) {
    selectedPlanetIndex = (index + planetOptions.length) % planetOptions.length;
    applySelectedPlanet();
}

function applyMoonTheme() {
    activePlanetThemeIndex = -1;

    if (moonMaterial && nasaMoonTexture) {
        moonMaterial.color.setHex(0xffffff);
        moonMaterial.map = nasaMoonTexture;
        moonMaterial.bumpMap = nasaMoonBumpTexture;
        moonMaterial.bumpScale = 0.12;
        moonMaterial.needsUpdate = true;
    }

    backgroundUniforms.uThemePrimary.value.setHex(MOON_THEME.primary);
    backgroundUniforms.uThemeSecondary.value.setHex(MOON_THEME.secondary);
    backgroundUniforms.uThemeAccent.value.setHex(MOON_THEME.accent);
    backgroundUniforms.uTravelColor.value.setHex(MOON_THEME.transition);
    backgroundUniforms.uTravelSecondary.value.setHex(MOON_THEME.transitionSecondary);
    backgroundUniforms.uTravelThird.value.setHex(MOON_THEME.transitionThird);

    const moonPosition = MOON_POSITION_ANCHORS[1];
    moonTargetPosition.set(moonPosition.x, moonPosition.y, moonPosition.z);
    updatePlanetVisibility();
}

function applyPlanetSelection(index) {
    if (index < 0) {
        applyMoonTheme();
    } else {
        applyPlanetTheme(index);
    }
}

function applyPlanetTheme(index) {
    const option = planetOptions[index];
    const theme = PLANET_THEMES[index % PLANET_THEMES.length];
    activePlanetThemeIndex = index;

    if (option?.texture && moonMaterial) {
        if (!option.bumpTexture) {
            option.bumpTexture = createLuminanceTexture(option.texture.image);
        }

        moonMaterial.color.setHex(0xffffff);
        moonMaterial.map = option.texture;
        moonMaterial.bumpMap = option.bumpTexture;
        moonMaterial.bumpScale = index === 0 ? 0.045 : 0.08;
        moonMaterial.needsUpdate = true;
    }

    backgroundUniforms.uThemePrimary.value.setHex(theme.primary);
    backgroundUniforms.uThemeSecondary.value.setHex(theme.secondary);
    backgroundUniforms.uThemeAccent.value.setHex(theme.accent);
    backgroundUniforms.uTravelColor.value.setHex(theme.transition);
    backgroundUniforms.uTravelSecondary.value.setHex(theme.transitionSecondary);
    backgroundUniforms.uTravelThird.value.setHex(theme.transitionThird);

    const moonPosition = MOON_POSITION_ANCHORS[index % MOON_POSITION_ANCHORS.length];
    moonTargetPosition.set(moonPosition.x, moonPosition.y, moonPosition.z);
    updatePlanetVisibility();
}

function resetPlanetCycleTimer(index) {
    const sequenceIndex = PLANET_CYCLE_SEQUENCE.indexOf(index);
    if (sequenceIndex >= 0) planetCyclePosition = sequenceIndex;
    window.clearInterval(planetCycleTimer);
    planetCycleTimer = window.setInterval(advancePlanetCycle, PLANET_CYCLE_INTERVAL);
}

function startPlanetTransition(index, manuallySelected = false) {
    if (planetTransition || planetEntry) return;

    const theme = index < 0 ? MOON_THEME : PLANET_THEMES[index % PLANET_THEMES.length];
    if (manuallySelected) resetPlanetCycleTimer(index);
    if (index >= 0) {
        selectedPlanetIndex = index;
        applySelectedPlanet();
    }
    planetTransition = {
        targetIndex: index,
        elapsed: 0,
        applied: false
    };
    transitionIntensity = 0;
    travelUniforms.uColor.value.setHex(theme.transition);
    travelUniforms.uSecondary.value.setHex(theme.transitionSecondary);
    travelUniforms.uThird.value.setHex(theme.transitionThird);
    backgroundUniforms.uTravelColor.value.setHex(theme.transition);
    backgroundUniforms.uTravelSecondary.value.setHex(theme.transitionSecondary);
    backgroundUniforms.uTravelThird.value.setHex(theme.transitionThird);
    setCrtVisible(false);
}

function beginPlanetEntry(route) {
    if (planetTransition || planetEntry || !moonGroup) return false;

    const theme = activePlanetThemeIndex < 0
        ? MOON_THEME
        : PLANET_THEMES[activePlanetThemeIndex % PLANET_THEMES.length];
    const startPosition = moonGroup.position.clone();

    planetEntry = {
        route,
        elapsed: 0,
        navigated: false,
        startPosition,
        startScale: moonGroup.scale.x || MOON_BASE_SCALE,
        targetPosition: new THREE.Vector3(
            startPosition.x * 0.18,
            startPosition.y * 0.18,
            -3.1
        )
    };

    transitionIntensity = 0;
    travelUniforms.uColor.value.setHex(theme.transition);
    travelUniforms.uSecondary.value.setHex(theme.transitionSecondary);
    travelUniforms.uThird.value.setHex(theme.transitionThird);
    backgroundUniforms.uTravelColor.value.setHex(theme.transition);
    backgroundUniforms.uTravelSecondary.value.setHex(theme.transitionSecondary);
    backgroundUniforms.uTravelThird.value.setHex(theme.transitionThird);
    setCrtVisible(false);
    return true;
}

function updatePlanetTransition(deltaSeconds) {
    if (!planetTransition) {
        transitionIntensity = 0;
        backgroundUniforms.uTravel.value = 0;
        travelUniforms.uIntensity.value = 0;
        return 1;
    }

    planetTransition.elapsed += deltaSeconds;
    const accelerationStart = PLANET_TRANSITION_WAIT;
    const arrivalTime = accelerationStart + PLANET_TRANSITION_ACCELERATION;
    const accelerationProgress = clamp(
        (planetTransition.elapsed - accelerationStart) / PLANET_TRANSITION_ACCELERATION,
        0,
        1
    );
    const easedAcceleration = accelerationProgress * accelerationProgress * (3 - 2 * accelerationProgress);

    if (!planetTransition.applied && planetTransition.elapsed >= arrivalTime) {
        applyPlanetSelection(planetTransition.targetIndex);
        planetTransition.applied = true;
    }

    if (planetTransition.applied) {
        const settleProgress = clamp((planetTransition.elapsed - arrivalTime) / 0.34, 0, 1);
        transitionIntensity = (1 - settleProgress) * 0.24;
        if (settleProgress >= 1) {
            planetTransition = null;
            transitionIntensity = 0;
        }
    } else {
        transitionIntensity = easedAcceleration;
    }

    backgroundUniforms.uTravel.value = transitionIntensity;
    travelUniforms.uIntensity.value = transitionIntensity;
    if (!planetTransition || planetTransition.applied) return 1;
    return 1 + easedAcceleration * (PLANET_TRANSITION_MAX_SPEED - 1);
}

function updatePlanetEntry(deltaSeconds) {
    if (!planetEntry) return 1;

    planetEntry.elapsed += deltaSeconds;
    const progress = clamp(planetEntry.elapsed / PLANET_ENTRY_DURATION, 0, 1);
    const easedProgress = progress * progress * (3 - 2 * progress);
    transitionIntensity = easedProgress * 0.72;
    backgroundUniforms.uTravel.value = transitionIntensity;
    travelUniforms.uIntensity.value = transitionIntensity;

    if (progress >= 1 && !planetEntry.navigated) {
        planetEntry.navigated = true;
        window.location.assign(planetEntry.route);
    }

    return 1 + easedProgress * (PLANET_ENTRY_MAX_SPEED - 1);
}

function advancePlanetCycle() {
    planetCyclePosition = (planetCyclePosition + 1) % PLANET_CYCLE_SEQUENCE.length;
    startPlanetTransition(PLANET_CYCLE_SEQUENCE[planetCyclePosition]);
}

const planetTextureLoader = new THREE.TextureLoader();
planetOptions.forEach((option, index) => {
    planetTextureLoader.load(option.path, texture => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        option.texture = texture;
        const image = texture.image;
        option.aspect = (image.naturalWidth || image.width) / Math.max(image.naturalHeight || image.height, 1);
        if (index === selectedPlanetIndex) applySelectedPlanet();
    }, undefined, error => console.warn("Planet CRT texture failed to load:", error));
});

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

function getCockpitImageCoordinates(event) {
    const viewportAspect = width / height;
    const imageAspect = 1672 / 941;
    let imageX = event.clientX / width;
    let imageY = event.clientY / height;

    if (viewportAspect >= imageAspect) {
        imageY = 0.5 + (imageY - 0.5) / (viewportAspect / imageAspect);
    } else {
        imageX = 0.5 + (imageX - 0.5) / (imageAspect / viewportAspect);
    }

    return { x: imageX, y: imageY };
}

function isCockpitMonitorClick(event) {
    const imageCoordinates = getCockpitImageCoordinates(event);
    return imageCoordinates.x >= 0.34 &&
        imageCoordinates.x <= 0.66 &&
        imageCoordinates.y >= 0.78 &&
        imageCoordinates.y <= 1.02;
}

function setCrtVisible(visible) {
    crtGroup.visible = visible;
    if (visible) applySelectedPlanet();
}

function navigateToActivePlanet(event) {
    if (activePlanetThemeIndex < 0 || planetTransition || planetEntry || !moonGroup) return false;

    const route = PLANET_ROUTES[activePlanetThemeIndex];
    if (!route) return false;

    planetPointer.set(
        (event.clientX / width) * 2 - 1,
        -(event.clientY / height) * 2 + 1
    );
    planetRaycaster.setFromCamera(planetPointer, worldCamera);
    if (!planetRaycaster.intersectObject(moonGroup, true).length) return false;

    return beginPlanetEntry(route);
}

function handleStagePointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    startBackgroundMusic();

    if (planetEntry) {
        event.preventDefault();
        return;
    }

    crtPointer.set(
        (event.clientX / width) * 2 - 1,
        -(event.clientY / height) * 2 + 1
    );

    if (crtGroup.visible) {
        crtRaycaster.setFromCamera(crtPointer, overlayCamera);
        const buttonHit = crtRaycaster.intersectObjects(crtButtonHitTargets, false)[0];
        if (buttonHit?.object.userData.crtDirection) {
            selectPlanet(selectedPlanetIndex + buttonHit.object.userData.crtDirection);
            event.preventDefault();
            return;
        }

        const screenHit = crtRaycaster.intersectObject(crtScreenMesh, false).length > 0;
        if (screenHit) {
            startPlanetTransition(selectedPlanetIndex, true);
            return;
        }

        setCrtVisible(false);
        return;
    }

    if (navigateToActivePlanet(event)) {
        event.preventDefault();
        return;
    }

    if (isCockpitMonitorClick(event)) {
        setCrtVisible(true);
        event.preventDefault();
    }
}

function animate(now) {
    const deltaSeconds = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
    lastTime = now;
    elapsed += deltaSeconds * 1000;

    const transitionSpeed = updatePlanetTransition(deltaSeconds);
    const entrySpeed = updatePlanetEntry(deltaSeconds);
    const travelSpeed = Math.max(transitionSpeed, entrySpeed);
    const targetFov = planetEntry
        ? BASE_CAMERA_FOV - transitionIntensity * 10
        : BASE_CAMERA_FOV + transitionIntensity * 18;
    if (Math.abs(worldCamera.fov - targetFov) > 0.001) {
        worldCamera.fov = targetFov;
        worldCamera.updateProjectionMatrix();
    }

    const pointerBlend = Math.min(1, deltaSeconds * 60 / CAMERA_LAG);
    currentPointerX += (targetPointerX - currentPointerX) * pointerBlend;
    currentPointerY += (targetPointerY - currentPointerY) * pointerBlend;

    worldCamera.position.x = currentPointerX * 0.22;
    worldCamera.position.y = currentPointerY * 0.12;
    worldCamera.lookAt(currentPointerX * 0.1, currentPointerY * 0.06, -14);

    backgroundUniforms.uTime.value = elapsed * 0.001;
    backgroundUniforms.uPointer.value.set(currentPointerX, currentPointerY);
    travelUniforms.uTime.value = elapsed * 0.001;
    crtUniforms.uTime.value = elapsed * 0.001;
    moonAnchor.lerp(moonTargetPosition, Math.min(1, deltaSeconds * 3.4));
    const baseMoonPosition = new THREE.Vector3(
        moonAnchor.x - currentPointerX * 0.3,
        moonAnchor.y - currentPointerY * 0.18,
        moonAnchor.z
    );
    if (planetEntry) {
        const entryProgress = clamp(planetEntry.elapsed / PLANET_ENTRY_DURATION, 0, 1);
        const easedEntryProgress = entryProgress * entryProgress * (3 - 2 * entryProgress);
        moonGroup.position.lerpVectors(
            planetEntry.startPosition,
            planetEntry.targetPosition,
            easedEntryProgress
        );
    } else {
        moonGroup.position.copy(baseMoonPosition);
    }
    moonGroup.rotation.y += deltaSeconds * 0.018;
    moonGroup.rotation.x = Math.sin(elapsed * 0.00012) * 0.018;
    const approachScale = MOON_BASE_SCALE * (1.018 + Math.sin(elapsed * 0.00022) * 0.012);
    if (planetEntry) {
        const entryProgress = clamp(planetEntry.elapsed / PLANET_ENTRY_DURATION, 0, 1);
        const easedEntryProgress = entryProgress * entryProgress * (3 - 2 * entryProgress);
        moonGroup.scale.setScalar(THREE.MathUtils.lerp(
            planetEntry.startScale,
            planetEntry.startScale * PLANET_ENTRY_SCALE_MULTIPLIER,
            easedEntryProgress
        ));
    } else {
        moonGroup.scale.setScalar(approachScale);
    }

    updateStarfield(deltaSeconds, travelSpeed);
    updatePolaroids(deltaSeconds, travelSpeed);

    renderer.clear();
    renderer.render(backgroundScene, backgroundCamera);
    renderer.clearDepth();
    renderer.render(worldScene, worldCamera);
    renderer.clearDepth();
    renderer.render(overlayScene, overlayCamera);

    frameRequest = requestAnimationFrame(animate);
}

createMoon();
startBackgroundMusic();
syncTodayPolaroids();
photoSyncTimer = window.setInterval(syncTodayPolaroids, PHOTO_SYNC_INTERVAL);
planetCycleTimer = window.setInterval(advancePlanetCycle, PLANET_CYCLE_INTERVAL);
resize();
stage.addEventListener("pointermove", updatePointer, { passive: true });
stage.addEventListener("pointerdown", handleStagePointerDown);
stage.addEventListener("pointerleave", resetPointer, { passive: true });
window.addEventListener("resize", resize, { passive: true });
window.addEventListener("pagehide", () => {
    cancelAnimationFrame(frameRequest);
    window.clearInterval(photoSyncTimer);
    window.clearInterval(planetCycleTimer);
}, { once: true });
frameRequest = requestAnimationFrame(animate);
