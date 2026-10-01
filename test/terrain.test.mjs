import test from 'node:test';
import assert from 'node:assert';
import { heightmap, createTerrain, regenerateTerrain } from '../src/renderer/editor/terrain.js';

test('heightmap is normalized and deterministic', () => {
  const a = heightmap({ segments: 32, seed: 7 });
  const b = heightmap({ segments: 32, seed: 7 });
  const c = heightmap({ segments: 32, seed: 8 });
  assert.strictEqual(a.data.length, 33 * 33);
  assert.deepStrictEqual(a.data, b.data);
  assert.notDeepStrictEqual(a.data, c.data);
  assert.ok(Math.min(...a.data) < 1e-6);
  assert.ok(Math.abs(Math.max(...a.data) - 1) < 1e-6);
});

test('terrain mesh has vertex colors, water and survives serialization', () => {
  const t = createTerrain({ segments: 16, height: 10, size: 50 });
  assert.ok(t.geometry.getAttribute('color'));
  assert.strictEqual(t.geometry.type, 'BufferGeometry');
  const water = t.children.find((c) => c.userData.kind === 'water');
  assert.ok(water);
  const json = t.toJSON();
  assert.ok(json.geometries.some((g) => g.type === 'BufferGeometry' && g.data.attributes.position));
});

test('regenerate updates params and water level', () => {
  const t = createTerrain({ segments: 16, height: 10 });
  regenerateTerrain(t, { height: 40, waterLevel: 0.5 });
  assert.strictEqual(t.userData.generator.height, 40);
  const water = t.children.find((c) => c.userData.kind === 'water');
  assert.strictEqual(water.position.y, 20);
  t.geometry.computeBoundingBox();
  assert.ok(Math.abs(t.geometry.boundingBox.max.y - 40) < 1e-4);
});
