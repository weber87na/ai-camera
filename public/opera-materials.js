import * as THREE from 'three';

const TAU = Math.PI * 2;
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const periodicDistance = (a, b) => ((a - b + 1.5) % 1) - 0.5;

function noise(x, y, seed = 0) {
  let value = Math.imul(x + seed * 31, 374761393) + Math.imul(y + seed * 17, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function texture(data, width, height, name, color = false) {
  const map = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  map.name = name;
  map.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(1, 1);
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.anisotropy = 8;
  map.needsUpdate = true;
  return map;
}

function textureSet(width, height, name, sample) {
  const color = new Uint8Array(width * height * 4);
  const bump = new Uint8Array(width * height * 4);
  const roughness = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = sample(x / width, y / height, x, y);
      const offset = (y * width + x) * 4;
      color[offset] = Math.round(clamp(pixel[0], 0, 255));
      color[offset + 1] = Math.round(clamp(pixel[1], 0, 255));
      color[offset + 2] = Math.round(clamp(pixel[2], 0, 255));
      color[offset + 3] = 255;
      const heightValue = Math.round(clamp(pixel[3]) * 255);
      const roughnessValue = Math.round(clamp(pixel[4]) * 255);
      for (let channel = 0; channel < 3; channel += 1) {
        bump[offset + channel] = heightValue;
        roughness[offset + channel] = roughnessValue;
      }
      bump[offset + 3] = 255;
      roughness[offset + 3] = 255;
    }
  }
  return {
    map: texture(color, width, height, `${name}-color`, true),
    bumpMap: texture(bump, width, height, `${name}-height`),
    roughnessMap: texture(roughness, width, height, `${name}-roughness`),
  };
}

function woodTextures() {
  return textureSet(512, 1024, 'opera-walnut', (u, v, x, y) => {
    // All waves run along v. The narrow channels are wood fibres rather than
    // isotropic noise; two small elliptical knots bend the surrounding grain.
    let warp = Math.sin(TAU * v) * 0.23 + Math.sin(TAU * v * 3) * 0.045;
    let knotRings = 0;
    let knotCore = 0;
    for (const [ku, kv, strength] of [[0.27, 0.31, 1], [0.76, 0.79, 0.7]]) {
      const du = periodicDistance(u, ku);
      const dv = periodicDistance(v, kv);
      const radius = Math.sqrt((du / 0.046) ** 2 + (dv / 0.1) ** 2);
      const influence = Math.exp(-radius * radius * 0.48) * strength;
      warp += Math.sin(du * TAU) * Math.exp(-((dv / 0.105) ** 2)) * strength * 3.7;
      knotRings += Math.sin(radius * 13) * influence * 0.042;
      knotCore += Math.exp(-((du / 0.011) ** 2) - ((dv / 0.027) ** 2)) * strength;
    }
    const phase = u * 31 + warp;
    const finePhase = u * 87 + warp * 2.2 + Math.sin(TAU * v * 2) * 0.08;
    const fibre = Math.pow(0.5 + Math.sin(TAU * phase) * 0.5, 15);
    const fineFibre = Math.pow(0.5 + Math.sin(TAU * finePhase) * 0.5, 19);
    const broadGrain = Math.sin(TAU * (u * 5 + warp * 0.16)) * 0.065;
    const grainVariation = Math.sin(TAU * (u * 13 + warp * 0.5)) * 0.034;
    const pores = (noise(x, y, 31) - 0.5) * 0.021;
    const shade = 1 + broadGrain + grainVariation + knotRings + pores
      - fibre * 0.17 - fineFibre * 0.065 - knotCore * 0.36;
    return [
      185 * shade,
      140 * shade + broadGrain * 10,
      91 * shade,
      0.53 - fibre * 0.12 - fineFibre * 0.045 - knotCore * 0.08 + pores,
      0.62 + fibre * 0.12 + fineFibre * 0.035 + knotCore * 0.08 - broadGrain * 0.3,
    ];
  });
}

function bambooTextures() {
  return textureSet(512, 1024, 'opera-bamboo', (u, v, x, y) => {
    const warp = Math.sin(TAU * v) * 0.045 + Math.sin(TAU * v * 3) * 0.018;
    const fibre = Math.pow(0.5 + Math.sin(TAU * (u * 47 + warp)) * 0.5, 19);
    const fineFibre = Math.sin(TAU * (u * 113 + warp * 1.6)) * 0.5 + 0.5;
    const broad = Math.sin(TAU * u * 7) * 0.043 + Math.sin(TAU * u * 3) * 0.028;
    const nodeDistance = periodicDistance(v, 0.59 + Math.sin(TAU * u * 2) * 0.0015);
    const node = Math.exp(-((nodeDistance / 0.006) ** 2));
    const nodeLip = Math.exp(-(((nodeDistance - 0.009) / 0.004) ** 2));
    const pores = (noise(x, y, 57) - 0.5) * 0.012;
    const shade = 1 + broad - fibre * 0.10 - fineFibre * 0.026 - node * 0.14 + nodeLip * 0.045 + pores;
    return [
      213 * shade,
      179 * shade,
      118 * shade - node * 8,
      0.51 - fibre * 0.075 - fineFibre * 0.02 + node * 0.065 + nodeLip * 0.035,
      0.55 + fibre * 0.095 + node * 0.11 + pores,
    ];
  });
}

function metalTextures() {
  return textureSet(512, 512, 'opera-brushed-metal', (u, v, x, y) => {
    // TubeGeometry's u follows the chain ring; each tiny abrasion extends in
    // that direction, with variation across v (the tube circumference).
    const brushed = noise(0, y, 94) - 0.5;
    const finer = Math.sin(TAU * v * 177) * 0.5;
    const patina = Math.sin(TAU * (u * 2 + v)) * Math.sin(TAU * v * 3) * 0.014;
    const scratchSeed = noise(0, y, 107);
    const scratchCenter = noise(0, y, 131);
    const scratchDistance = periodicDistance(u, scratchCenter);
    const scratch = scratchSeed > 0.967
      ? Math.exp(-((scratchDistance / 0.18) ** 2)) * 0.045 : 0;
    const microPore = noise(x, y, 83) > 0.997 ? 0.018 : 0;
    const shade = 1 + brushed * 0.048 + finer * 0.012 + patina + scratch - microPore;
    return [
      207 * shade,
      205 * shade,
      197 * shade,
      0.5 + brushed * 0.065 + finer * 0.012 - scratch * 0.7 - microPore,
      0.37 + brushed * 0.12 + finer * 0.022 + scratch * 1.3 + microPore,
    ];
  });
}

function applyNaturalWood(materials) {
  if (typeof document === 'undefined') return;
  const live = new Set(materials);
  for (const material of materials) {
    material.addEventListener('dispose', () => live.delete(material));
  }
  new THREE.TextureLoader().load('/images/opera-wood-grain-v1.png', color => {
    if (!live.size) { color.dispose(); return; }
    color.name = 'opera-natural-wood-color';
    color.colorSpace = THREE.SRGBColorSpace;
    color.wrapS = color.wrapT = THREE.RepeatWrapping;
    color.anisotropy = 8;
    // The same natural fibres drive surface relief and roughness, so
    // the highlights follow the visible grain. Data channels stay linear.
    const detail = color.clone();
    detail.name = 'opera-natural-wood-detail';
    detail.colorSpace = THREE.NoColorSpace;
    detail.needsUpdate = true;
    const replaced = new Set();
    for (const material of live) {
      replaced.add(material.map);
      replaced.add(material.bumpMap);
      replaced.add(material.roughnessMap);
      material.map = color;
      material.bumpMap = detail;
      material.roughnessMap = detail;
      material.bumpScale = 0.012;
      material.roughness = 1;
      material.needsUpdate = true;
    }
    replaced.forEach(map => map?.dispose());
  });
}

/**
 * Deterministic fallback textures and metal maps. In the browser, generated
 * natural wood artwork replaces the wood/shaft/handle surfaces after loading.
 * Wood/bamboo grain runs along UV y; chain/brass brushing runs along UV x.
 * Maps are shared within each family. Dispose map, bumpMap and roughnessMap
 * once per unique texture when disposing the returned materials.
 */
export function createOperaMaterials() {
  const wood = woodTextures();
  const bamboo = bambooTextures();
  const metal = metalTextures();
  const make = (name, maps, color, options = {}) => {
    const material = new THREE.MeshStandardMaterial({
      ...maps,
      color,
      roughness: 1,
      metalness: 0,
      bumpScale: 0.026,
      ...options,
    });
    material.name = `opera-${name}`;
    return material;
  };
  const materials = {
    wood: make('wood', wood, '#c5a783'),
    woodLight: make('wood-light', wood, '#ffe9c7', { bumpScale: 0.023 }),
    bamboo: make('bamboo', bamboo, '#ac8050', { bumpScale: 0.018 }),
    handle: make('handle', wood, '#e8c69d', { roughness: 0.83, bumpScale: 0.022 }),
    tray: make('tray', wood, '#c4ab8b', { bumpScale: 0.03 }),
    chain: make('chain', metal, '#82909f', { metalness: 0.98, roughness: 0.78, bumpScale: 0.006 }),
    brass: make('brass', metal, '#e6bf74', { metalness: 0.68, roughness: 0.9, bumpScale: 0.006 }),
  };
  applyNaturalWood([materials.wood, materials.woodLight, materials.bamboo, materials.handle, materials.tray]);
  return materials;
}
