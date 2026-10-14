const MAX_WIDTH = 160;
const MAX_HEIGHT = 240;
const CACHE_LIMIT = 12;
const LOAD_LIMIT = 2;
const FRAME_INTERVAL = 1 / 30;

function releaseImage(image) {
  if (typeof image?.close === 'function') image.close();
  else if (image) { image.width = 1; image.height = 1; }
}

function thumbnailSize(width, height) {
  const scale = Math.min(1, MAX_WIDTH / width, MAX_HEIGHT / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function abortError() {
  return new DOMException('Photo loading was cancelled', 'AbortError');
}

function canvasThumbnail(blob, signal) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(blob);
    let finished = false;
    const finish = (error, result) => {
      if (finished) return;
      finished = true;
      signal.removeEventListener('abort', abort);
      image.onload = null;
      image.onerror = null;
      image.src = '';
      URL.revokeObjectURL(objectUrl);
      if (error) reject(error);
      else resolve(result);
    };
    const abort = () => finish(abortError());
    image.onload = () => {
      if (signal.aborted) return abort();
      try {
        const size = thumbnailSize(image.naturalWidth, image.naturalHeight);
        const canvas = document.createElement('canvas');
        canvas.width = size.width;
        canvas.height = size.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Photo thumbnail canvas is unavailable');
        context.drawImage(image, 0, 0, size.width, size.height);
        finish(null, { image: canvas, ...size });
      } catch (error) { finish(error); }
    };
    image.onerror = () => finish(new Error('Photo could not be decoded'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    else image.src = objectUrl;
  });
}

async function decodeThumbnail(blob, signal) {
  if (signal.aborted) throw abortError();
  if (typeof createImageBitmap === 'function') {
    let original;
    let thumbnail;
    try {
      original = await createImageBitmap(blob);
      if (signal.aborted) throw abortError();
      const size = thumbnailSize(original.width, original.height);
      if (size.width === original.width && size.height === original.height) {
        thumbnail = original;
        original = null;
      } else {
        thumbnail = await createImageBitmap(original, {
          resizeWidth: size.width, resizeHeight: size.height, resizeQuality: 'high',
        });
      }
      if (signal.aborted) throw abortError();
      if (thumbnail.width > MAX_WIDTH || thumbnail.height > MAX_HEIGHT) {
        throw new Error('Bitmap resizing is unavailable');
      }
      return { image: thumbnail, ...size };
    } catch (error) {
      releaseImage(thumbnail);
      if (signal.aborted || error.name === 'AbortError') throw abortError();
      // Older browsers may expose createImageBitmap without resize support.
    } finally { releaseImage(original); }
  }
  return canvasThumbnail(blob, signal);
}

function safePhotoUrls(values) {
  const result = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    if (typeof value !== 'string' || !value.trim()) continue;
    try {
      const url = new URL(value, window.location.href);
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== window.location.origin || url.username || url.password) continue;
      url.hash = '';
      result.add(url.href);
    } catch { /* Ignore malformed entries without interrupting the stage. */ }
  }
  return [...result];
}

/** A bounded, silent photo overlay. Animation is driven by the caller's loop. */
export function createOperaPhotoDrift(container, options = {}) {
  const mediaQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const noop = { setPhotos() {}, update() {}, setPaused() {}, dispose() {} };
  if (options.reducedMotion || mediaQuery?.matches) return noop;

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) return noop;
  canvas.setAttribute('aria-hidden', 'true');
  canvas.className = 'opera-photo-drift';
  Object.assign(canvas.style, {
    position: 'absolute', inset: '0', width: '100%', height: '100%',
    pointerEvents: 'none', zIndex: '1',
  });
  canvas.hidden = true;
  container.appendChild(canvas);

  let width = 1;
  let height = 1;
  let dpr = 1;
  let mobile = false;
  let disposed = false;
  let paused = false;
  let motionDisabled = false;
  let photoDate = null;
  let urls = [];
  let urlSet = new Set();
  let generation = 0;
  let activeLoads = 0;
  let previousTime = null;
  let frameTime = 0;
  const particles = [];
  const cache = new Map();
  const pending = new Map();
  const failures = new Map();
  const isPaused = () => paused || motionDisabled || document.hidden;
  const random = (min, max) => min + Math.random() * (max - min);

  function abortLoads() {
    generation += 1;
    for (const controller of pending.values()) controller.abort();
    pending.clear();
  }

  function releaseParticle(particle) {
    if (particle.source) particle.source.refs -= 1;
    particle.source = null;
  }

  function clearSources() {
    abortLoads();
    for (const particle of particles) {
      releaseParticle(particle);
      particle.url = null;
    }
    for (const entry of cache.values()) releaseImage(entry.image);
    cache.clear();
    failures.clear();
    context.clearRect(0, 0, width, height);
  }

  function pickUrl(previous = null) {
    if (!urls.length) return null;
    const now = performance.now();
    const eligible = url => (failures.get(url)?.retryAt || 0) <= now;
    const start = Math.floor(Math.random() * urls.length);
    for (let offset = 0; offset < urls.length; offset += 1) {
      const candidate = urls[(start + offset) % urls.length];
      if (candidate !== previous && eligible(candidate)) return candidate;
    }
    return previous && urlSet.has(previous) && eligible(previous) ? previous : null;
  }

  function sizeParticle(particle) {
    particle.width = mobile ? random(45, 65) : random(65, 95);
    particle.height = particle.width * 1.5;
  }

  function rebirth(particle, initial = false) {
    const previous = particle.url;
    releaseParticle(particle);
    sizeParticle(particle);
    // Most photos drift at the sides, leaving the large central prop readable.
    const side = Math.random();
    const ratio = side < 0.4 ? random(0.06, 0.29) : side < 0.8 ? random(0.71, 0.94) : random(0.22, 0.78);
    particle.x = width * ratio;
    particle.y = initial ? random(-particle.height, height) : -particle.height - 35;
    particle.speed = mobile ? random(8, 14) : random(10, 18);
    particle.sway = mobile ? random(9, 20) : random(15, 34);
    particle.phase = random(0, Math.PI * 2);
    particle.angle = random(-0.15, 0.15);
    particle.opacity = random(0.4, 0.6);
    particle.age = random(0, 8);
    particle.url = pickUrl(previous);
    particle.nextSelection = 0;
  }

  function resize() {
    if (disposed) return;
    const oldWidth = width;
    const oldHeight = height;
    width = Math.max(1, container.clientWidth);
    height = Math.max(1, container.clientHeight);
    mobile = width < 720;
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    const target = mobile ? 4 : 8;
    while (particles.length > target) releaseParticle(particles.pop());
    for (const particle of particles) {
      particle.x = particle.x / oldWidth * width;
      particle.y = particle.y / oldHeight * height;
      sizeParticle(particle);
    }
    while (particles.length < target) {
      const particle = { source: null, url: null };
      rebirth(particle, true);
      particles.push(particle);
    }
  }

  function assignCachedPhotos() {
    for (const particle of particles) {
      if (particle.source || !particle.url) continue;
      const entry = cache.get(particle.url);
      if (!entry) continue;
      particle.source = entry;
      entry.refs += 1;
      cache.delete(particle.url);
      cache.set(particle.url, entry);
    }
  }

  function trimCache() {
    for (const [url, entry] of cache) {
      if (cache.size <= CACHE_LIMIT) break;
      if (entry.refs) continue;
      cache.delete(url);
      releaseImage(entry.image);
    }
  }

  async function loadPhoto(url, controller, version) {
    let decoded;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 12000);
    try {
      const response = await fetch(url, { signal: controller.signal, credentials: 'same-origin' });
      if (!response.ok) throw new Error('Photo download failed');
      decoded = await decodeThumbnail(await response.blob(), controller.signal);
      if (disposed || version !== generation || controller.signal.aborted || !urlSet.has(url)) {
        releaseImage(decoded.image);
        return;
      }
      cache.set(url, { ...decoded, refs: 0 });
      failures.delete(url);
      assignCachedPhotos();
      trimCache();
    } catch (error) {
      if (!disposed && version === generation && (error.name !== 'AbortError' || timedOut)) {
        const attempts = (failures.get(url)?.attempts || 0) + 1;
        failures.set(url, { attempts, retryAt: performance.now() + Math.min(900000, 60000 * 2 ** Math.min(attempts - 1, 4)) });
        for (const particle of particles) {
          if (particle.url === url && !particle.source) {
            particle.url = null;
            particle.nextSelection = performance.now() + 3000;
          }
        }
      }
    } finally {
      clearTimeout(timeout);
      activeLoads -= 1;
      if (pending.get(url) === controller) pending.delete(url);
      pumpLoads();
    }
  }

  function pumpLoads() {
    if (disposed || isPaused() || !urls.length) return;
    for (const particle of particles) {
      if (activeLoads >= LOAD_LIMIT) break;
      const url = particle.url;
      if (!url || cache.has(url) || pending.has(url) || (failures.get(url)?.retryAt || 0) > performance.now()) continue;
      const controller = new AbortController();
      pending.set(url, controller);
      activeLoads += 1;
      void loadPhoto(url, controller, generation);
    }
  }

  function drawFrame(dt) {
    context.clearRect(0, 0, width, height);
    let visible = false;
    const now = performance.now();
    for (const particle of particles) {
      particle.y += dt * particle.speed;
      particle.age += dt;
      if (particle.y > height + particle.height + 35) rebirth(particle);
      if (!particle.url && now >= particle.nextSelection) {
        particle.url = pickUrl();
        particle.nextSelection = now + 1000;
      }
      if (!particle.source) continue;
      const x = particle.x + Math.sin(particle.age * 0.33 + particle.phase) * particle.sway;
      const rotation = particle.angle + Math.sin(particle.age * 0.4 + particle.phase) * 0.24;
      const w = particle.width;
      const h = particle.height;
      const inset = 2.5;
      const fit = Math.min((w - inset * 2) / particle.source.width, (h - inset * 2) / particle.source.height);
      const photoWidth = particle.source.width * fit;
      const photoHeight = particle.source.height * fit;
      context.save();
      context.translate(x, particle.y);
      context.rotate(rotation);
      context.globalAlpha = particle.opacity;
      context.fillStyle = '#19130d';
      context.fillRect(-w / 2, -h / 2, w, h);
      context.drawImage(particle.source.image, -photoWidth / 2, -photoHeight / 2, photoWidth, photoHeight);
      context.strokeStyle = '#c8a563';
      context.lineWidth = 0.8;
      context.strokeRect(-w / 2, -h / 2, w, h);
      context.restore();
      visible = true;
    }
    canvas.hidden = !visible;
    assignCachedPhotos();
    pumpLoads();
  }

  function pauseChanged() {
    previousTime = null;
    frameTime = 0;
    if (isPaused()) abortLoads();
    else pumpLoads();
  }

  function motionChanged(event) {
    motionDisabled = event.matches;
    if (motionDisabled) {
      context.clearRect(0, 0, width, height);
      canvas.hidden = true;
    }
    pauseChanged();
  }

  resize();
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  if (observer) observer.observe(container);
  else window.addEventListener('resize', resize, { passive: true });
  document.addEventListener('visibilitychange', pauseChanged);
  mediaQuery?.addEventListener?.('change', motionChanged);

  return {
    setPhotos(values, date) {
      if (disposed) return;
      const nextUrls = safePhotoUrls(values);
      const nextSet = new Set(nextUrls);
      const nextDate = String(date ?? '');
      const dateChanged = photoDate !== nextDate;
      const listChanged = nextUrls.length !== urls.length || nextUrls.some(url => !urlSet.has(url));
      if (!dateChanged && !listChanged) return;
      if (dateChanged) clearSources();
      else abortLoads();
      photoDate = nextDate;
      urls = nextUrls;
      urlSet = nextSet;
      for (const particle of particles) {
        if (!urlSet.has(particle.url)) {
          releaseParticle(particle);
          particle.url = pickUrl();
          particle.nextSelection = 0;
        }
      }
      for (const [url, entry] of cache) {
        if (!urlSet.has(url)) { cache.delete(url); releaseImage(entry.image); }
      }
      for (const url of failures.keys()) if (!urlSet.has(url)) failures.delete(url);
      if (!urls.length) {
        context.clearRect(0, 0, width, height);
        canvas.hidden = true;
      }
      assignCachedPhotos();
      pumpLoads();
    },
    update(timeSeconds, deltaSeconds) {
      if (disposed) return;
      let dt = Number.isFinite(deltaSeconds) ? deltaSeconds : previousTime === null ? 0 : timeSeconds - previousTime;
      previousTime = Number.isFinite(timeSeconds) ? timeSeconds : null;
      if (isPaused() || !urls.length) return;
      dt = Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, 0.1));
      frameTime += dt;
      if (frameTime + 0.000001 < FRAME_INTERVAL) return;
      const step = frameTime;
      frameTime = 0;
      drawFrame(step);
    },
    setPaused(value) {
      if (disposed || paused === Boolean(value)) return;
      paused = Boolean(value);
      pauseChanged();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearSources();
      observer?.disconnect();
      if (!observer) window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', pauseChanged);
      mediaQuery?.removeEventListener?.('change', motionChanged);
      particles.length = 0;
      urls = [];
      urlSet.clear();
      canvas.remove();
      canvas.width = 1;
      canvas.height = 1;
    },
  };
}
