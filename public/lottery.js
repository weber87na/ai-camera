import * as THREE from "three";

const EXAMPLE_IMAGES = Array.from({ length: 10 }, (_, index) => {
    const number = String(index + 1).padStart(2, "0");
    return `/example-images/${number}.jpg`;
});

const POLL_INTERVAL = 15_000;
const CARD_WIDTH = 2.48;
const CARD_HEIGHT = 1.62;
const CARD_STEP = 2.72;
const STRIP_HEIGHT = 2.02;
const ROW_Y = [2.12, 0, -2.12];
const ROWS = [
    { speed: 0.42, phase: -1.1, orderOffset: 0, rotation: -0.014, drag: 0.85 },
    { speed: -0.68, phase: 1.8, orderOffset: 3, rotation: 0.009, drag: 1.0 },
    { speed: 0.96, phase: -2.9, orderOffset: 6, rotation: -0.012, drag: 1.18 }
];

const stage = document.querySelector("#filmStage");

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x101216, 12, 26);

const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 80);
camera.position.set(0, 0.1, 15.3);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: "high-performance"
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.domElement.setAttribute("aria-hidden", "true");
stage.appendChild(renderer.domElement);

scene.add(new THREE.AmbientLight(0xfff7ed, 1.8));

const keyLight = new THREE.DirectionalLight(0xffe5c7, 2.3);
keyLight.position.set(-4, 5, 8);
scene.add(keyLight);

const rimLight = new THREE.PointLight(0xc5dcff, 18, 22, 2);
rimLight.position.set(5, -1, 7);
scene.add(rimLight);

const wall = new THREE.Group();
// Match the reference wall: the left edge stays close while the film recedes at 45°.
wall.rotation.y = THREE.MathUtils.degToRad(45);
wall.rotation.x = 0;
wall.position.x = 3.8;
scene.add(wall);

const textureLoader = new THREE.TextureLoader();
const textureCache = new Map();
const frameGeometry = new THREE.PlaneGeometry(CARD_WIDTH + 0.16, CARD_HEIGHT + 0.2);
const imageGeometry = new THREE.PlaneGeometry(CARD_WIDTH, CARD_HEIGHT);
const edgeGeometry = new THREE.EdgesGeometry(imageGeometry);
const holeGeometry = new THREE.BoxGeometry(0.18, 0.085, 0.055);
const filmMaterial = new THREE.MeshStandardMaterial({
    color: 0x2a2929,
    roughness: 0.78,
    metalness: 0.12,
    side: THREE.DoubleSide
});
const holeMaterial = new THREE.MeshStandardMaterial({
    color: 0x0c0e11,
    roughness: 0.66,
    metalness: 0.05
});
const edgeMaterial = new THREE.LineBasicMaterial({
    color: 0xffd8ad,
    transparent: true,
    opacity: 0.3
});

const rows = [];
let imageSources = [];
let imageMeshes = [];
let playing = true;
let dragState = null;
let lastPointer = null;
let lastFrameTime = performance.now();
let refreshBusy = false;

function getTodayString() {
    const date = new Date();
    const pad = value => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatDate(dateString) {
    const [year, month, day] = dateString.split("-");
    return `${year}.${month}.${day}`;
}

function wrap(value, span) {
    return ((value + span / 2) % span + span) % span - span / 2;
}

function createPlaceholderTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 260;
    const context = canvas.getContext("2d");
    const gradient = context.createLinearGradient(0, 0, 400, 260);
    gradient.addColorStop(0, "#373b3f");
    gradient.addColorStop(0.5, "#17191d");
    gradient.addColorStop(1, "#9b6f4b");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 400, 260);
    context.fillStyle = "rgba(255,240,220,0.65)";
    context.font = "500 20px monospace";
    context.fillText("LOADING FRAME", 24, 232);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

const placeholderTexture = createPlaceholderTexture();

function getTexture(url) {
    if (textureCache.has(url)) return textureCache.get(url);

    const texture = textureLoader.load(
        url,
        loadedTexture => {
            loadedTexture.colorSpace = THREE.SRGBColorSpace;
            loadedTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
            loadedTexture.needsUpdate = true;
        },
        undefined,
        () => console.warn(`Unable to load lottery frame: ${url}`)
    );
    texture.colorSpace = THREE.SRGBColorSpace;
    textureCache.set(url, texture);
    return texture;
}

function createReflectionMaterial(texture) {
    return new THREE.ShaderMaterial({
        uniforms: { uMap: { value: texture } },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            precision highp float;
            uniform sampler2D uMap;
            varying vec2 vUv;
            void main() {
                vec4 color = texture2D(uMap, vUv);
                float fade = 1.0 - smoothstep(0.03, 0.98, vUv.y);
                gl_FragColor = vec4(color.rgb * 0.72, color.a * fade * 0.2);
            }
        `,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide
    });
}

function createCard(source, rowIndex, x, repeat, span) {
    const card = new THREE.Group();
    card.position.x = x;

    const frame = new THREE.Mesh(
        frameGeometry,
        new THREE.MeshStandardMaterial({
            color: rowIndex === 1 ? 0xf4eee3 : 0xe5ded0,
            roughness: 0.83,
            metalness: 0.02
        })
    );
    frame.position.z = 0.025;
    card.add(frame);

    const texture = getTexture(source.url);
    const image = new THREE.Mesh(
        imageGeometry,
        new THREE.MeshBasicMaterial({ map: texture, color: 0xffffff, fog: false })
    );
    image.position.z = 0.09;
    image.userData = { source, clickable: true };
    card.add(image);
    imageMeshes.push(image);

    const edge = new THREE.LineSegments(edgeGeometry, edgeMaterial);
    edge.position.z = 0.12;
    card.add(edge);

    const reflection = new THREE.Mesh(imageGeometry, createReflectionMaterial(texture));
    reflection.position.set(0, -CARD_HEIGHT - 0.1, 0.015);
    reflection.scale.y = -1;
    card.add(reflection);

    card.userData = { source, repeat, baseX: x - repeat * span };
    return card;
}

function createSprocketHoles(span) {
    const holes = new THREE.Group();
    const holeSpacing = 0.43;
    const holeCount = Math.ceil(span / holeSpacing) + 1;
    for (let index = 0; index < holeCount; index += 1) {
        const x = -span / 2 + index * holeSpacing;
        for (const y of [-1.01 + 0.12, 1.01 - 0.12]) {
            const hole = new THREE.Mesh(holeGeometry, holeMaterial);
            hole.position.set(x, y, 0.045);
            holes.add(hole);
        }
    }
    return holes;
}

function createRow(config, rowIndex, sources) {
    const root = new THREE.Group();
    root.position.set(0, ROW_Y[rowIndex], rowIndex === 1 ? -0.14 : 0);
    root.rotation.z = config.rotation;

    const count = Math.max(sources.length, 1);
    const span = count * CARD_STEP;
    const track = new THREE.Group();
    root.add(track);

    const row = {
        config,
        index: rowIndex,
        root,
        track,
        span,
        offset: config.phase,
        cards: [],
        targetX: new Map()
    };

    for (let repeat = -1; repeat <= 1; repeat += 1) {
        const segment = new THREE.Group();
        segment.position.x = repeat * span;

        const film = new THREE.Mesh(new THREE.PlaneGeometry(span + 0.05, 2.02), filmMaterial);
        film.position.z = -0.035;
        segment.add(film);

        segment.add(createSprocketHoles(span));
        track.add(segment);

        sources.forEach((source, sourceIndex) => {
            const orderedIndex = (sourceIndex + config.orderOffset + rowIndex) % sources.length;
            const orderedSource = sources[orderedIndex];
            const x = (sourceIndex - (count - 1) / 2) * CARD_STEP;
            const card = createCard(orderedSource, rowIndex, x + repeat * span, repeat, span);
            segment.add(card);
            row.cards.push(card);

            if (repeat === 0 && !row.targetX.has(orderedSource.url)) row.targetX.set(orderedSource.url, x);
        });
    }

    row.track.position.x = wrap(row.offset, row.span);
    wall.add(root);
    return row;
}

function clearRows() {
    imageMeshes = [];
    while (wall.children.length) wall.remove(wall.children[0]);
    rows.length = 0;
}

function buildRows(sources) {
    clearRows();
    ROWS.forEach((config, index) => rows.push(createRow(config, index, sources)));
}

async function fetchTodayImages() {
    try {
        const response = await fetch(`/api/photos/${getTodayString()}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`photo API ${response.status}`);
        const data = await response.json();
        return Array.isArray(data.images) ? data.images : [];
    } catch (error) {
        console.warn("Today's storage images are unavailable; using examples.", error);
        return [];
    }
}

async function refreshSources({ initial = false } = {}) {
    if (refreshBusy) return;
    refreshBusy = true;
    const todayImages = await fetchTodayImages();
    const sourceUrls = [...todayImages, ...EXAMPLE_IMAGES];
    const uniqueUrls = [...new Set(sourceUrls)];
    const nextSources = uniqueUrls.map((url, index) => ({
        url,
        label: url.startsWith("/example-images/") ? `Example ${String(index - todayImages.length + 1).padStart(2, "0")}` : `Today ${String(index + 1).padStart(2, "0")}`,
        isToday: !url.startsWith("/example-images/")
    }));

    const changed = nextSources.length !== imageSources.length || nextSources.some((source, index) => source.url !== imageSources[index]?.url);
    imageSources = nextSources;

    if (changed || initial) buildRows(imageSources);
    refreshBusy = false;
}

function stageWorldPerPixel() {
    const height = Math.max(stage.clientHeight, 1);
    const verticalSpan = 2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    return verticalSpan / height;
}

function resize() {
    const width = Math.max(stage.clientWidth, 1);
    const height = Math.max(stage.clientHeight, 1);
    const isMobile = width < 700;
    camera.fov = isMobile ? 41 : 32;
    camera.position.z = isMobile ? 15.4 : 15.3;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1.35 : 1.7));
    renderer.setSize(width, height, false);
}

function setPointerPosition(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    return {
        x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
        y: -((event.clientY - rect.top) / rect.height) * 2 + 1
    };
}

function startDrag(event) {
    if (!imageSources.length) return;
    stage.focus({ preventScroll: true });
    dragState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        offsets: rows.map(row => row.offset),
        wasPlaying: playing
    };
    stage.classList.add("is-dragging");
    renderer.domElement.setPointerCapture(event.pointerId);
    playing = false;
}

function moveDrag(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    const dx = event.clientX - dragState.startX;
    const worldDx = dx * stageWorldPerPixel();
    rows.forEach((row, index) => {
        row.offset = dragState.offsets[index] + worldDx * row.config.drag;
        row.track.position.x = wrap(row.offset, row.span);
    });
}

function endDrag(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
    const shouldResume = dragState.wasPlaying;
    dragState = null;
    stage.classList.remove("is-dragging");
    playing = shouldResume;
}

function handleWheel(event) {
    event.preventDefault();
    const delta = (Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY) * -stageWorldPerPixel() * 0.9;
    rows.forEach(row => {
        row.offset += delta * row.config.drag;
        row.track.position.x = wrap(row.offset, row.span);
    });
}

function tick(now) {
    const deltaSeconds = Math.min((now - lastFrameTime) / 1000, 0.05);
    lastFrameTime = now;

    if (playing && !dragState) {
        rows.forEach(row => {
            row.offset += row.config.speed * deltaSeconds;
            row.track.position.x = wrap(row.offset, row.span);
        });
    }

    renderer.render(scene, camera);
    requestAnimationFrame(tick);
}

renderer.domElement.addEventListener("pointerdown", startDrag);
renderer.domElement.addEventListener("pointermove", moveDrag);
renderer.domElement.addEventListener("pointerup", endDrag);
renderer.domElement.addEventListener("pointercancel", endDrag);
renderer.domElement.addEventListener("wheel", handleWheel, { passive: false });
window.addEventListener("resize", resize, { passive: true });

async function initialize() {
    resize();
    await refreshSources({ initial: true });
    requestAnimationFrame(tick);
    window.setInterval(() => refreshSources(), POLL_INTERVAL);
}

initialize();
