import test from 'node:test';
import assert from 'node:assert';
import { parsePointCloudText } from '../src/renderer/editor/pointcloud-parser.js';

test('parses plain xyz', () => {
  const r = parsePointCloudText('0 0 0\n1 2 3\n');
  assert.strictEqual(r.count, 2);
  assert.deepStrictEqual([...r.positions], [0, 0, 0, 1, 2, 3]);
  assert.strictEqual(r.colors, null);
});

test('parses csv with header and 0-255 colors', () => {
  const r = parsePointCloudText('X,Y,Z,R,G,B\n1,2,3,255,0,0\n4,5,6,0,255,0\n', { format: 'csv' });
  assert.strictEqual(r.count, 2);
  assert.deepStrictEqual([...r.colors], [1, 0, 0, 0, 1, 0]);
});

test('keeps 0-1 colors as-is', () => {
  const r = parsePointCloudText('1 2 3 0.5 0.25 1\n');
  assert.deepStrictEqual([...r.colors], [0.5, 0.25, 1]);
});

test('parses .pts with count line and intensity column', () => {
  const r = parsePointCloudText('2\n1 2 3 -100 10 20 30\n4 5 6 -50 40 50 60\n', { format: 'pts' });
  assert.strictEqual(r.count, 2);
  assert.ok(Math.abs(r.colors[0] - 10 / 255) < 1e-6);
  assert.ok(Math.abs(r.colors[5] - 60 / 255) < 1e-6);
});

test('skips comments and garbage', () => {
  const r = parsePointCloudText('# comment\n\nfoo bar baz\n1;2;3\n');
  assert.strictEqual(r.count, 1);
});
