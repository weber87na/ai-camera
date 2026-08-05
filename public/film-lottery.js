import * as THREE from "three";
import { OrbitControls } from "/vendor/three-addons/controls/OrbitControls.js";

const REFERENCE_IMAGES = Array.from({ length: 10 }, (_, index) => {
    const number = String(index + 1).padStart(2, "0");
    return `/images/style-${number}.webp`;
});

const POLL_INTERVAL = 10_000;
const MAX_IMAGES = 28;
const PRE_EXPLOSION_DURATION = 1.85;

const stage = document.querySelector("#filmStage");
const drawButton = document.querySelector("#drawButton");
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
scene.fog = new THREE.FogExp2(0x000000, 0.025);

const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 100);
camera.position.set(0, 0.6, 15);

const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "high-performance"
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.appendChild(renderer.domElement);

const cosmicBackdropUniforms = {
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uViewOffset: { value: new THREE.Vector2() }
};

const cosmicBackdropVertexShader = `
    void main() {
        gl_Position = vec4(position.xy, 1.0, 1.0);
    }
`;

const cosmicBackdropFragmentShader = `
    precision highp float;

    uniform float uTime;
    uniform vec2 uResolution;
    uniform vec2 uViewOffset;

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

    float starLayer(vec2 uv, float scale, float threshold, float seed) {
        vec2 grid = uv * scale;
        vec2 cell = floor(grid);
        vec2 local = fract(grid) - 0.5;
        float randomValue = hash21(cell + seed);
        vec2 offset = vec2(
            hash21(cell + seed + 11.7),
            hash21(cell + seed + 37.1)
        ) - 0.5;
        float radius = mix(0.018, 0.058, hash21(cell + seed + 72.4));
        float star = 1.0 - smoothstep(0.0, radius, length(local - offset * 0.72));
        float twinkle = 0.68 + sin(uTime * (1.1 + randomValue * 2.4) + randomValue * 31.4) * 0.32;
        return star * step(threshold, randomValue) * twinkle;
    }

    void main() {
        vec2 uv = gl_FragCoord.xy / uResolution.xy;
        vec2 aspectUv = (gl_FragCoord.xy - 0.5 * uResolution.xy) / uResolution.y;
        float horizon = 0.32;

        vec3 sky = mix(vec3(0.0, 0.001, 0.008), vec3(0.001, 0.006, 0.022), uv.y);
        vec2 starUv = aspectUv + uViewOffset * vec2(0.052, 0.034);
        float stars = starLayer(starUv, 118.0, 0.972, 4.3);
        stars += starLayer(starUv + vec2(0.17, 0.09), 205.0, 0.987, 19.6) * 0.72;
        float starMask = smoothstep(horizon - 0.01, horizon + 0.12, uv.y);
        float nebula = noise2(starUv * 3.2 + vec2(uTime * 0.008, 0.0));
        nebula *= noise2(starUv * 6.4 - vec2(0.0, uTime * 0.006));
        sky += vec3(0.018, 0.035, 0.1) * pow(nebula, 2.4) * starMask * 0.42;
        float starStrength = clamp(stars, 0.0, 1.0);
        sky += mix(vec3(0.36, 0.62, 1.0), vec3(0.93, 0.97, 1.0), starStrength) * stars * starMask;

        float time = uTime * 0.5;
        float x = aspectUv.x * 32.0 + uViewOffset.x * 2.5;
        float y = -aspectUv.y * 32.0;
        float sourceWave = sin(x / 10.0 + y / 15.0)
            * sin(x / 20.0 + time + sin(2.0 * time + y / 5.0));
        float secondaryWave = sin(x * 0.24 - time * 1.3 + sin(y * 0.31 + time))
            * sin(y * 0.18 + time * 0.72);
        float tears = pow(max(sourceWave, 0.0), 3.0);
        float fineTears = pow(max(secondaryWave, 0.0), 7.0);
        float waterTexture = noise2(vec2(x * 0.12 + time * 0.16, y * 0.08 - time * 0.1));

        vec3 ocean = vec3(0.0, 0.004, 0.027);
        ocean += vec3(0.0, 0.08, 0.34) * (0.16 + tears * 0.72 + waterTexture * 0.1);
        ocean += vec3(0.0, 0.42, 1.0) * tears * 0.82;
        ocean += vec3(0.08, 0.82, 1.0) * fineTears * (0.22 + tears * 0.68);

        float shoreline = exp(-pow((uv.y - horizon) / 0.036, 2.0));
        float shorelineBreaks = pow(max(0.0, sin(x * 0.42 + time * 1.7 + sin(x * 0.11))), 8.0);
        ocean += vec3(0.02, 0.58, 1.0) * shoreline * (0.12 + shorelineBreaks * 0.75);

        float lowerMask = 1.0 - smoothstep(horizon - 0.04, horizon + 0.04, uv.y);
        vec3 color = mix(sky, ocean, lowerMask);
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
    }
`;

const cosmicBackdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
        uniforms: cosmicBackdropUniforms,
        vertexShader: cosmicBackdropVertexShader,
        fragmentShader: cosmicBackdropFragmentShader,
        depthTest: false,
        depthWrite: false,
        fog: false
    })
);
cosmicBackdrop.frustumCulled = false;
cosmicBackdrop.renderOrder = -1000;
scene.add(cosmicBackdrop);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.055;
controls.rotateSpeed = 0.5;
controls.zoomSpeed = 0.8;
controls.panSpeed = 0.55;
controls.minDistance = 6;
controls.maxDistance = 28;
controls.minAzimuthAngle = -0.72;
controls.maxAzimuthAngle = 0.72;
controls.minPolarAngle = 0.92;
controls.maxPolarAngle = 2.2;
controls.target.set(0, 0, -1);

scene.add(new THREE.HemisphereLight(0xffffff, 0x080808, 1.75));

const keyLight = new THREE.DirectionalLight(0xffffff, 3.1);
keyLight.position.set(4, 7, 9);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.camera.left = -15;
keyLight.shadow.camera.right = 15;
keyLight.shadow.camera.top = 10;
keyLight.shadow.camera.bottom = -10;
scene.add(keyLight);

const rimLight = new THREE.PointLight(0x9bbcff, 28, 28, 2);
rimLight.position.set(-7, -1, 7);
scene.add(rimLight);

const warmLight = new THREE.PointLight(0xffd2a1, 22, 24, 2);
warmLight.position.set(7, 4, 3);
scene.add(warmLight);

const imageLibrary = [];
const loadedUrls = new Set();
const polaroidCards = [];
const polaroidFrontMaterials = [];
const photoBaseEmissive = new THREE.Color(0x181818);
const photoGoldEmissive = new THREE.Color(0xffb52c);
const photoEmissiveColor = new THREE.Color();
let photoHaloMaterial = null;
let lotteryState = "idle";
let phaseStartedAt = 0;
let winnerEntry = null;
let winnerMesh = null;
let pendingWallRefresh = false;
let lastCameraInteractionAt = -Infinity;

const photoWall = new THREE.Group();
photoWall.position.set(0, 0, -8.15);
photoWall.rotation.set(0.018, -0.035, 0);
scene.add(photoWall);

const lotteryGroup = new THREE.Group();
scene.add(lotteryGroup);

const polaroidGeometry = new THREE.BoxGeometry(1.32, 1.72, 0.055);
const paperMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xe9e5dc,
    roughness: 0.84,
    metalness: 0,
    clearcoat: 0.04
});

function localDateString() {
    const date = new Date();
    const pad = value => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function loadImage(url) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.decoding = "async";
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = url;
    });
}

async function addImage(url) {
    if (loadedUrls.has(url)) return false;
    loadedUrls.add(url);

    try {
        const image = await loadImage(url);
        imageLibrary.push({ url, image });
        if (imageLibrary.length > MAX_IMAGES) {
            const firstGeneratedIndex = imageLibrary.findIndex(entry => !REFERENCE_IMAGES.includes(entry.url));
            if (firstGeneratedIndex >= 0) {
                const [removed] = imageLibrary.splice(firstGeneratedIndex, 1);
                loadedUrls.delete(removed.url);
            }
        }
        return true;
    } catch {
        loadedUrls.delete(url);
        return false;
    }
}

function drawCover(context, image, x, y, width, height) {
    const sourceAspect = image.naturalWidth / image.naturalHeight;
    const targetAspect = width / height;
    let sourceWidth = image.naturalWidth;
    let sourceHeight = image.naturalHeight;
    let sourceX = 0;
    let sourceY = 0;

    if (sourceAspect > targetAspect) {
        sourceWidth = image.naturalHeight * targetAspect;
        sourceX = (image.naturalWidth - sourceWidth) / 2;
    } else {
        sourceHeight = image.naturalWidth / targetAspect;
        sourceY = (image.naturalHeight - sourceHeight) / 2;
    }

    context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
}

function createPolaroidTexture(image) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 660;
    const context = canvas.getContext("2d");

    context.fillStyle = "#ebe7df";
    context.fillRect(0, 0, canvas.width, canvas.height);
    drawCover(context, image, 34, 34, 444, 510);

    const fade = context.createLinearGradient(34, 34, 478, 544);
    fade.addColorStop(0, "rgba(255,246,226,0.08)");
    fade.addColorStop(0.58, "rgba(255,255,255,0)");
    fade.addColorStop(1, "rgba(82,53,34,0.12)");
    context.fillStyle = fade;
    context.fillRect(34, 34, 444, 510);

    context.strokeStyle = "rgba(80,65,50,0.16)";
    context.lineWidth = 2;
    context.strokeRect(34, 34, 444, 510);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    texture.needsUpdate = true;
    return texture;
}

function stableRandom(seed) {
    const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
    return value - Math.floor(value);
}

function updatePhotoGlow(amount, now = 0) {
    const glow = Math.max(0, amount);
    polaroidFrontMaterials.forEach((material, index) => {
        const shimmer = 0.92 + Math.sin(now * 2.3 + index * 0.37) * 0.08;
        const goldMix = Math.min(1, glow * 0.82);
        photoEmissiveColor.copy(photoBaseEmissive).lerp(photoGoldEmissive, goldMix);
        material.emissive.copy(photoEmissiveColor);
        material.emissiveIntensity = 1 + glow * (2.15 + shimmer * 0.8);
    });
    if (photoHaloMaterial) {
        photoHaloMaterial.opacity = Math.min(0.72, glow * 0.42);
    }
}

function rebuildPolaroidWall() {
    if (lotteryState !== "idle") {
        pendingWallRefresh = true;
        return;
    }

    polaroidCards.splice(0).forEach(card => photoWall.remove(card));
    polaroidFrontMaterials.splice(0).forEach(material => {
        material.map?.dispose();
        material.dispose();
    });

    if (imageLibrary.length === 0) return;

    imageLibrary.forEach(({ image }) => {
        const texture = createPolaroidTexture(image);
        polaroidFrontMaterials.push(new THREE.MeshPhysicalMaterial({
            map: texture,
            emissive: photoBaseEmissive,
            emissiveMap: texture,
            emissiveIntensity: 1,
            roughness: 0.76,
            metalness: 0,
            clearcoat: 0.08,
            clearcoatRoughness: 0.72
        }));
    });

    const columns = 12;
    const rows = 6;
    const spacingX = 1.82;
    const spacingY = 2.05;

    for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
            const index = row * columns + column;
            const materialIndex = (index * 7 + row * 3) % polaroidFrontMaterials.length;
            const frontMaterial = polaroidFrontMaterials[materialIndex];
            const materials = [paperMaterial, paperMaterial, paperMaterial, paperMaterial, frontMaterial, paperMaterial];
            const card = new THREE.Mesh(polaroidGeometry, materials);
            if (photoHaloMaterial) {
                const halo = new THREE.Mesh(photoHaloGeometry, photoHaloMaterial);
                halo.position.z = -0.041;
                halo.renderOrder = -1;
                card.add(halo);
            }
            const jitterX = (stableRandom(index + 1) - 0.5) * 0.12;
            const jitterY = (stableRandom(index + 101) - 0.5) * 0.1;
            const jitterZ = stableRandom(index + 211) * 0.035;

            card.position.set(
                (column - (columns - 1) / 2) * spacingX + jitterX,
                ((rows - 1) / 2 - row) * spacingY + jitterY,
                0.08 + jitterZ
            );
            card.rotation.set(
                (stableRandom(index + 307) - 0.5) * 0.025,
                (stableRandom(index + 401) - 0.5) * 0.03,
                (stableRandom(index + 503) - 0.5) * 0.075
            );
            card.userData.wallBasePosition = card.position.clone();
            card.userData.wallBaseRotation = card.rotation.clone();
            card.userData.wallPhase = stableRandom(index + 601) * Math.PI * 2;
            card.castShadow = true;
            card.receiveShadow = true;
            photoWall.add(card);
            polaroidCards.push(card);
        }
    }
}

const cardForward = new THREE.Vector3(0, 0, 1);
const lotteryCenter = new THREE.Vector3(0, 0, -0.35);
const lotteryTempQuaternion = new THREE.Quaternion();
const sphereCardScale = new THREE.Vector3(0.96, 0.96, 0.96);
const cameraOffset = new THREE.Vector3();
const cameraSpherical = new THREE.Spherical();

function createRadialGlowTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext("2d");
    const glow = context.createRadialGradient(128, 128, 0, 128, 128, 128);
    glow.addColorStop(0, "rgba(255,255,255,1)");
    glow.addColorStop(0.12, "rgba(255,248,198,0.98)");
    glow.addColorStop(0.32, "rgba(255,199,62,0.72)");
    glow.addColorStop(0.62, "rgba(255,129,0,0.24)");
    glow.addColorStop(1, "rgba(255,79,0,0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, canvas.width, canvas.height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
}

const moonGlowTexture = createRadialGlowTexture();
const photoHaloGeometry = new THREE.PlaneGeometry(1.78, 2.22);
photoHaloMaterial = new THREE.MeshBasicMaterial({
    map: moonGlowTexture,
    color: 0xffb52c,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide
});
const moonGroup = new THREE.Group();
moonGroup.position.copy(lotteryCenter);
moonGroup.visible = false;
scene.add(moonGroup);

const moonShaderUniforms = {
    uTime: { value: 0 },
    uEnergy: { value: 0 }
};

const moonVertexShader = `
    varying vec3 vObjectPosition;
    varying vec3 vWorldPosition;
    varying vec3 vWorldNormal;

    void main() {
        vObjectPosition = position;
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
`;

const moonFragmentShader = `
    precision highp float;

    uniform float uTime;
    uniform float uEnergy;
    varying vec3 vObjectPosition;
    varying vec3 vWorldPosition;
    varying vec3 vWorldNormal;

    float hash(vec3 p) {
        p = fract(p * 0.3183099 + vec3(0.11, 0.37, 0.71));
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
    }

    float noise3(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
            mix(mix(hash(i), hash(i + vec3(1.0, 0.0, 0.0)), f.x),
                mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
            mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x),
                mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
            f.z
        );
    }

    float fbm(vec3 p) {
        float value = 0.0;
        float amplitude = 0.5;
        for (int octave = 0; octave < 5; octave++) {
            value += amplitude * noise3(p);
            p = p * 2.03 + vec3(1.7, 3.1, 2.4);
            amplitude *= 0.5;
        }
        return value;
    }

    void main() {
        vec3 spherePoint = normalize(vObjectPosition);
        vec3 normalDirection = normalize(vWorldNormal);
        vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
        float viewFacing = clamp(dot(normalDirection, viewDirection), 0.0, 1.0);

        // The apparent depth of a glowing volume is greatest through its centre.
        // Using that depth instead of directional lighting keeps this from reading
        // as an opaque, surface-lit sphere.
        float volumeDepth = pow(viewFacing, 0.72);
        float whiteCore = pow(viewFacing, 3.4);
        float softEdge = smoothstep(0.025, 0.62, viewFacing);
        float rim = pow(1.0 - viewFacing, 2.4) * softEdge;

        vec3 drift = vec3(uTime * 0.06, -uTime * 0.035, uTime * 0.045);
        float cloudLarge = fbm(spherePoint * 3.4 + drift);
        float cloudFine = fbm(spherePoint * 7.2 - drift * 1.35 + cloudLarge * 0.9);
        float plasma = smoothstep(0.3, 0.84, cloudLarge * 0.68 + cloudFine * 0.32);
        float flowingEnergy = pow(
            max(0.0, sin((cloudLarge + spherePoint.y * 0.22) * 20.0 + uTime * 0.92)),
            7.0
        );
        float pulse = 0.9 + sin(uTime * 2.15) * 0.1;

        vec3 amber = vec3(1.0, 0.18, 0.0);
        vec3 laserGold = vec3(1.0, 0.56, 0.025);
        vec3 whiteGold = vec3(1.0, 0.94, 0.62);
        vec3 color = amber * volumeDepth * 0.28;
        color += laserGold * (volumeDepth * 0.68 + plasma * volumeDepth * 0.42);
        color += whiteGold * (whiteCore * 1.18 + flowingEnergy * volumeDepth * 0.34);
        color += laserGold * rim * 0.36;
        color *= pulse * (0.9 + uEnergy * 0.28);

        float alpha = 0.08 + volumeDepth * 0.42 + whiteCore * 0.26;
        alpha += plasma * volumeDepth * 0.1 + rim * 0.08;
        alpha *= softEdge * (0.72 + uEnergy * 0.2);

        gl_FragColor = vec4(color, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
    }
`;

const moonAuraFragmentShader = `
    precision highp float;

    uniform float uTime;
    uniform float uEnergy;
    varying vec3 vWorldPosition;
    varying vec3 vWorldNormal;

    void main() {
        vec3 normalDirection = normalize(vWorldNormal);
        vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
        float fresnel = pow(1.0 - abs(dot(normalDirection, viewDirection)), 2.15);
        float pulse = 0.82 + sin(uTime * 2.8) * 0.18;
        float alpha = fresnel * pulse * (0.32 + uEnergy * 0.2);
        vec3 color = mix(vec3(1.0, 0.24, 0.0), vec3(1.0, 0.86, 0.3), fresnel);
        gl_FragColor = vec4(color * (0.8 + uEnergy * 0.35), alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
    }
`;

const moonSphere = new THREE.Mesh(
    new THREE.SphereGeometry(2.58, 64, 40),
    new THREE.ShaderMaterial({
        uniforms: moonShaderUniforms,
        vertexShader: moonVertexShader,
        fragmentShader: moonFragmentShader,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        side: THREE.FrontSide
    })
);
moonGroup.add(moonSphere);

const moonAura = new THREE.Mesh(
    new THREE.SphereGeometry(2.76, 64, 40),
    new THREE.ShaderMaterial({
        uniforms: moonShaderUniforms,
        vertexShader: moonVertexShader,
        fragmentShader: moonAuraFragmentShader,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.FrontSide
    })
);
moonGroup.add(moonAura);

const preExplosionUniforms = {
    uTime: { value: 0 },
    uIntensity: { value: 0 },
    uBurst: { value: 0 }
};

const preExplosionFragmentShader = `
    precision highp float;

    uniform float uTime;
    uniform float uIntensity;
    uniform float uBurst;
    uniform float uGlowLayer;
    varying vec3 vObjectPosition;
    varying vec3 vWorldPosition;
    varying vec3 vWorldNormal;

    float hash(vec3 p) {
        p = fract(p * 0.3183099 + vec3(0.11, 0.37, 0.71));
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
    }

    float noise3(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
            mix(mix(hash(i), hash(i + vec3(1.0, 0.0, 0.0)), f.x),
                mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
            mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x),
                mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
            f.z
        );
    }

    float fbm(vec3 p) {
        float value = 0.0;
        float amplitude = 0.5;
        for (int octave = 0; octave < 4; octave++) {
            value += amplitude * noise3(p);
            p = p * 2.04 + vec3(1.7, 3.1, 2.4);
            amplitude *= 0.5;
        }
        return value;
    }

    void main() {
        vec3 point = normalize(vObjectPosition);
        vec3 normalDirection = normalize(vWorldNormal);
        vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
        float facing = clamp(dot(normalDirection, viewDirection), 0.0, 1.0);

        float burst = clamp(uBurst, 0.0, 1.0);
        vec3 drift = vec3(uTime * 0.072, -uTime * 0.046, uTime * 0.058);
        float warpA = fbm(point * 3.1 + drift);
        float warpB = fbm(point * 6.4 - drift * 1.35 + vec3(warpA * 1.4));
        vec3 domainWarp = vec3(warpA, warpB, warpA - warpB) * (1.2 + burst * 0.55);
        float field = fbm(point * 4.8 + domainWarp - drift * 0.62);
        float detail = fbm(point * 15.0 - drift * 1.8 + field * 0.82);
        field = clamp(field * 0.88 + detail * 0.12, 0.0, 1.0);

        // The SVG's table transfer becomes a narrow iso-line around the noise field.
        float threshold = 0.515 - burst * 0.018 + (detail - 0.5) * 0.045;
        float contourDistance = abs(field - threshold);
        float contourGlow = 1.0 - smoothstep(0.018, 0.072, contourDistance);
        float contourCore = 1.0 - smoothstep(0.004, 0.021, contourDistance);
        float secondaryContour = 1.0 - smoothstep(0.009, 0.038, abs(field - threshold - 0.145));

        float heat = smoothstep(0.22, 0.72, field);
        float molten = pow(smoothstep(0.42, 0.86, field), 1.8);
        float voids = 1.0 - smoothstep(0.31, 0.49, field);
        float rim = pow(1.0 - facing, 2.2);

        vec3 blackRed = vec3(0.002, 0.0, 0.0);
        vec3 deepRed = vec3(0.22, 0.002, 0.0);
        vec3 moltenRed = vec3(0.82, 0.025, 0.0);
        vec3 laserGold = vec3(1.0, 0.42, 0.008);
        vec3 whiteGold = vec3(1.0, 0.94, 0.58);

        if (uGlowLayer > 0.5) {
            vec3 glowColor = laserGold * (contourGlow * 1.35 + secondaryContour * 0.32);
            glowColor += whiteGold * contourCore * 2.4;
            float glowAlpha = (contourGlow * 0.52 + contourCore * 0.42) * uIntensity;
            gl_FragColor = vec4(glowColor * (0.78 + burst * 0.55), min(glowAlpha, 0.92));
        } else {
            vec3 color = mix(blackRed, deepRed, heat);
            color = mix(color, moltenRed, molten * 0.82);
            color *= 1.0 - voids * 0.88;
            color += laserGold * (contourGlow * 0.78 + secondaryContour * 0.18);
            color += whiteGold * contourCore * 1.52;
            color += deepRed * rim * 0.16;
            float surfaceAlpha = (0.16 + uIntensity * 0.69) * (0.94 + contourGlow * 0.06);
            gl_FragColor = vec4(color, min(surfaceAlpha, 0.9));
        }
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
    }
`;

const preExplosionGeometry = new THREE.SphereGeometry(3.05, 64, 40);
const preExplosionCloud = new THREE.Group();
const preExplosionSurface = new THREE.Mesh(
    preExplosionGeometry,
    new THREE.ShaderMaterial({
        uniforms: {
            ...preExplosionUniforms,
            uGlowLayer: { value: 0 }
        },
        vertexShader: moonVertexShader,
        fragmentShader: preExplosionFragmentShader,
        transparent: true,
        blending: THREE.NormalBlending,
        depthWrite: false,
        depthTest: true,
        side: THREE.FrontSide
    })
);
preExplosionSurface.renderOrder = 4;
preExplosionCloud.add(preExplosionSurface);

const preExplosionGlow = new THREE.Mesh(
    preExplosionGeometry,
    new THREE.ShaderMaterial({
        uniforms: {
            ...preExplosionUniforms,
            uGlowLayer: { value: 1 }
        },
        vertexShader: moonVertexShader,
        fragmentShader: preExplosionFragmentShader,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        side: THREE.FrontSide
    })
);
preExplosionGlow.scale.setScalar(1.008);
preExplosionGlow.renderOrder = 5;
preExplosionCloud.add(preExplosionGlow);
preExplosionCloud.visible = false;
moonGroup.add(preExplosionCloud);

const moonGlowMaterial = new THREE.SpriteMaterial({
    map: moonGlowTexture,
    color: 0xffbd32,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false
});
const moonGlow = new THREE.Sprite(moonGlowMaterial);
moonGlow.scale.set(7.8, 7.8, 1);
moonGroup.add(moonGlow);

const moonLight = new THREE.PointLight(0xffb52c, 0, 20, 1.55);
moonGroup.add(moonLight);

const energyWaveUniforms = {
    uTime: { value: 0 },
    uIntensity: { value: 0 },
    uBurst: { value: 0 }
};

const energyWaveVertexShader = `
    varying vec2 vUv;

    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const energyWaveFragmentShader = `
    precision highp float;

    uniform float uTime;
    uniform float uIntensity;
    uniform float uBurst;
    uniform float uPhase;
    varying vec2 vUv;

    float gaussian(float distanceValue, float width) {
        float ratio = distanceValue / width;
        return exp(-ratio * ratio);
    }

    void main() {
        float x = vUv.x;
        float y = vUv.y;
        float motion = uTime * (1.15 + uPhase * 0.08);
        float amplitude = 0.025 + uBurst * 0.035;
        float center = 0.5
            + sin(x * 11.0 + motion + uPhase) * amplitude
            + sin(x * 23.0 - motion * 0.72 + uPhase * 1.7) * amplitude * 0.42
            + sin(x * 4.5 + motion * 0.38) * amplitude * 0.58;
        float strandA = center + sin(x * 17.0 - motion * 1.2 + uPhase) * 0.026;
        float strandB = center - 0.045 + cos(x * 13.0 + motion * 0.82 + uPhase) * 0.022;
        float distanceMain = abs(y - center);
        float distanceA = abs(y - strandA);
        float distanceB = abs(y - strandB);

        float whiteCore = gaussian(distanceMain, 0.012 + uBurst * 0.01);
        float hotCore = gaussian(distanceMain, 0.032 + uBurst * 0.022);
        float goldGlow = gaussian(distanceMain, 0.105 + uBurst * 0.055);
        float amberBloom = gaussian(distanceMain, 0.255 + uBurst * 0.08);
        float fineStrands = gaussian(distanceA, 0.013) * 0.76 + gaussian(distanceB, 0.018) * 0.46;
        float horizontalFade = smoothstep(0.0, 0.16, x) * smoothstep(0.0, 0.16, 1.0 - x);
        float shimmer = 0.88 + sin(x * 31.0 - motion * 2.0 + uPhase) * 0.12;

        vec3 whiteGold = vec3(1.0, 0.96, 0.73);
        vec3 laserGold = vec3(1.0, 0.58, 0.035);
        vec3 amber = vec3(1.0, 0.19, 0.0);
        vec3 color = whiteGold * whiteCore * 1.4;
        color += whiteGold * fineStrands * shimmer;
        color += laserGold * hotCore * 1.15;
        color += laserGold * goldGlow * 0.72;
        color += amber * amberBloom * 0.34;

        float alpha = (whiteCore + fineStrands * 0.75 + hotCore * 0.82 + goldGlow * 0.48 + amberBloom * 0.16);
        alpha *= horizontalFade * uIntensity;
        gl_FragColor = vec4(color * uIntensity, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
    }
`;

const energyWaveGroup = new THREE.Group();
energyWaveGroup.position.copy(lotteryCenter);
energyWaveGroup.visible = false;
scene.add(energyWaveGroup);

const energyWaveGeometry = new THREE.PlaneGeometry(12.5, 5.2);
const energyWaveRotations = [
    [0, 0, 0.08],
    [0.26, 0.72, 0.62],
    [-0.48, -0.58, -0.38],
    [1.14, 0.18, 0.94],
    [-1.0, 0.42, -0.82]
];

energyWaveRotations.forEach((rotation, index) => {
    const material = new THREE.ShaderMaterial({
        uniforms: {
            uTime: energyWaveUniforms.uTime,
            uIntensity: energyWaveUniforms.uIntensity,
            uBurst: energyWaveUniforms.uBurst,
            uPhase: { value: index * 1.37 }
        },
        vertexShader: energyWaveVertexShader,
        fragmentShader: energyWaveFragmentShader,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide
    });
    const wave = new THREE.Mesh(energyWaveGeometry, material);
    wave.rotation.set(...rotation);
    wave.scale.setScalar(0.86 + index * 0.055);
    energyWaveGroup.add(wave);
});

const traceAgentCount = window.innerWidth < 700 ? 54 : 108;
const traceLength = window.innerWidth < 700 ? 20 : 34;
const traceRingCount = 12;
const tracePointsPerRing = 36;
const traceTargets = [];
const traceAgents = [];
const tracePositionData = new Float32Array(traceAgentCount * traceLength * 3);
const traceAlphaData = new Float32Array(traceAgentCount * traceLength);
const traceGeometry = new THREE.BufferGeometry();
const traceRotation = new THREE.Euler();
const traceTarget = new THREE.Vector3();
const traceAcceleration = new THREE.Vector3();

for (let ring = 0; ring < traceRingCount; ring += 1) {
    const latitude = -Math.PI / 2 + ((ring + 0.5) / traceRingCount) * Math.PI;
    const ringRadius = Math.cos(latitude);
    for (let point = 0; point < tracePointsPerRing; point += 1) {
        const longitude = (point / tracePointsPerRing) * Math.PI * 2 + (ring % 2) * 0.08;
        traceTargets.push(new THREE.Vector3(
            Math.cos(longitude) * ringRadius,
            Math.sin(latitude),
            Math.sin(longitude) * ringRadius
        ));
    }
}

for (let index = 0; index < traceAgentCount; index += 1) {
    const position = new THREE.Vector3();
    const velocity = new THREE.Vector3();
    const trail = Array.from({ length: traceLength }, () => new THREE.Vector3());
    traceAgents.push({
        position,
        velocity,
        trail,
        ring: index % traceRingCount,
        point: Math.floor(stableRandom(index + 2309) * tracePointsPerRing),
        direction: stableRandom(index + 2411) > 0.5 ? 1 : -1,
        speed: 24 + stableRandom(index + 2503) * 12,
        force: 0.86 + stableRandom(index + 2609) * 0.075,
        phase: stableRandom(index + 2711) * Math.PI * 2
    });
}

for (let agent = 0; agent < traceAgentCount; agent += 1) {
    for (let point = 0; point < traceLength; point += 1) {
        traceAlphaData[agent * traceLength + point] = 1 - point / traceLength;
    }
}

traceGeometry.setAttribute("position", new THREE.BufferAttribute(tracePositionData, 3));
traceGeometry.setAttribute("aAlpha", new THREE.BufferAttribute(traceAlphaData, 1));

const traceMaterial = new THREE.ShaderMaterial({
    uniforms: {
        uOpacity: { value: 0 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) }
    },
    vertexShader: `
        attribute float aAlpha;
        uniform float uPixelRatio;
        varying float vAlpha;

        void main() {
            vAlpha = aAlpha;
            vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * viewPosition;
            gl_PointSize = (1.4 + aAlpha * 4.8) * uPixelRatio * (14.0 / max(8.0, -viewPosition.z));
        }
    `,
    fragmentShader: `
        precision highp float;

        uniform float uOpacity;
        varying float vAlpha;

        void main() {
            float radialDistance = length(gl_PointCoord - vec2(0.5));
            float softParticle = smoothstep(0.5, 0.08, radialDistance);
            float hotCenter = smoothstep(0.22, 0.0, radialDistance);
            vec3 amber = vec3(1.0, 0.2, 0.0);
            vec3 gold = vec3(1.0, 0.62, 0.045);
            vec3 whiteGold = vec3(1.0, 0.96, 0.72);
            vec3 color = mix(amber, gold, vAlpha);
            color = mix(color, whiteGold, hotCenter * vAlpha);
            gl_FragColor = vec4(color, softParticle * vAlpha * uOpacity);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
        }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true
});

const moonTraceParticles = new THREE.Points(traceGeometry, traceMaterial);
moonTraceParticles.visible = false;
scene.add(moonTraceParticles);

function resetTraceFormation() {
    traceAgents.forEach((agent, index) => {
        const azimuth = stableRandom(index + 2801) * Math.PI * 2;
        const z = stableRandom(index + 2903) * 2 - 1;
        const radial = Math.sqrt(1 - z * z);
        const radius = 5.5 + stableRandom(index + 3001) * 4.5;
        agent.position.set(
            lotteryCenter.x + Math.cos(azimuth) * radial * radius,
            lotteryCenter.y + Math.sin(azimuth) * radial * radius,
            lotteryCenter.z + z * radius
        );
        agent.velocity.set(0, 0, 0);
        agent.point = Math.floor(stableRandom(index + 3109) * tracePointsPerRing);
        agent.trail.forEach(trailPoint => trailPoint.copy(agent.position));
    });
    moonTraceParticles.visible = true;
    traceMaterial.uniforms.uOpacity.value = 0;
}

function updateTraceFormation(now, delta, formationProgress) {
    if (!moonTraceParticles.visible) return;
    const pulse = 0.93 + (1 - Math.cos(now * 3.15)) * 0.035;
    const sphereRadius = 2.83 * THREE.MathUtils.lerp(0.72, pulse, formationProgress);
    traceRotation.set(
        Math.sin(now * 0.19) * 0.12,
        now * 0.22,
        Math.cos(now * 0.16) * 0.08
    );
    traceMaterial.uniforms.uOpacity.value = Math.min(1, formationProgress * 1.35);

    traceAgents.forEach((agent, agentIndex) => {
        const targetIndex = agent.ring * tracePointsPerRing + agent.point;
        traceTarget.copy(traceTargets[targetIndex]).applyEuler(traceRotation).multiplyScalar(sphereRadius).add(lotteryCenter);
        traceTarget.y += Math.sin(now * 0.9 + agent.phase) * 0.035;
        const distance = agent.position.distanceTo(traceTarget);

        if (distance < 0.28) {
            if (Math.random() > 0.985) agent.direction *= -1;
            if (Math.random() > 0.97) {
                agent.ring = Math.floor(Math.random() * traceRingCount);
                agent.point = Math.floor(Math.random() * tracePointsPerRing);
            } else {
                agent.point = THREE.MathUtils.euclideanModulo(agent.point + agent.direction, tracePointsPerRing);
            }
        }

        traceAcceleration.copy(traceTarget).sub(agent.position).normalize().multiplyScalar(agent.speed * delta);
        agent.velocity.add(traceAcceleration);
        agent.velocity.multiplyScalar(Math.pow(agent.force, delta * 60));
        agent.position.addScaledVector(agent.velocity, delta);
        agent.trail[0].copy(agent.position);

        const follow = 1 - Math.pow(0.58, delta * 60);
        for (let point = 1; point < traceLength; point += 1) {
            agent.trail[point].lerp(agent.trail[point - 1], follow);
        }

        for (let point = 0; point < traceLength; point += 1) {
            const offset = (agentIndex * traceLength + point) * 3;
            const trailPoint = agent.trail[point];
            tracePositionData[offset] = trailPoint.x;
            tracePositionData[offset + 1] = trailPoint.y;
            tracePositionData[offset + 2] = trailPoint.z;
        }
    });

    traceGeometry.getAttribute("position").needsUpdate = true;
}

const sparkCount = 520;
const sparkPositions = new Float32Array(sparkCount * 3);
const sparkVelocities = new Float32Array(sparkCount * 3);
const sparkColors = new Float32Array(sparkCount * 3);
const sparkGeometry = new THREE.BufferGeometry();
sparkGeometry.setAttribute("position", new THREE.BufferAttribute(sparkPositions, 3));
sparkGeometry.setAttribute("color", new THREE.BufferAttribute(sparkColors, 3));
const sparkMaterial = new THREE.PointsMaterial({
    map: moonGlowTexture,
    size: 0.095,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    alphaTest: 0.015,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false
});
const explosionSparks = new THREE.Points(sparkGeometry, sparkMaterial);
explosionSparks.visible = false;
scene.add(explosionSparks);

const shockwaveMaterial = new THREE.MeshBasicMaterial({
    color: 0xffc235,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false
});
const shockwave = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 96), shockwaveMaterial);
shockwave.position.copy(lotteryCenter);
shockwave.visible = false;
scene.add(shockwave);

const flashMaterial = new THREE.SpriteMaterial({
    map: moonGlowTexture,
    color: 0xffe6a0,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false
});
const explosionFlash = new THREE.Sprite(flashMaterial);
explosionFlash.position.copy(lotteryCenter);
explosionFlash.visible = false;
scene.add(explosionFlash);

const explosionLight = new THREE.PointLight(0xffad21, 0, 34, 1.4);
explosionLight.position.copy(lotteryCenter);
scene.add(explosionLight);
let explosionAge = Infinity;

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

function updateWallCards(elapsed) {
    if (lotteryState !== "idle") return;

    polaroidCards.forEach((card, index) => {
        if (card.parent !== photoWall) return;
        const basePosition = card.userData.wallBasePosition;
        const baseRotation = card.userData.wallBaseRotation;
        const phase = card.userData.wallPhase || 0;
        if (!basePosition || !baseRotation) return;

        const slowWave = Math.sin(elapsed * 0.42 + phase + index * 0.035);
        const crossWave = Math.cos(elapsed * 0.31 + phase * 0.7);
        card.position.set(
            basePosition.x + crossWave * 0.012,
            basePosition.y + slowWave * 0.028,
            basePosition.z + (slowWave + 1) * 0.022
        );
        card.rotation.set(
            baseRotation.x + crossWave * 0.006,
            baseRotation.y + slowWave * 0.007,
            baseRotation.z + slowWave * 0.009
        );
    });
}

function updateCameraMotion(now, delta) {
    const canDrift = lotteryState === "idle" && controls.enabled && now - lastCameraInteractionAt > 2.5;
    if (!canDrift) return;

    cameraOffset.copy(camera.position).sub(controls.target);
    cameraSpherical.setFromVector3(cameraOffset);
    const blend = 1 - Math.exp(-delta * 0.2);
    const desiredRadius = 16.2 + Math.sin(now * 0.18) * 1.35;
    const desiredTheta = Math.sin(now * 0.105) * 0.28;
    const desiredPhi = Math.PI / 2 - 0.035 + Math.sin(now * 0.083) * 0.075;

    cameraSpherical.radius = THREE.MathUtils.lerp(cameraSpherical.radius, desiredRadius, blend);
    cameraSpherical.theta = THREE.MathUtils.lerp(cameraSpherical.theta, desiredTheta, blend);
    cameraSpherical.phi = THREE.MathUtils.lerp(cameraSpherical.phi, desiredPhi, blend);
    cameraOffset.setFromSpherical(cameraSpherical);
    camera.position.copy(controls.target).add(cameraOffset);
}

function resetExplosionEffects() {
    explosionAge = Infinity;
    explosionSparks.visible = false;
    sparkMaterial.opacity = 0;
    shockwave.visible = false;
    shockwaveMaterial.opacity = 0;
    explosionFlash.visible = false;
    flashMaterial.opacity = 0;
    explosionLight.intensity = 0;
    moonGroup.visible = false;
    moonGroup.scale.setScalar(0.01);
    moonGlowMaterial.opacity = 0;
    moonLight.intensity = 0;
    moonShaderUniforms.uEnergy.value = 0;
    preExplosionCloud.visible = false;
    preExplosionCloud.scale.setScalar(1);
    preExplosionUniforms.uIntensity.value = 0;
    preExplosionUniforms.uBurst.value = 0;
    updatePhotoGlow(0);
    energyWaveGroup.visible = false;
    energyWaveGroup.scale.setScalar(1);
    energyWaveUniforms.uIntensity.value = 0;
    energyWaveUniforms.uBurst.value = 0;
    moonTraceParticles.visible = false;
    traceMaterial.uniforms.uOpacity.value = 0;
}

function startExplosionEffects() {
    explosionAge = 0;
    explosionSparks.visible = true;
    sparkMaterial.opacity = 1;
    shockwave.visible = true;
    shockwave.scale.setScalar(0.15);
    shockwaveMaterial.opacity = 1;
    explosionFlash.visible = true;
    explosionFlash.scale.set(2.8, 2.8, 1);
    flashMaterial.opacity = 0.76;
    explosionLight.intensity = 62;
    energyWaveGroup.visible = true;
    energyWaveGroup.scale.setScalar(1);
    energyWaveUniforms.uIntensity.value = 1.02;
    energyWaveUniforms.uBurst.value = 1;

    const color = new THREE.Color();
    for (let index = 0; index < sparkCount; index += 1) {
        const offset = index * 3;
        const azimuth = Math.random() * Math.PI * 2;
        const z = Math.random() * 2 - 1;
        const radial = Math.sqrt(1 - z * z);
        const speed = 4.5 + Math.pow(Math.random(), 0.42) * 11;
        const startRadius = 2.1 + Math.random() * 0.65;
        const x = Math.cos(azimuth) * radial;
        const y = Math.sin(azimuth) * radial;

        sparkPositions[offset] = lotteryCenter.x + x * startRadius;
        sparkPositions[offset + 1] = lotteryCenter.y + y * startRadius;
        sparkPositions[offset + 2] = lotteryCenter.z + z * startRadius;
        sparkVelocities[offset] = x * speed;
        sparkVelocities[offset + 1] = y * speed;
        sparkVelocities[offset + 2] = z * speed;

        color.setHSL(0.085 + Math.random() * 0.07, 0.72 + Math.random() * 0.26, 0.62 + Math.random() * 0.34);
        sparkColors[offset] = color.r;
        sparkColors[offset + 1] = color.g;
        sparkColors[offset + 2] = color.b;
    }
    sparkGeometry.getAttribute("position").needsUpdate = true;
    sparkGeometry.getAttribute("color").needsUpdate = true;
}

function updateExplosionEffects(delta) {
    if (!Number.isFinite(explosionAge)) return;
    explosionAge += delta;
    moonShaderUniforms.uTime.value += delta;
    moonShaderUniforms.uEnergy.value = Math.max(0, 2.5 - explosionAge * 6.5);
    const drag = Math.exp(-delta * 0.72);

    for (let index = 0; index < sparkCount; index += 1) {
        const offset = index * 3;
        sparkVelocities[offset] *= drag;
        sparkVelocities[offset + 1] = sparkVelocities[offset + 1] * drag - delta * 0.9;
        sparkVelocities[offset + 2] *= drag;
        sparkPositions[offset] += sparkVelocities[offset] * delta;
        sparkPositions[offset + 1] += sparkVelocities[offset + 1] * delta;
        sparkPositions[offset + 2] += sparkVelocities[offset + 2] * delta;
    }
    sparkGeometry.getAttribute("position").needsUpdate = true;

    const shockProgress = Math.min(explosionAge / 0.82, 1);
    shockwave.quaternion.copy(camera.quaternion);
    shockwave.scale.setScalar(0.15 + easeOutCubic(shockProgress) * 9.5);
    shockwaveMaterial.opacity = Math.max(0, 1 - shockProgress) * 0.9;
    explosionFlash.scale.setScalar(2.8 + easeOutCubic(Math.min(explosionAge / 0.5, 1)) * 10);
    flashMaterial.opacity = 0.76 * Math.exp(-explosionAge * 7.5);
    explosionLight.intensity = 62 * Math.exp(-explosionAge * 6.2);
    sparkMaterial.opacity = Math.max(0, 1 - explosionAge / 1.65);
    traceMaterial.uniforms.uOpacity.value = Math.max(0, 1 - explosionAge / 0.32);
    if (explosionAge > 0.38) moonTraceParticles.visible = false;
    moonGroup.scale.setScalar(Math.max(0.01, 1 - explosionAge / 0.34));
    moonGlowMaterial.opacity *= Math.exp(-delta * 13);
    energyWaveUniforms.uTime.value += delta;
    energyWaveGroup.rotation.y += delta * 0.42;
    energyWaveGroup.rotation.z -= delta * 0.2;
    energyWaveGroup.scale.setScalar(1 + easeOutCubic(Math.min(explosionAge / 0.75, 1)) * 2.7);
    energyWaveUniforms.uIntensity.value = Math.max(0, 1.02 - explosionAge / 0.72);
    energyWaveUniforms.uBurst.value = Math.max(0, 1 - explosionAge / 0.86);

    if (explosionAge >= 1.7) {
        explosionSparks.visible = false;
        shockwave.visible = false;
        explosionFlash.visible = false;
        explosionLight.intensity = 0;
        moonGroup.visible = false;
        energyWaveGroup.visible = false;
        explosionAge = Infinity;
    }
}

function restoreLotteryScene() {
    if (winnerMesh) {
        scene.remove(winnerMesh);
        winnerMesh = null;
    }

    polaroidCards.forEach(card => {
        const home = card.userData.lotteryHome;
        photoWall.attach(card);
        if (home) {
            card.position.copy(home.position);
            card.quaternion.copy(home.quaternion);
            card.scale.copy(home.scale);
        }
        card.visible = true;
        delete card.userData.lottery;
        delete card.userData.lotteryHome;
    });

    lotteryGroup.rotation.set(0, 0, 0);
    controls.enabled = true;
    lotteryState = "idle";
    drawButton.disabled = false;
    drawButton.textContent = "抽獎";
    lastCameraInteractionAt = performance.now() / 1000;
    resetExplosionEffects();

    if (pendingWallRefresh) {
        pendingWallRefresh = false;
        rebuildPolaroidWall();
    }
}

function beginLottery() {
    if (lotteryState !== "idle" || polaroidCards.length === 0) return;

    const todayEntries = imageLibrary.filter(entry => !REFERENCE_IMAGES.includes(entry.url));
    const eligibleEntries = todayEntries.length ? todayEntries : imageLibrary;
    winnerEntry = eligibleEntries[Math.floor(Math.random() * eligibleEntries.length)];

    drawButton.disabled = true;
    drawButton.textContent = "抽獎中";
    controls.enabled = false;
    lotteryGroup.rotation.set(0, 0, 0);
    resetExplosionEffects();
    moonGroup.visible = true;
    moonSphere.rotation.set(0, 0, 0);
    energyWaveGroup.visible = true;
    energyWaveGroup.rotation.set(0, 0, 0);
    energyWaveGroup.scale.setScalar(0.1);
    resetTraceFormation();

    const count = polaroidCards.length;
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));

    polaroidCards.forEach((card, index) => {
        card.userData.lotteryHome = {
            position: card.position.clone(),
            quaternion: card.quaternion.clone(),
            scale: card.scale.clone()
        };
        lotteryGroup.attach(card);

        const startPosition = card.position.clone();
        const startQuaternion = card.quaternion.clone();
        const startScale = card.scale.clone();
        const y = 1 - 2 * ((index + 0.5) / count);
        const ringRadius = Math.sqrt(Math.max(0, 1 - y * y));
        const theta = goldenAngle * index;
        const normal = new THREE.Vector3(Math.cos(theta) * ringRadius, y, Math.sin(theta) * ringRadius);
        const spherePosition = normal.clone().multiplyScalar(3.35).add(lotteryCenter);
        const sphereQuaternion = new THREE.Quaternion().setFromUnitVectors(cardForward, normal);
        const randomX = stableRandom(index + 701) - 0.5;
        const randomY = stableRandom(index + 809) - 0.5;
        const randomZ = stableRandom(index + 907) - 0.5;
        const explosionVelocity = normal.clone().multiplyScalar(8.5 + stableRandom(index + 1009) * 4.5);
        explosionVelocity.add(new THREE.Vector3(randomX, randomY, randomZ).multiplyScalar(3.2));
        const spinAxis = new THREE.Vector3(randomY, randomZ, randomX).normalize();

        card.userData.lottery = {
            startPosition,
            startQuaternion,
            startScale,
            spherePosition,
            sphereQuaternion,
            explosionVelocity,
            spinAxis,
            spinAmount: 2.5 + stableRandom(index + 1103) * 5
        };
    });

    lotteryState = "forming";
    phaseStartedAt = performance.now() / 1000;
}

function revealWinner(now) {
    updatePhotoGlow(0);
    preExplosionCloud.visible = false;
    const winnerIndex = Math.max(0, imageLibrary.indexOf(winnerEntry));
    const frontMaterial = polaroidFrontMaterials[winnerIndex % polaroidFrontMaterials.length];
    const materials = [paperMaterial, paperMaterial, paperMaterial, paperMaterial, frontMaterial, paperMaterial];
    winnerMesh = new THREE.Mesh(polaroidGeometry, materials);
    winnerMesh.position.set(0, -1.7, 3.5);
    winnerMesh.rotation.set(-0.035, 0.045, -0.065);
    winnerMesh.scale.setScalar(0.01);
    winnerMesh.castShadow = true;
    winnerMesh.receiveShadow = true;
    scene.add(winnerMesh);

    lotteryState = "winner-enter";
    phaseStartedAt = now;
}

function updateLottery(now, delta) {
    if (lotteryState === "idle") return;

    if (lotteryState === "forming") {
        const progress = THREE.MathUtils.clamp((now - phaseStartedAt) / 2.1, 0, 1);
        const eased = easeInOutCubic(progress);
        preExplosionCloud.visible = false;
        preExplosionUniforms.uIntensity.value = 0;
        lotteryGroup.rotation.y += delta * 0.22;
        const moonProgress = easeOutCubic(progress);
        moonShaderUniforms.uTime.value = now;
        moonShaderUniforms.uEnergy.value = moonProgress;
        moonGroup.scale.setScalar(Math.max(0.01, moonProgress));
        moonGlowMaterial.opacity = moonProgress * 0.54;
        moonLight.intensity = moonProgress * 34;
        updatePhotoGlow(moonProgress * 0.95, now);
        moonSphere.rotation.y += delta * 0.08;
        energyWaveUniforms.uTime.value = now;
        energyWaveUniforms.uIntensity.value = moonProgress * 0.68;
        energyWaveUniforms.uBurst.value = moonProgress * 0.12;
        energyWaveGroup.scale.setScalar(Math.max(0.1, moonProgress));
        energyWaveGroup.rotation.y += delta * 0.08;
        energyWaveGroup.rotation.z -= delta * 0.045;
        updateTraceFormation(now, delta, moonProgress);

        polaroidCards.forEach(card => {
            const data = card.userData.lottery;
            card.position.lerpVectors(data.startPosition, data.spherePosition, eased);
            card.quaternion.slerpQuaternions(data.startQuaternion, data.sphereQuaternion, eased);
            card.scale.copy(data.startScale).lerp(sphereCardScale, eased);
        });

        if (progress >= 1) {
            lotteryState = "sphere";
            phaseStartedAt = now;
        }
        return;
    }

    if (lotteryState === "sphere") {
        const sphereElapsed = now - phaseStartedAt;
        const chargeProgress = THREE.MathUtils.clamp(sphereElapsed / PRE_EXPLOSION_DURATION, 0, 1);
        const charge = easeInOutCubic(chargeProgress);
        preExplosionCloud.visible = true;
        preExplosionUniforms.uTime.value = now;
        preExplosionUniforms.uBurst.value = charge;
        preExplosionUniforms.uIntensity.value = 0.12 + charge * 1.05;
        preExplosionCloud.rotation.y += delta * (0.16 + charge * 0.2);
        preExplosionCloud.rotation.x = Math.sin(now * 0.72) * 0.07;
        preExplosionCloud.scale.setScalar(1 + charge * 0.045 + Math.sin(now * 2.6) * 0.012);
        moonShaderUniforms.uTime.value = now;
        moonShaderUniforms.uEnergy.value = 1.15 + Math.sin(sphereElapsed * 2.7) * 0.12;
        lotteryGroup.rotation.y += delta * 0.48;
        lotteryGroup.rotation.x = Math.sin(sphereElapsed * 1.5) * 0.055;
        moonSphere.rotation.y += delta * 0.12;
        moonGroup.scale.setScalar(1 + Math.sin(sphereElapsed * 2.4) * 0.012);
        moonGlowMaterial.opacity = 0.62 + Math.sin(sphereElapsed * 2.8) * 0.055;
        moonLight.intensity = 36 + Math.sin(sphereElapsed * 3.1) * 5;
        updatePhotoGlow(1.12 + Math.sin(sphereElapsed * 2.6) * 0.08, now);
        energyWaveUniforms.uTime.value = now;
        energyWaveUniforms.uIntensity.value = 0.32 + charge * 0.22 + Math.sin(sphereElapsed * 3.1) * 0.035;
        energyWaveUniforms.uBurst.value = 0.08 + charge * 0.08;
        energyWaveGroup.rotation.y += delta * 0.14;
        energyWaveGroup.rotation.z -= delta * 0.075;
        updateTraceFormation(now, delta, 1);
        if (sphereElapsed >= PRE_EXPLOSION_DURATION) {
            lotteryState = "exploding";
            phaseStartedAt = now;
            startExplosionEffects();
        }
        return;
    }

    if (lotteryState === "exploding") {
        const progress = THREE.MathUtils.clamp((now - phaseStartedAt) / 1.05, 0, 1);
        const eased = easeOutCubic(progress);
        const preExplosionProgress = THREE.MathUtils.clamp(progress / 0.42, 0, 1);
        preExplosionCloud.visible = preExplosionProgress < 1;
        preExplosionUniforms.uTime.value = now;
        preExplosionUniforms.uBurst.value = 1;
        preExplosionUniforms.uIntensity.value = Math.max(0, 1.18 * (1 - preExplosionProgress));
        preExplosionCloud.rotation.y += delta * (0.36 + preExplosionProgress * 0.32);
        preExplosionCloud.rotation.z -= delta * 0.18;
        preExplosionCloud.scale.setScalar(1.045 + easeOutCubic(preExplosionProgress) * 1.55);
        updatePhotoGlow(Math.max(0, 1.12 * (1 - progress) * (1 - progress)), now);

        polaroidCards.forEach(card => {
            const data = card.userData.lottery;
            card.position.copy(data.spherePosition).addScaledVector(data.explosionVelocity, eased);
            lotteryTempQuaternion.setFromAxisAngle(data.spinAxis, data.spinAmount * eased);
            card.quaternion.copy(data.sphereQuaternion).multiply(lotteryTempQuaternion);
            card.scale.setScalar(0.96 - eased * 0.48);
        });

        if (progress >= 1) {
            polaroidCards.forEach(card => { card.visible = false; });
            revealWinner(now);
        }
        return;
    }

    if (lotteryState === "winner-enter") {
        const progress = THREE.MathUtils.clamp((now - phaseStartedAt) / 0.82, 0, 1);
        const scale = Math.max(0.01, easeOutBack(progress) * 3.05);
        winnerMesh.scale.setScalar(scale);
        winnerMesh.position.y = THREE.MathUtils.lerp(-1.7, 0.15, easeOutCubic(progress));

        if (progress >= 1) {
            lotteryState = "winner";
            phaseStartedAt = now;
            controls.enabled = true;
            drawButton.disabled = false;
            drawButton.textContent = "再抽一次";
        }
        return;
    }

    if (lotteryState === "winner" && winnerMesh) {
        winnerMesh.position.y = 0.15 + Math.sin(now * 1.3) * 0.055;
        winnerMesh.rotation.y = 0.045 + Math.sin(now * 0.7) * 0.018;
    }
}

async function refreshPhotos() {
    try {
        const response = await fetch(`/api/photos/${localDateString()}`, { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json();
        const results = await Promise.all((data.images || []).map(addImage));
        if (results.some(Boolean)) rebuildPolaroidWall();
    } catch {
        // Reference images keep the installation alive if today's gallery is unavailable.
    }
}

function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height, false);
    renderer.getDrawingBufferSize(cosmicBackdropUniforms.uResolution.value);
    camera.aspect = width / height;
    camera.fov = width < height ? 58 : 44;
    camera.updateProjectionMatrix();
}

async function init() {
    await Promise.all(REFERENCE_IMAGES.map(addImage));
    await refreshPhotos();
    if (polaroidCards.length === 0) rebuildPolaroidWall();
    if (polaroidCards.length === 0) return;

    window.setInterval(refreshPhotos, POLL_INTERVAL);
    const clock = new THREE.Clock();

    renderer.setAnimationLoop(() => {
        const delta = Math.min(clock.getDelta(), 0.05);
        const elapsed = clock.elapsedTime;
        const now = performance.now() / 1000;
        updateWallCards(elapsed);
        updateLottery(now, delta);
        updateExplosionEffects(delta);
        updateCameraMotion(now, delta);
        controls.update();
        cosmicBackdropUniforms.uTime.value = elapsed;
        cosmicBackdropUniforms.uViewOffset.value.set(camera.rotation.y, camera.rotation.x);
        renderer.render(scene, camera);
    });
}

renderer.domElement.addEventListener("wheel", event => {
    lastCameraInteractionAt = performance.now() / 1000;
}, { passive: true });

controls.addEventListener("start", () => {
    lastCameraInteractionAt = performance.now() / 1000;
});

controls.addEventListener("end", () => {
    lastCameraInteractionAt = performance.now() / 1000;
});

drawButton.addEventListener("click", () => {
    if (lotteryState === "winner") {
        restoreLotteryScene();
        requestAnimationFrame(beginLottery);
        return;
    }
    beginLottery();
});

window.addEventListener("resize", resize, { passive: true });
window.addEventListener("pagehide", () => renderer.setAnimationLoop(null), { once: true });

resize();
init();
