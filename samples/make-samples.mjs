// Generates sample "scans" so WorldForge's import pipeline can be tried without a scanner.
//   node samples/make-samples.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
let seed = 42;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const noise = (s) => (rand() - 0.5) * s;

// A small room corner with a table, as a LiDAR app would export it (binary PLY point cloud).
function roomCorner() {
  const pts = [];
  const add = (x, y, z, r, g, b) => pts.push([x + noise(0.01), y + noise(0.01), z + noise(0.01), r, g, b]);
  for (let i = 0; i < 9000; i++) { // wooden floor
    const x = rand() * 4, z = rand() * 4;
    const plank = Math.floor(x * 5) % 2 ? 0 : 18;
    add(x, 0, z, 150 + plank, 105 + plank, 70);
  }
  for (let i = 0; i < 6000; i++) add(rand() * 4, rand() * 2.6, 0, 222, 214, 196); // back wall
  for (let i = 0; i < 6000; i++) add(0, rand() * 2.6, rand() * 4, 205, 198, 182); // side wall
  for (let i = 0; i < 2500; i++) add(1.5 + rand() * 1.2, 0.75, 1.5 + rand() * 0.8, 120, 72, 40); // table top
  for (const [lx, lz] of [[1.55, 1.55], [2.65, 1.55], [1.55, 2.25], [2.65, 2.25]]) {
    for (let i = 0; i < 150; i++) add(lx + noise(0.05), rand() * 0.75, lz + noise(0.05), 90, 55, 30);
  }
  for (let i = 0; i < 1200; i++) { // a ball on the table
    const u = rand() * 2 - 1, t = rand() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    add(2.1 + 0.15 * s * Math.cos(t), 0.9 + 0.15 * u, 1.9 + 0.15 * s * Math.sin(t), 200, 40, 40);
  }
  const header = `ply\nformat binary_little_endian 1.0\ncomment WorldForge sample scan\nelement vertex ${pts.length}\n` +
    'property float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n';
  const body = Buffer.alloc(pts.length * 15);
  pts.forEach(([x, y, z, r, g, b], i) => {
    const o = i * 15;
    body.writeFloatLE(x, o); body.writeFloatLE(y, o + 4); body.writeFloatLE(z, o + 8);
    body.writeUInt8(r, o + 12); body.writeUInt8(g, o + 13); body.writeUInt8(b, o + 14);
  });
  writeFileSync(join(here, 'room-corner.ply'), Buffer.concat([Buffer.from(header), body]));
  return pts.length;
}

// A rock-like boulder as an ASCII .xyz cloud (x y z r g b), Z-up like many survey tools.
function boulder() {
  const lines = [];
  for (let i = 0; i < 4000; i++) {
    const u = rand() * 2 - 1, t = rand() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    const r = 1 + 0.15 * Math.sin(5 * t) * Math.cos(3 * u) + noise(0.04);
    const z = Math.max(0, 0.7 * r * u + 0.5);
    const shade = Math.round(110 + 60 * (z / 1.2) + noise(20));
    lines.push(`${(r * s * Math.cos(t)).toFixed(4)} ${(r * s * Math.sin(t)).toFixed(4)} ${z.toFixed(4)} ${shade} ${shade - 6} ${shade - 14}`);
  }
  writeFileSync(join(here, 'boulder.xyz'), lines.join('\n') + '\n');
  return lines.length;
}

console.log(`room-corner.ply: ${roomCorner()} points`);
console.log(`boulder.xyz: ${boulder()} points`);
