'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ScanServer, sanitizeFilename } = require('../src/main/scan-server');

async function withServer(fn, opts = {}) {
  const received = [];
  const server = new ScanServer({ onScan: (s) => received.push(s), ...opts });
  const info = await server.start(0, '127.0.0.1');
  const base = `http://127.0.0.1:${info.port}`;
  try {
    await fn({ server, base, received, info });
  } finally {
    await server.stop();
  }
}

const post = (base, body, headers) => fetch(`${base}/upload`, { method: 'POST', body, headers });

test('serves the phone upload page and status', async () => {
  await withServer(async ({ base }) => {
    const page = await fetch(`${base}/`);
    assert.strictEqual(page.status, 200);
    assert.match(await page.text(), /WorldForge scan upload/);
    const status = await (await fetch(`${base}/status`)).json();
    assert.ok(status.formats.includes('ply'));
  });
});

test('info exposes pairing URLs and a token', async () => {
  await withServer(async ({ info, server }) => {
    assert.ok(info.running);
    assert.ok(info.urls.every((u) => u.includes(`k=${server.token}`)));
  });
});

test('accepts an upload with a valid key', async () => {
  await withServer(async ({ base, received, server }) => {
    const res = await post(base, '0 0 0\n1 1 1\n', { 'X-Filename': encodeURIComponent('room scan.xyz'), 'X-WorldForge-Key': server.token });
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.deepStrictEqual(json, { ok: true, name: 'room scan.xyz', bytes: 12 });
    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0].ext, 'xyz');
    assert.strictEqual(received[0].data.toString(), '0 0 0\n1 1 1\n');
  });
});

test('rejects uploads without the pairing key', async () => {
  await withServer(async ({ base, received }) => {
    const res = await post(base, 'x', { 'X-Filename': 'a.ply' });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(received.length, 0);
  });
});

test('rejects unsupported formats and empty bodies', async () => {
  await withServer(async ({ base, server }) => {
    const bad = await post(base, 'x', { 'X-Filename': 'virus.exe', 'X-WorldForge-Key': server.token });
    assert.strictEqual(bad.status, 415);
    const empty = await post(base, '', { 'X-Filename': 'a.ply', 'X-WorldForge-Key': server.token });
    assert.strictEqual(empty.status, 400);
  });
});

test('enforces the size limit', async () => {
  await withServer(async ({ base, server, received }) => {
    const res = await post(base, 'x'.repeat(2048), { 'X-Filename': 'a.ply', 'X-WorldForge-Key': server.token });
    assert.strictEqual(res.status, 413);
    assert.strictEqual(received.length, 0);
  }, { maxBytes: 1024 });
});

test('sanitizes filenames', () => {
  assert.strictEqual(sanitizeFilename('../../etc/passwd.ply'), 'passwd.ply');
  assert.strictEqual(sanitizeFilename('my<scan>.glb'), 'my_scan_.glb');
  assert.strictEqual(sanitizeFilename(''), 'scan');
});
