import * as THREE from 'three';
import { createOperaMaterials } from './opera-materials.js?v=1';

// All props use actual geometry; the fan and umbrella carry continuous paper
// artwork while their folds, ribs and handles remain fully three-dimensional.
const TAU = Math.PI * 2;

function material(color, options = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.65, ...options });
}

function mesh(geometry, surface, parent, position) {
  const result = new THREE.Mesh(geometry, surface);
  if (position) result.position.copy(position);
  result.castShadow = true;
  result.receiveShadow = true;
  parent.add(result);
  return result;
}

function rod(parent, from, to, radius, surface, segments = 7) {
  const start = new THREE.Vector3(...from);
  const end = new THREE.Vector3(...to);
  const delta = end.clone().sub(start);
  const geometry = new THREE.CylinderGeometry(radius, radius, delta.length(), segments);
  const uv = geometry.attributes.uv;
  for (let index = 0; index < uv.count; index += 1) {
    // Keep the long fibres at the same scale on ribs, shaft and handle.
    uv.setY(index, uv.getY(index) * Math.max(delta.length(), 0.3));
  }
  const result = mesh(geometry, surface, parent);
  result.position.copy(start).add(end).multiplyScalar(0.5);
  result.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
  return result;
}

function surfaceMesh(parent, vertices, indices, surface, projectUv) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  if (projectUv) {
    const uv = [];
    for (let index = 0; index < vertices.length; index += 3) {
      uv.push(...projectUv(vertices[index], vertices[index + 1]));
    }
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  }
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return mesh(geometry, surface, parent);
}

function timber(parent, width, height, depth, surface, position, grainAxis = 'y', offset = 0) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const vertices = geometry.attributes.position;
  const normals = geometry.attributes.normal;
  const uv = geometry.attributes.uv;
  for (let index = 0; index < uv.count; index += 1) {
    const x = vertices.getX(index);
    const y = vertices.getY(index);
    const z = vertices.getZ(index);
    // Rotate the grain with each board rather than stretching one square map
    // over the frame. The shallow sides retain the same long wood fibres.
    const along = grainAxis === 'x' ? x : y;
    const across = Math.abs(normals.getZ(index)) > 0.5 ? (grainAxis === 'x' ? y : x) : z;
    uv.setXY(index, across * 1.35 + offset, along * 0.58 + offset * 0.23);
  }
  return mesh(geometry, surface, parent, new THREE.Vector3(...position));
}

function makeFan(palette) {
  const group = new THREE.Group();
  const ribs = 32;
  const spread = THREE.MathUtils.degToRad(166);
  const radius = 1.85;
  const inner = 0.54;
  const point = (angle, r, z) => [Math.sin(angle) * r, Math.cos(angle) * r, z];

  for (let index = 0; index < ribs; index += 1) {
    const a = -spread / 2 + spread * index / ribs;
    const b = -spread / 2 + spread * (index + 1) / ribs;
    const middle = (a + b) / 2;
    const vertices = [
      ...point(a, inner, 0), ...point(a, radius, 0),
      ...point(middle, inner, 0.018), ...point(middle, radius, 0.09),
      ...point(b, inner, 0), ...point(b, radius, 0),
    ];
    surfaceMesh(group, vertices, [0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4], palette.fanPaper,
      (x, y) => [x / (radius * 2) + 0.5, y / radius]);
    rod(group, point(middle, inner, 0.026), point(middle, radius, 0.097), 0.004, palette.paperEdge, 4);
    rod(group, point(a, radius, 0.003), point(middle, radius, 0.092), 0.008, palette.ink, 5);
    rod(group, point(middle, radius, 0.092), point(b, radius, 0.003), 0.008, palette.ink, 5);
  }

  for (let index = 0; index <= ribs; index += 1) {
    const angle = -spread / 2 + spread * index / ribs;
    rod(group, point(angle, 0.025, -0.014), point(angle, radius + 0.005, -0.014), index === 0 || index === ribs ? 0.027 : 0.011, palette.woodLight, 10);
    rod(group, point(angle, 0.03, 0.013), point(angle, inner + 0.06, 0.013), 0.012, palette.bamboo, 10);
  }

  const rivet = mesh(new THREE.CylinderGeometry(0.057, 0.057, 0.07, 16), palette.brass, group, new THREE.Vector3(0, 0.075, 0.015));
  rivet.rotation.x = Math.PI / 2;

  group.rotation.z = -0.07;
  return group;
}

function makeUmbrella(palette) {
  const group = new THREE.Group();
  const assembly = new THREE.Group();
  group.add(assembly);
  const ribs = 32;
  const radius = 1.34;
  const height = r => 0.45 * (1 - Math.pow(r / radius, 1.35));
  const point = (angle, r, extra = 0) => [Math.cos(angle) * r, Math.sin(angle) * r, height(r) + extra];

  for (let index = 0; index < ribs; index += 1) {
    const a = index / ribs * TAU;
    const b = (index + 1) / ribs * TAU;
    const middle = (a + b) / 2;
    const vertices = [0, 0, 0.45];
    for (const r of [0.52, 0.98, radius]) {
      vertices.push(...point(a, r), ...point(middle, r, -0.022), ...point(b, r));
    }
    const indices = [0, 1, 2, 0, 2, 3];
    for (let ring = 0; ring < 2; ring += 1) {
      const offset = 1 + ring * 3;
      indices.push(offset, offset + 3, offset + 1, offset + 1, offset + 3, offset + 4, offset + 1, offset + 4, offset + 2, offset + 2, offset + 4, offset + 5);
    }
    surfaceMesh(assembly, vertices, indices, palette.umbrellaPaper,
      (x, y) => [x / (radius * 2) + 0.5, y / (radius * 2) + 0.5]);
    // Follow the paper's exact radial segments on the underside. A spline can
    // bow through the faceted canopy and make the bamboo appear interrupted.
    const ribRadii = [0.02, 0.52, 0.98, radius];
    for (let segment = 0; segment < ribRadii.length - 1; segment += 1) {
      rod(assembly, point(a, ribRadii[segment], -0.035), point(a, ribRadii[segment + 1], -0.035), 0.016, palette.bamboo, 10);
    }
    rod(assembly, point(a, radius, 0.003), point(middle, radius, -0.015), 0.01, palette.brass, 5);
    rod(assembly, point(middle, radius, -0.015), point(b, radius, 0.003), 0.01, palette.brass, 5);
    rod(assembly, [0, 0, -0.46], point(a, 0.76, -0.045), 0.011, palette.bamboo, 8);
  }

  rod(assembly, [0, 0, 0.51], [0, 0, -3.24], 0.036, palette.woodLight, 16);
  rod(assembly, [0, 0, -2.68], [0, 0, -3.35], 0.062, palette.handle, 20);
  for (const z of [-2.71, -3.29]) {
    const band = mesh(new THREE.TorusGeometry(0.055, 0.009, 6, 16), palette.brass, assembly);
    band.position.z = z;
  }
  const cap = mesh(new THREE.SphereGeometry(0.082, 12, 8), palette.brass, assembly);
  cap.position.z = 0.48;
  cap.scale.z = 0.65;
  // Present the open underside: bamboo ribs and the shaft face the viewer,
  // and the handle projects down from the canopy instead of hiding behind it.
  assembly.rotation.set(0.63, Math.PI, -0.12);
  return group;
}

function makeChain(palette) {
  const group = new THREE.Group();
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-1.35, 2.15, 0),
    new THREE.Vector3(-1.75, 1.05, 0.04),
    new THREE.Vector3(-1.1, 0.18, 0.12),
    new THREE.Vector3(0.55, 0.12, 0.08),
    new THREE.Vector3(1.46, -0.72, 0),
    new THREE.Vector3(1.05, -1.85, 0.08),
    new THREE.Vector3(-0.4, -2.07, 0.14),
    new THREE.Vector3(-1.4, -1.43, 0.03),
  ].map(point => point.multiplyScalar(1.25)));
  const ellipse = new THREE.CatmullRomCurve3(
    Array.from({ length: 32 }, (_, index) => {
      const angle = index / 32 * TAU;
      return new THREE.Vector3(Math.cos(angle) * 0.225, Math.sin(angle) * 0.34, 0);
    }), true,
  );
  const geometry = new THREE.TubeGeometry(ellipse, 48, 0.058, 12, true);
  const links = 29;
  for (let index = 0; index < links; index += 1) {
    const progress = index / (links - 1);
    const link = mesh(geometry, palette.chain, group, curve.getPointAt(progress));
    const tangent = curve.getTangentAt(progress);
    link.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
    link.rotateY(index % 2 ? Math.PI * 0.42 : -0.13);
  }
  group.rotation.z = -0.08;
  return group;
}

function makeGrid(palette) {
  const group = new THREE.Group();
  timber(group, 2.86, 2.86, 0.14, palette.wood, [0, 0, -0.22], 'y');
  // Nine empty compartments, each with its own continuous wooden floor.
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      timber(group, 0.86, 0.86, 0.035, palette.tray,
        [(col - 1) * 0.91, (row - 1) * 0.91, -0.13], 'y', row * 0.19 + col * 0.31);
    }
  }
  for (const position of [-1.39, 1.39]) {
    timber(group, 0.105, 2.86, 0.4, palette.woodLight, [position, 0, -0.02], 'y', position);
    timber(group, 2.86, 0.105, 0.4, palette.woodLight, [0, position, -0.02], 'x', position + 0.7);
  }
  for (const position of [-0.455, 0.455]) {
    timber(group, 0.063, 2.7, 0.31, palette.wood, [position, 0, -0.025], 'y', position + 0.3);
    timber(group, 2.7, 0.063, 0.31, palette.wood, [0, position, -0.025], 'x', position + 0.9);
  }
  group.rotation.set(0.17, -0.14, 0.08);
  return group;
}

function normalizeProp(source, id, name) {
  // Keep a stable origin for stage positioning, hover motion, and raycasting.
  source.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(source);
  const size = box.getSize(new THREE.Vector3());
  const scale = 3 / Math.max(size.x, size.y);
  const group = new THREE.Group();
  group.name = id;
  group.userData.propId = id;
  group.userData.propName = name;
  group.add(source);
  source.position.sub(box.getCenter(new THREE.Vector3()));
  group.scale.set(scale, scale, Math.min(scale, 1.3 / Math.max(size.z, 0.001)));
  return { id, name, group };
}

export function createOperaProps() {
  // Guard the browser loader so geometry can also be inspected in Node.
  const textureLoader = typeof document === 'undefined' ? null : new THREE.TextureLoader();
  const artPaper = (path, roughness, paperColor) => {
    const surface = material(paperColor, { side: THREE.DoubleSide, roughness });
    if (!textureLoader) return surface;
    let disposed = false;
    surface.addEventListener('dispose', () => { disposed = true; });
    // Keep the paper visible while downloading; an incomplete map renders black.
    textureLoader.load(path, texture => {
      if (disposed) { texture.dispose(); return; }
      texture.name = path;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 8;
      surface.color.set('#ffffff');
      surface.map = texture;
      surface.needsUpdate = true;
    });
    return surface;
  };
  const palette = {
    ...createOperaMaterials(),
    fanPaper: artPaper('/images/opera-fan-art-v1.png', 0.92, '#eee5cc'),
    umbrellaPaper: artPaper('/images/opera-umbrella-art-v1.png', 0.9, '#dfc38e'),
    paperEdge: material('#c8b791', { roughness: 0.9 }),
    ink: material('#25281f', { side: THREE.DoubleSide, roughness: 1 }),
  };
  return [
    normalizeProp(makeFan(palette), 'fan', '紙扇'),
    normalizeProp(makeUmbrella(palette), 'umbrella', '紙傘'),
    normalizeProp(makeChain(palette), 'chain', '鎖鏈'),
    normalizeProp(makeGrid(palette), 'grid', '九宮格'),
  ];
}
