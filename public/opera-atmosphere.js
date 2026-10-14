import * as THREE from 'three';

// Original PNGs and animation values from weber87na/riddle:
// https://github.com/weber87na/riddle/blob/main/main.js#createFallingLeaves
// https://github.com/weber87na/riddle/blob/main/styles.css
// Keep the leaves in screen space, as in the reference, so camera zoom,
// perspective, stage lighting, and tone mapping do not change their appearance.
function createFallingLeaves(container, random, reducedMotion) {
  if (!container || reducedMotion) return { update() {}, dispose() {} };

  const layer = document.createElement('div');
  layer.className = 'opera-original-falling-leaves';
  layer.setAttribute('aria-hidden', 'true');
  Object.assign(layer.style, {
    position: 'absolute', inset: '0', zIndex: '1',
    overflow: 'hidden', pointerEvents: 'none',
  });

  const leaves = [];
  for (let index = 0; index < 24; index += 1) {
    const element = document.createElement('img');
    const variant = String((index % 16) + 1).padStart(2, '0');
    const duration = 11 + random() * 13;
    const sway = -85 + random() * 170;
    const drift = -120 + random() * 240;
    element.src = '/images/opera-yellow-leaves/yellow-leaf-' + variant + '.png';
    element.alt = '';
    element.decoding = 'async';
    element.draggable = false;
    const left = random();
    const size = 10 + random() * 17;
    const opacity = 0.2 + random() * 0.43;
    const phase = random() * duration;
    const start = random() * 210;
    const turn = 520 + random() * 620;
    Object.assign(element.style, {
      position: 'absolute', top: '0', left: '0',
      width: size + 'px', height: 'auto', opacity: String(opacity),
      filter: 'drop-shadow(0 3px 5px rgba(154, 93, 17, 0.3))',
      willChange: 'transform', pointerEvents: 'none',
    });
    layer.appendChild(element);
    leaves.push({ element, left, duration, phase, sway, drift, start, turn });
  }
  container.appendChild(layer);

  let width = 1;
  let height = 1;
  const resize = () => {
    width = Math.max(1, container.clientWidth);
    height = Math.max(1, container.clientHeight);
    for (let index = 0; index < leaves.length; index += 1) {
      // The original @media (max-width: 700px) keeps only the first 12.
      leaves[index].element.hidden = width <= 700 && index >= 12;
    }
  };
  resize();
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  observer?.observe(container);

  const update = elapsed => {
    if (!observer) resize();
    for (const leaf of leaves) {
      if (leaf.element.hidden) continue;
      const progress = ((elapsed + leaf.phase) % leaf.duration) / leaf.duration;
      // CSS keyframes at 0%, 32%, 67%, 100%, including the original -18vh top.
      let portion;
      let x;
      let y;
      let rotation;
      if (progress < 0.32) {
        portion = progress / 0.32;
        x = leaf.sway * portion;
        y = -0.32 + 0.48 * portion;
        rotation = leaf.start + (145 - leaf.start) * portion;
      } else if (progress < 0.67) {
        portion = (progress - 0.32) / 0.35;
        x = leaf.sway + (leaf.sway * -0.62 - leaf.sway) * portion;
        y = 0.16 + 0.42 * portion;
        rotation = 145 + (310 - 145) * portion;
      } else {
        portion = (progress - 0.67) / 0.33;
        x = leaf.sway * -0.62 + (leaf.drift - leaf.sway * -0.62) * portion;
        y = 0.58 + 0.44 * portion;
        rotation = 310 + (leaf.turn - 310) * portion;
      }
      leaf.element.style.transform =
        'translate3d(' + (leaf.left * width + x) + 'px,' + (y * height) + 'px,0) rotate(' + rotation + 'deg)';
    }
  };
  update(0);
  return {
    update,
    dispose() {
      observer?.disconnect();
      layer.remove();
    },
  };
}

function glowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const glow = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  glow.addColorStop(0, 'rgba(255, 255, 255, 0.48)');
  glow.addColorStop(0.18, 'rgba(255, 255, 255, 0.30)');
  glow.addColorStop(0.45, 'rgba(255, 255, 255, 0.12)');
  glow.addColorStop(0.75, 'rgba(255, 255, 255, 0.025)');
  glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
  context.fillStyle = glow;
  context.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

/** Original riddle falling leaves and distant stage haze. Call dispose on teardown. */
export function createOperaAtmosphere(scene, options = {}) {
  const reducedMotion = Boolean(options.reducedMotion ?? options.reduceMotion);
  const root = new THREE.Group();
  root.name = 'opera-atmosphere';
  scene.add(root);

  // A stable seed avoids noticeably reshuffling the scene after each layout.
  let seed = 94087;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const leaves = createFallingLeaves(
    options.container || document.getElementById('operaStage'), random, reducedMotion,
  );

  const texture = glowTexture();
  const hazeMaterials = [];
  const haze = [];
  if (texture) {
    const settings = [
      { x: -2.5, y: -4.3, z: -8, width: 26, height: 5.6, opacity: 0.27, color: '#b58b44' },
      { x: 4.2, y: -3.6, z: -9, width: 19, height: 8.2, opacity: 0.16, color: '#ad7b35' },
      { x: -5.6, y: 1.3, z: -10, width: 15, height: 13, opacity: 0.10, color: '#c6a360' },
    ];
    for (const setting of settings) {
      const material = new THREE.SpriteMaterial({
        map: texture,
        color: setting.color,
        opacity: setting.opacity,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
      });
      const sprite = new THREE.Sprite(material);
      sprite.position.set(setting.x, setting.y, setting.z);
      sprite.scale.set(setting.width, setting.height, 1);
      root.add(sprite);
      hazeMaterials.push(material);
      haze.push({ material, opacity: setting.opacity });
    }
  }

  let elapsed = 0;
  let previousTime = null;
  let disposed = false;
  return {
    update(timeSeconds, deltaSeconds) {
      if (disposed || reducedMotion) return;
      let delta = Number.isFinite(deltaSeconds) ? deltaSeconds : 0;
      if (!Number.isFinite(deltaSeconds) && Number.isFinite(timeSeconds) && previousTime !== null) {
        delta = timeSeconds - previousTime;
      }
      if (Number.isFinite(timeSeconds)) previousTime = timeSeconds;
      // Returning to a background tab should resume the drift without jumping.
      elapsed += Math.max(0, Math.min(delta, 0.1));
      leaves.update(elapsed);
      for (let index = 0; index < haze.length; index += 1) {
        haze[index].material.opacity = haze[index].opacity * (0.95 + Math.sin(elapsed * 0.13 + index) * 0.05);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.remove(root);
      root.clear();
      leaves.dispose();
      hazeMaterials.forEach(material => material.dispose());
      texture?.dispose();
    },
  };
}
