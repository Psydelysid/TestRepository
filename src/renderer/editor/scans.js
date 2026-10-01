import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { PCDLoader } from 'three/addons/loaders/PCDLoader.js';
import { parsePointCloudText } from './pointcloud-parser.js';

export const SCAN_FORMATS = ['glb', 'gltf', 'obj', 'ply', 'stl', 'pcd', 'xyz', 'pts', 'txt', 'csv'];

const decoder = new TextDecoder();

function scanMaterial(geometry) {
  const hasColors = !!geometry.getAttribute('color');
  return new THREE.MeshStandardMaterial({
    color: hasColors ? '#ffffff' : '#b9c0cc',
    vertexColors: hasColors,
    roughness: 0.85,
    metalness: 0,
    side: THREE.DoubleSide,
  });
}

export function pointsFromGeometry(geometry, name) {
  const hasColors = !!geometry.getAttribute('color');
  const material = new THREE.PointsMaterial({
    size: 0.02,
    sizeAttenuation: true,
    vertexColors: hasColors,
    color: hasColors ? '#ffffff' : '#9fd3ff',
  });
  const points = new THREE.Points(geometry, material);
  points.name = name;
  return points;
}

function meshFromGeometry(geometry, name) {
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, scanMaterial(geometry));
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

async function parseGltf(data, baseUrl) {
  const loader = new GLTFLoader();
  const gltf = await loader.parseAsync(data, baseUrl || '');
  const root = gltf.scene;
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return root;
}

export async function parseScan({ name, ext, data, baseUrl }) {
  const format = (ext || name.split('.').pop() || '').toLowerCase();
  const label = name.replace(/\.[^.]+$/, '') || 'Scan';
  let object;

  switch (format) {
    case 'glb':
    case 'gltf':
      object = await parseGltf(data, baseUrl);
      break;
    case 'obj':
      object = new OBJLoader().parse(decoder.decode(data));
      object.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          if (o.geometry.getAttribute('color')) {
            o.material = scanMaterial(o.geometry);
          }
        }
      });
      break;
    case 'ply': {
      const geometry = new PLYLoader().parse(data);
      // PLY files without faces are point clouds (typical LiDAR export).
      object = geometry.index ? meshFromGeometry(geometry, label) : pointsFromGeometry(geometry, label);
      break;
    }
    case 'stl':
      object = meshFromGeometry(new STLLoader().parse(data), label);
      break;
    case 'pcd':
      object = new PCDLoader().parse(data);
      object.material.size = 0.02;
      break;
    case 'xyz':
    case 'pts':
    case 'txt':
    case 'csv': {
      const cloud = parsePointCloudText(decoder.decode(data), { format });
      if (cloud.count === 0) throw new Error('No points found in file');
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(cloud.positions, 3));
      if (cloud.colors) {
        // File colors are sRGB; three.js expects linear vertex colors.
        const c = new THREE.Color();
        for (let i = 0; i < cloud.colors.length; i += 3) {
          c.setRGB(cloud.colors[i], cloud.colors[i + 1], cloud.colors[i + 2], THREE.SRGBColorSpace).toArray(cloud.colors, i);
        }
        geometry.setAttribute('color', new THREE.BufferAttribute(cloud.colors, 3));
      }
      object = pointsFromGeometry(geometry, label);
      break;
    }
    default:
      throw new Error(`Unsupported scan format ".${format}"`);
  }

  return wrapScan(object, { name: label, format });
}

// Puts the scan in a container group, centered on X/Z and resting on the ground,
// so the user can move/rotate the whole scan as one object.
export function wrapScan(object, { name, format }) {
  const container = new THREE.Group();
  container.name = name;
  container.add(object);

  const stats = scanStats(object);
  const box = new THREE.Box3().setFromObject(object);
  if (!box.isEmpty()) {
    const center = box.getCenter(new THREE.Vector3());
    object.position.sub(new THREE.Vector3(center.x, box.min.y, center.z));
  }
  autoPointSize(object, box);

  container.userData.kind = 'scan';
  container.userData.scan = { format, ...stats, importedAt: new Date().toISOString() };
  return container;
}

export function scanStats(object) {
  let points = 0;
  let triangles = 0;
  object.traverse((o) => {
    const g = o.geometry;
    if (!g) return;
    const count = g.attributes.position?.count || 0;
    if (o.isPoints) points += count;
    else if (o.isMesh) triangles += g.index ? g.index.count / 3 : count / 3;
  });
  return { points, triangles: Math.round(triangles) };
}

// Pick a readable point size from the cloud's density.
function autoPointSize(object, box) {
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  object.traverse((o) => {
    if (!o.isPoints) return;
    const n = Math.max(1, o.geometry.attributes.position.count);
    const area = Math.max(size.x * size.z, size.x * size.y, size.y * size.z, 1e-6);
    o.material.size = THREE.MathUtils.clamp(Math.sqrt(area / n) * 1.5, 0.002, 0.5);
  });
}

// Rotates the scan's contents (not the container) and re-seats them on the ground,
// e.g. to convert Z-up survey data to the Y-up convention used here.
export function reorientScan(container, axis, angle) {
  const inner = container.children[0];
  if (!inner) return;
  const q = new THREE.Quaternion().setFromAxisAngle(axis, angle);
  inner.quaternion.premultiply(q);
  inner.position.applyQuaternion(q);
  inner.updateMatrix();
  // Bounding box in container space, so the container's own transform doesn't matter.
  const box = new THREE.Box3();
  inner.updateMatrixWorld(true);
  const toLocal = container.matrixWorld.clone().invert();
  inner.traverse((o) => {
    if (!o.geometry) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    box.union(o.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(toLocal, o.matrixWorld)));
  });
  if (box.isEmpty()) return;
  const c = box.getCenter(new THREE.Vector3());
  inner.position.sub(new THREE.Vector3(c.x, box.min.y, c.z));
}

export function snapshotInner(container) {
  const inner = container.children[0];
  return { p: inner.position.toArray(), q: inner.quaternion.toArray() };
}

export function applyInner(container, s) {
  const inner = container.children[0];
  inner.position.fromArray(s.p);
  inner.quaternion.fromArray(s.q);
}
