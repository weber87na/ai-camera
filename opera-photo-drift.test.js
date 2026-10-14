import test from 'node:test';
import assert from 'node:assert/strict';
import { createOperaPhotoDrift } from './public/opera-photo-drift.js';

const today = '2026-10-14';
const photoUrls = (date = today) => Array.from({ length: 40 }, (_, i) => `/storage/${date}/photo-${i}.jpg`);
const flush = async () => { for (let i = 0; i < 16; i += 1) await Promise.resolve(); };

function fakeBrowser(t, { holdAborts = false, holdDecodes = false } = {}) {
    const originals = new Map();
    const install = (key, value) => {
        originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
        Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    };
    const requests = [];
    const bitmaps = [];
    const decodes = [];
    const canvases = [];
    const observers = [];
    const effects = [];
    let activeFetches = 0;
    let maxActiveFetches = 0;
    let seed = 271828;
    t.mock.method(Math, 'random', () => {
        seed = (1664525 * seed + 1013904223) >>> 0;
        return seed / 0x100000000;
    });
    const media = Object.assign(new EventTarget(), { matches: false });
    const window = Object.assign(new EventTarget(), {
        location: new URL('https://camera.example.com/opera'),
        devicePixelRatio: 3,
        matchMedia: () => media,
    });
    const container = {
        clientWidth: 1200, clientHeight: 500, children: [],
        appendChild(canvas) { this.children.push(canvas); canvas.parent = this; },
    };
    const document = Object.assign(new EventTarget(), {
        hidden: false,
        createElement(tag) {
            assert.equal(tag, 'canvas');
            const context = {
                frameImages: [], maxFrameDraws: 0,
                clearRect() { this.frameImages = []; },
                drawImage(image) {
                    assert.equal(image.closed, false, 'a released bitmap must never be drawn');
                    this.frameImages.push(image);
                    this.maxFrameDraws = Math.max(this.maxFrameDraws, this.frameImages.length);
                },
                setTransform() {}, save() {}, translate() {}, rotate() {},
                fillRect() {}, strokeRect() {}, restore() {},
            };
            const canvas = {
                style: {}, width: 0, height: 0, hidden: false, attributes: {}, context,
                setAttribute(name, value) { this.attributes[name] = value; },
                getContext(type) { assert.equal(type, '2d'); return context; },
                remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); },
            };
            canvases.push(canvas);
            return canvas;
        },
    });
    install('window', window);
    install('document', document);
    install('ResizeObserver', class {
        constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
        observe() {}
        disconnect() { this.disconnected = true; }
    });
    install('fetch', (url, options = {}) => new Promise((resolve, reject) => {
        activeFetches += 1;
        maxActiveFetches = Math.max(maxActiveFetches, activeFetches);
        const request = { url, signal: options.signal, settled: false, aborted: false };
        const finish = action => {
            if (request.settled) return;
            request.settled = true;
            activeFetches -= 1;
            action();
        };
        request.complete = () => finish(() => resolve({ ok: true, blob: async () => ({ url }) }));
        request.reject = () => finish(() => reject(new DOMException('Aborted', 'AbortError')));
        options.signal.addEventListener('abort', () => {
            request.aborted = true;
            if (!holdAborts) request.reject();
        }, { once: true });
        requests.push(request);
    }));
    const bitmap = (width, height, kind, url) => {
        const value = { width, height, kind, url, closed: false, close() { this.closed = true; } };
        bitmaps.push(value);
        return value;
    };
    install('createImageBitmap', async (source, options) => {
        if (!options) return bitmap(1024, 1536, 'original', source.url);
        const create = () => bitmap(options.resizeWidth, options.resizeHeight, 'thumbnail', source.url);
        if (holdDecodes) return new Promise(resolve => decodes.push(() => resolve(create())));
        return create();
    });
    t.after(async () => {
        effects.forEach(effect => effect.dispose());
        requests.filter(request => !request.settled).forEach(request => request.reject());
        decodes.splice(0).forEach(resolve => resolve());
        await flush();
        for (const [key, descriptor] of originals) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else delete globalThis[key];
        }
    });
    return {
        requests, bitmaps, decodes, canvases, observers, container, document, media,
        get maxActiveFetches() { return maxActiveFetches; },
        create(options) { const effect = createOperaPhotoDrift(container, options); effects.push(effect); return effect; },
        resize(width, height) {
            container.clientWidth = width;
            container.clientHeight = height;
            observers.forEach(observer => { if (!observer.disconnected) observer.callback(); });
        },
        async drain() {
            for (let round = 0; round < 50; round += 1) {
                await flush();
                const pending = requests.filter(request => !request.settled);
                if (!pending.length) return;
                pending.forEach(request => request.aborted ? request.reject() : request.complete());
            }
            assert.fail('photo loading did not settle within the bounded display pool');
        },
    };
}

test('photo drift loads only visible slots with at most two requests and bounded thumbnails', async t => {
    const browser = fakeBrowser(t);
    const effect = browser.create();
    effect.setPhotos(photoUrls(), today);
    assert.ok(browser.requests.length > 0 && browser.requests.length <= 2);
    await browser.drain();
    assert.ok(browser.requests.length <= 8, 'initial display must not download all forty photos');
    assert.ok(browser.maxActiveFetches <= 2);
    const canvas = browser.canvases[0];
    effect.update(0.1, 0.1);
    assert.equal(canvas.context.frameImages.length, 8);
    assert.equal(canvas.width, 1800, 'render resolution caps the device pixel ratio');
    assert.equal(canvas.height, 750);
    assert.equal(canvas.style.pointerEvents, 'none');
    for (const image of browser.bitmaps.filter(image => image.kind === 'thumbnail')) {
        assert.ok(image.width <= 160 && image.height <= 240);
    }
    assert.ok(browser.bitmaps.filter(image => image.kind === 'original').every(image => image.closed));

    browser.resize(500, 400);
    effect.update(0.2, 0.1);
    assert.equal(canvas.context.frameImages.length, 4, 'small screens use only four particles');
});

test('long-running drift evicts old bitmaps and keeps fixed particle and cache budgets', async t => {
    const browser = fakeBrowser(t);
    const effect = browser.create();
    effect.setPhotos(photoUrls(), today);
    await browser.drain();
    let elapsed = 0;
    for (let batch = 0; batch < 40; batch += 1) {
        for (let frame = 0; frame < 300; frame += 1) {
            elapsed += 0.1;
            effect.update(elapsed, 0.1);
        }
        await browser.drain();
        const retained = browser.bitmaps.filter(image => image.kind === 'thumbnail' && !image.closed);
        assert.ok(retained.length <= 12, `retained ${retained.length} thumbnails`);
    }
    assert.ok(new Set(browser.requests.map(request => request.url)).size > 12, 'exercise eviction beyond the cache budget');
    assert.ok(browser.bitmaps.some(image => image.kind === 'thumbnail' && image.closed));
    assert.ok(browser.canvases[0].context.maxFrameDraws <= 8);
    assert.ok(browser.maxActiveFetches <= 2);
    effect.dispose();
    await flush();
    assert.ok(browser.bitmaps.every(image => image.closed));
    assert.equal(browser.container.children.length, 0);
    assert.ok(browser.observers.every(observer => observer.disconnected));
});

test('reduced motion does not create a canvas or load any photos', async t => {
    const browser = fakeBrowser(t);
    const explicit = browser.create({ reducedMotion: true });
    explicit.setPhotos(photoUrls(), today);
    explicit.update(1, 0.1);
    explicit.setPaused(false);
    browser.media.matches = true;
    const preferred = browser.create();
    preferred.setPhotos(photoUrls(), today);
    preferred.update(1, 0.1);
    await flush();
    assert.equal(browser.requests.length, 0);
    assert.equal(browser.canvases.length, 0);
});

test('paused and hidden drift does not start downloads and aborts in-flight requests', async t => {
    const browser = fakeBrowser(t);
    const effect = browser.create();
    effect.setPaused(true);
    effect.setPhotos(photoUrls(), today);
    effect.update(1, 0.1);
    assert.equal(browser.requests.length, 0);
    effect.setPaused(false);
    assert.equal(browser.requests.length, 2);
    effect.setPaused(true);
    await flush();
    assert.ok(browser.requests.every(request => request.signal.aborted));
    effect.setPhotos(photoUrls('2026-10-15'), '2026-10-15');
    effect.update(2, 0.1);
    assert.equal(browser.requests.length, 2);
    browser.document.hidden = true;
    effect.setPaused(false);
    effect.update(3, 0.1);
    assert.equal(browser.requests.length, 2);
    browser.document.hidden = false;
    browser.document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(browser.requests.length, 4);
    await browser.drain();
    assert.ok(browser.maxActiveFetches <= 2);
});

test('date changes release old bitmaps and never overlap more than two unfinished requests', async t => {
    const browser = fakeBrowser(t, { holdAborts: true });
    const effect = browser.create();
    effect.setPhotos(['/storage/2026-10-14/old.jpg'], today);
    await browser.drain();
    const oldBitmaps = [...browser.bitmaps];
    effect.setPhotos(photoUrls('2026-10-15'), '2026-10-15');
    assert.ok(oldBitmaps.every(image => image.closed));
    const pending = browser.requests.filter(request => !request.settled);
    assert.equal(pending.length, 2);
    const started = browser.requests.length;
    effect.setPhotos(photoUrls('2026-10-16'), '2026-10-16');
    assert.ok(pending.every(request => request.signal.aborted));
    assert.equal(browser.requests.length, started, 'abort must settle before replacement loads can start');
    await browser.drain();
    assert.ok(browser.maxActiveFetches <= 2);
    const retained = browser.bitmaps.filter(image => !image.closed);
    assert.ok(retained.length > 0);
    assert.ok(retained.every(image => image.url.includes('/2026-10-16/')));
});

test('disposing during bitmap decoding aborts pending work and closes late results', async t => {
    const browser = fakeBrowser(t, { holdDecodes: true });
    const effect = browser.create();
    effect.setPhotos(['/storage/2026-10-14/one.jpg'], today);
    browser.requests[0].complete();
    await flush();
    assert.equal(browser.decodes.length, 1, 'leave the thumbnail decode unfinished');
    effect.dispose();
    assert.ok(browser.requests[0].signal.aborted);
    assert.equal(browser.container.children.length, 0);
    browser.decodes.splice(0).forEach(resolve => resolve());
    await flush();
    assert.ok(browser.bitmaps.every(image => image.closed));
    const count = browser.requests.length;
    effect.setPhotos(photoUrls('2026-10-15'), '2026-10-15');
    effect.setPaused(false);
    effect.update(1, 0.1);
    effect.dispose();
    assert.equal(browser.requests.length, count, 'disposed effect must remain inactive');
});
