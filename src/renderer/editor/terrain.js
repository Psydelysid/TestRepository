import * as THREE from 'three';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';

export const TERRAIN_DEFAULTS = {
  size: 200,
  segments: 128,
  height: 30,
  roughness: 0.5,
  octaves: 5,
  seed: 1,
  waterLevel: 0.28,
};

// Deterministic fractal heightmap in [0, 1].
export function heightmap(params) {
  const p = { ...TERRAIN_DEFAULTS, ...params };
  const res = p.segments + 1;
  const noise = new ImprovedNoise();
  const offset = (p.seed * 137.31) % 1000;
  const data = new Float32Array(res * res);
  let min = Infinity;
  let max = -Infinity;

  for (let z = 0; z < res; z++) {
    for (let x = 0; x < res; x++) {
      let amp = 1;
      let freq = 1 / 48;
      let h = 0;
      for (let o = 0; o < p.octaves; o++) {
        h += noise.noise(x * freq * (128 / p.segments), z * freq * (128 / p.segments), offset) * amp;
        amp *= p.roughness;
        freq *= 2;
      }
      data[z * res + x] = h;
      if (h < min) min = h;
      if (h > max) max = h;
    }
  }
  const range = max - min || 1;
  for (let i = 0; i < data.length; i++) data[i] = (data[i] - min) / range;
  return { data, res };
}

const BANDS = [
  [0.0, new THREE.Color('#2b4a6f')], // deep
  [0.26, new THREE.Color('#c8b27a')], // sand
  [0.34, new THREE.Color('#5d8a3a')], // grass
  [0.6, new THREE.Color('#3f6b2a')], // forest
  [0.75, new THREE.Color('#7a6f63')], // rock
  [0.9, new THREE.Color('#f2f4f7')], // snow
];

export function colorForHeight(t, target = new THREE.Color()) {
  for (let i = BANDS.length - 1; i >= 0; i--) {
    if (t >= BANDS[i][0]) {
      const next = BANDS[i + 1];
      if (!next) return target.copy(BANDS[i][1]);
      const k = Math.min(1, (t - BANDS[i][0]) / (next[0] - BANDS[i][0]));
      return target.copy(BANDS[i][1]).lerp(next[1], k * k * k);
    }
  }
  return target.copy(BANDS[0][1]);
}

export function createTerrainGeometry(params) {
  const p = { ...TERRAIN_DEFAULTS, ...params };
  const { data } = heightmap(p);
  const plane = new THREE.PlaneGeometry(p.size, p.size, p.segments, p.segments);
  plane.rotateX(-Math.PI / 2);
  const pos = plane.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = data[i];
    pos.setY(i, t * p.height);
    colorForHeight(t, c).toArray(colors, i * 3);
  }
  plane.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  plane.computeVertexNormals();
  // Plain BufferGeometry so the sculpted vertices survive serialization.
  return new THREE.BufferGeometry().copy(plane);
}

export function createTerrain(params = {}) {
  const p = { ...TERRAIN_DEFAULTS, ...params };
  const mesh = new THREE.Mesh(
    createTerrainGeometry(p),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: false }),
  );
  mesh.name = 'Terrain';
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.userData.kind = 'terrain';
  mesh.userData.generator = p;

  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(p.size, p.size).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: '#3d7fb8', transparent: true, opacity: 0.75, roughness: 0.15, metalness: 0.1 }),
  );
  water.name = 'Water';
  water.position.y = p.waterLevel * p.height;
  water.receiveShadow = true;
  water.userData.kind = 'water';
  mesh.add(water);
  return mesh;
}

export function regenerateTerrain(mesh, params) {
  const p = { ...mesh.userData.generator, ...params };
  mesh.geometry.dispose();
  mesh.geometry = createTerrainGeometry(p);
  mesh.userData.generator = p;
  const water = mesh.children.find((c) => c.userData.kind === 'water');
  if (water) {
    water.geometry.dispose();
    water.geometry = new THREE.PlaneGeometry(p.size, p.size).rotateX(-Math.PI / 2);
    water.position.y = p.waterLevel * p.height;
  }
}
