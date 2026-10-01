import * as THREE from 'three';

function standard(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05, ...extra });
}

function mesh(name, geometry, material) {
  const m = new THREE.Mesh(geometry, material);
  m.name = name;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// Mulberry32 – small seeded PRNG so generated props are reproducible.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRock(seed = Math.random() * 1e9) {
  const rand = rng(seed);
  const ico = new THREE.IcosahedronGeometry(1, 2);
  const pos = ico.attributes.position;
  const v = new THREE.Vector3();
  // Displace shared vertices consistently (positions are duplicated per face).
  const cache = new Map();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    if (!cache.has(key)) cache.set(key, 0.75 + rand() * 0.45);
    v.multiplyScalar(cache.get(key));
    pos.setXYZ(i, v.x, v.y * 0.7, v.z);
  }
  ico.computeVertexNormals();
  const geo = new THREE.BufferGeometry().copy(ico);
  const rock = mesh('Rock', geo, standard('#8a8580', { roughness: 0.95, flatShading: true }));
  rock.position.y = 0.5;
  return rock;
}

function makeTree() {
  const tree = new THREE.Group();
  tree.name = 'Tree';
  const trunk = mesh('Trunk', new THREE.CylinderGeometry(0.18, 0.28, 2, 8), standard('#6b4a2b', { roughness: 0.9 }));
  trunk.position.y = 1;
  const crown = mesh('Leaves', new THREE.ConeGeometry(1.2, 3, 10), standard('#2f6b33', { roughness: 0.8 }));
  crown.position.y = 3.2;
  const crown2 = mesh('Leaves', new THREE.ConeGeometry(0.9, 2.2, 10), standard('#3a7d3d', { roughness: 0.8 }));
  crown2.position.y = 4.4;
  tree.add(trunk, crown, crown2);
  return tree;
}

function makeHouse() {
  const house = new THREE.Group();
  house.name = 'House';
  const body = mesh('Walls', new THREE.BoxGeometry(4, 3, 5), standard('#d9cbb3'));
  body.position.y = 1.5;
  const roof = mesh('Roof', new THREE.CylinderGeometry(0.01, 3.6, 2, 4, 1), standard('#9c3d2e'));
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(1, 1, 1.25);
  roof.position.y = 4;
  const door = mesh('Door', new THREE.BoxGeometry(0.9, 1.8, 0.1), standard('#5a3b22'));
  door.position.set(0, 0.9, 2.52);
  house.add(body, roof, door);
  return house;
}

export const PRIMITIVES = {
  box: () => {
    const m = mesh('Box', new THREE.BoxGeometry(1, 1, 1), standard('#c9ced8'));
    m.position.y = 0.5;
    return m;
  },
  sphere: () => {
    const m = mesh('Sphere', new THREE.SphereGeometry(0.5, 32, 16), standard('#c9ced8'));
    m.position.y = 0.5;
    return m;
  },
  cylinder: () => {
    const m = mesh('Cylinder', new THREE.CylinderGeometry(0.5, 0.5, 1, 32), standard('#c9ced8'));
    m.position.y = 0.5;
    return m;
  },
  cone: () => {
    const m = mesh('Cone', new THREE.ConeGeometry(0.5, 1, 32), standard('#c9ced8'));
    m.position.y = 0.5;
    return m;
  },
  torus: () => {
    const m = mesh('Torus', new THREE.TorusGeometry(0.5, 0.18, 16, 48), standard('#c9ced8'));
    m.position.y = 0.7;
    return m;
  },
  plane: () => {
    const m = mesh('Ground', new THREE.PlaneGeometry(20, 20), standard('#7d8a6a', { side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2;
    m.castShadow = false;
    return m;
  },
  rock: () => makeRock(),
  tree: () => makeTree(),
  house: () => makeHouse(),
};

export const LIGHTS = {
  point: () => {
    const l = new THREE.PointLight('#ffd9a8', 30, 30);
    l.name = 'Point Light';
    l.position.set(0, 4, 0);
    l.castShadow = true;
    return l;
  },
  spot: () => {
    const l = new THREE.SpotLight('#ffffff', 60, 40, Math.PI / 6, 0.3);
    l.name = 'Spot Light';
    l.position.set(4, 8, 4);
    l.castShadow = true;
    return l;
  },
  directional: () => createSun('Directional Light'),
};

export function createSun(name = 'Sun') {
  const sun = new THREE.DirectionalLight('#fff4e0', 2.5);
  sun.name = name;
  sun.position.set(60, 100, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = sun.shadow.camera;
  s.left = -120; s.right = 120; s.top = 120; s.bottom = -120; s.near = 1; s.far = 400;
  sun.shadow.bias = -0.0005;
  return sun;
}

export function createSkyLight() {
  const hemi = new THREE.HemisphereLight('#bcd7ff', '#5a5040', 1.2);
  hemi.name = 'Sky Light';
  return hemi;
}

export { makeRock, makeTree };
