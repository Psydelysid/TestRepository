'use strict';
// Small HTTP server that lets phones / scanners on the local network push
// 3D scans into WorldForge. GET / serves a mobile upload page, POST /upload
// accepts the raw file body with the filename in the X-Filename header.

const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SUPPORTED_EXTENSIONS = ['glb', 'gltf', 'obj', 'ply', 'stl', 'pcd', 'xyz', 'pts', 'txt', 'csv'];
const DEFAULT_MAX_BYTES = 512 * 1024 * 1024;

function extensionOf(name) {
  const ext = path.extname(name || '').slice(1).toLowerCase();
  return ext;
}

function sanitizeFilename(name) {
  const base = path.basename(String(name || 'scan'));
  return base.replace(/[^\w.\- ]+/g, '_').slice(0, 200) || 'scan';
}

function lanAddresses() {
  const result = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const iface of list || []) {
      if (iface.family === 'IPv4' && !iface.internal) result.push(iface.address);
    }
  }
  return result;
}

class ScanServer {
  constructor({ onScan, maxBytes = DEFAULT_MAX_BYTES, uploadPagePath } = {}) {
    this.onScan = onScan;
    this.maxBytes = maxBytes;
    this.uploadPagePath = uploadPagePath || path.join(__dirname, 'upload-page.html');
    // Pairing token: only devices that opened the URL shown in the app can upload.
    this.token = crypto.randomBytes(6).toString('hex');
    this.server = null;
    this.port = null;
  }

  get running() {
    return this.server !== null;
  }

  start(port = 8765, host = '0.0.0.0') {
    if (this.server) return Promise.resolve(this.info());
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => this.handle(req, res));
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        this.server = server;
        this.port = server.address().port;
        resolve(this.info());
      });
    });
  }

  stop() {
    if (!this.server) return Promise.resolve();
    const server = this.server;
    this.server = null;
    this.port = null;
    return new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections?.();
    });
  }

  info() {
    if (!this.server) return { running: false };
    const urls = lanAddresses().map((ip) => `http://${ip}:${this.port}/?k=${this.token}`);
    if (urls.length === 0) urls.push(`http://localhost:${this.port}/?k=${this.token}`);
    return { running: true, port: this.port, urls };
  }

  handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/') {
      fs.readFile(this.uploadPagePath, (err, data) => {
        if (err) return send(res, 500, 'text/plain', 'Upload page missing');
        send(res, 200, 'text/html; charset=utf-8', data);
      });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/status') {
      return sendJson(res, 200, { app: 'WorldForge', formats: SUPPORTED_EXTENSIONS });
    }
    if (req.method === 'POST' && url.pathname === '/upload') {
      return this.receive(req, res, url);
    }
    send(res, 404, 'text/plain', 'Not found');
  }

  receive(req, res, url) {
    const key = req.headers['x-worldforge-key'] || url.searchParams.get('k');
    if (key !== this.token) {
      req.resume();
      return sendJson(res, 403, { ok: false, error: 'Invalid pairing key. Re-open the link shown in WorldForge.' });
    }
    const rawName = req.headers['x-filename']
      ? decodeURIComponent(String(req.headers['x-filename']))
      : url.searchParams.get('name');
    const name = sanitizeFilename(rawName);
    const ext = extensionOf(name);
    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      req.resume();
      return sendJson(res, 415, { ok: false, error: `Unsupported format ".${ext}". Use: ${SUPPORTED_EXTENSIONS.join(', ')}` });
    }
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > this.maxBytes) {
      req.resume();
      return sendJson(res, 413, { ok: false, error: 'File too large' });
    }

    const chunks = [];
    let size = 0;
    let aborted = false;
    req.on('data', (chunk) => {
      if (aborted) return;
      size += chunk.length;
      if (size > this.maxBytes) {
        aborted = true;
        sendJson(res, 413, { ok: false, error: 'File too large' });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (aborted) return;
      if (size === 0) return sendJson(res, 400, { ok: false, error: 'Empty upload' });
      const data = Buffer.concat(chunks);
      const source = req.socket.remoteAddress || 'unknown';
      try {
        this.onScan?.({ name, ext, data, source, receivedAt: new Date().toISOString() });
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: String(err.message || err) });
      }
      sendJson(res, 200, { ok: true, name, bytes: size });
    });
  }
}

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type });
  res.end(body);
}

function sendJson(res, status, obj) {
  send(res, status, 'application/json', JSON.stringify(obj));
}

module.exports = { ScanServer, SUPPORTED_EXTENSIONS, sanitizeFilename, extensionOf, lanAddresses };
