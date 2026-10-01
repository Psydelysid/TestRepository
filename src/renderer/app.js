import { Editor } from './editor/editor.js';
import { Outliner } from './editor/outliner.js';
import { PropertiesPanel } from './editor/properties.js';
import { PRIMITIVES, LIGHTS } from './editor/primitives.js';
import { createTerrain } from './editor/terrain.js';
import { parseScan, SCAN_FORMATS } from './editor/scans.js';

const api = window.worldforge;
const $ = (sel) => document.querySelector(sel);

const viewport = $('#viewport');
let editor;
try {
  editor = new Editor(viewport);
} catch (err) {
  viewport.innerHTML = '';
  const msg = document.createElement('div');
  msg.className = 'drop-overlay';
  msg.style.display = 'flex';
  msg.textContent = `3D view unavailable: ${err.message}. Update your graphics drivers or start WorldForge with --use-angle=swiftshader.`;
  viewport.append(msg);
  throw err;
}
window.editor = editor; // handy for debugging from DevTools

const toast = (() => {
  const el = $('#toast');
  let timer;
  return (message, isError = false) => {
    el.textContent = message;
    el.classList.toggle('error', isError);
    el.classList.add('show');
    clearTimeout(timer);
    timer = setTimeout(() => el.classList.remove('show'), isError ? 5000 : 2500);
  };
})();

const status = (msg) => { $('#status').textContent = msg; };

new Outliner(editor, $('#outliner'));
new PropertiesPanel(editor, $('#properties'), $('#props-title'), { toast });

let currentFile = null;
let dirty = false;
const setDirty = (value) => {
  dirty = value;
  const name = currentFile ? currentFile.split(/[\\/]/).pop() : 'Untitled world';
  document.title = `${dirty ? '• ' : ''}${name} — WorldForge`;
};
editor.addEventListener('history', () => {
  setDirty(true);
  $('#btn-undo').disabled = !editor.history.undoStack.length;
  $('#btn-redo').disabled = !editor.history.redoStack.length;
});
editor.addEventListener('sceneChanged', updateStats);

function updateStats() {
  $('#stats').textContent = `${editor.world.children.length} objects`;
}

// ---------- starting world ----------

function starterWorld() {
  editor.newWorld();
  const ground = PRIMITIVES.plane();
  ground.name = 'Ground';
  editor.world.add(ground);
  editor.history.clear();
  currentFile = null;
  setDirty(false);
  editor.select(null);
  updateStats();
}

// ---------- actions ----------

const actions = {
  async new() {
    if (dirty && !confirm('Discard unsaved changes and start a new world?')) return;
    starterWorld();
    status('New world');
  },
  async open() {
    if (dirty && !confirm('Discard unsaved changes and open another world?')) return;
    const result = await api.openWorld();
    if (!result) return;
    try {
      await editor.loadJSON(result.json);
      currentFile = result.filePath;
      editor.history.clear();
      setDirty(false);
      status(`Opened ${result.filePath}`);
    } catch (err) {
      toast(`Could not open world: ${err.message}`, true);
    }
  },
  async save(forceDialog = false) {
    const json = JSON.stringify(editor.toJSON());
    const saved = await api.saveWorld(json, forceDialog ? null : currentFile);
    if (!saved) return;
    currentFile = saved;
    setDirty(false);
    toast('World saved');
    status(`Saved ${saved}`);
  },
  saveAs() { return actions.save(true); },
  async exportGlb() {
    status('Exporting GLB…');
    try {
      const data = await editor.exportGLB();
      const path = await api.exportGlb(data);
      if (path) toast(`Exported ${path.split(/[\\/]/).pop()}`);
      status(path ? `Exported ${path}` : 'Export cancelled');
    } catch (err) {
      toast(`Export failed: ${err.message}`, true);
    }
  },
  async import() {
    const files = await api.openScanDialog();
    for (const file of files) await importScan(file);
  },
  undo() { editor.history.undo(); },
  redo() { editor.history.redo(); },
  duplicate() { editor.duplicate(); },
  delete() { if (editor.selected) editor.removeObject(editor.selected); },
  focus() { editor.focus(); },
  receiver() { openReceiver(); },
};

api.onMenu((action) => actions[action]?.());

document.querySelectorAll('[data-action]').forEach((btn) => {
  btn.addEventListener('click', () => actions[btn.dataset.action]());
});

// ---------- add menu ----------

const dropdown = document.querySelector('.dropdown');
dropdown.querySelector('button').addEventListener('click', (e) => {
  e.stopPropagation();
  dropdown.classList.toggle('open');
});
document.addEventListener('click', () => dropdown.classList.remove('open'));

dropdown.querySelectorAll('[data-add]').forEach((btn) => {
  btn.addEventListener('click', () => {
    dropdown.classList.remove('open');
    const kind = btn.dataset.add;
    let object;
    if (kind === 'terrain') object = createTerrain({ seed: Math.floor(Math.random() * 9999) + 1 });
    else if (kind.startsWith('light:')) object = LIGHTS[kind.slice(6)]();
    else object = PRIMITIVES[kind]();

    // Place new props in front of the camera, sitting on whatever is below.
    if (kind !== 'terrain' && kind !== 'plane' && !object.isLight) {
      const t = editor.orbit.target;
      const lift = object.position.y;
      editor.dropToSurface(object, t.x, t.z);
      object.position.y += lift;
    }
    editor.addObject(object);
    if (kind === 'terrain') editor.focus(object);
    status(`Added ${object.name}`);
  });
});

// ---------- transform modes ----------

const modeButtons = document.querySelectorAll('[data-mode]');
function setMode(mode) {
  editor.transform.setMode(mode);
  modeButtons.forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
}
modeButtons.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

$('#snap').addEventListener('change', (e) => {
  const on = e.target.checked;
  editor.transform.setTranslationSnap(on ? 0.5 : null);
  editor.transform.setRotationSnap(on ? Math.PI / 12 : null);
  editor.transform.setScaleSnap(on ? 0.1 : null);
});

// ---------- keyboard ----------

window.addEventListener('keydown', (e) => {
  const typing = e.target.closest('input, select, textarea');
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z' && !typing) {
    e.preventDefault();
    e.shiftKey ? actions.redo() : actions.undo();
    return;
  }
  if (mod && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); actions.redo(); return; }
  if (mod && e.key.toLowerCase() === 'd' && !typing) { e.preventDefault(); actions.duplicate(); return; }
  if (typing || mod || e.altKey) return;
  switch (e.key) {
    case 'Delete':
    case 'Backspace': actions.delete(); break;
    case 'f': case 'F': actions.focus(); break;
    case 'w': case 'W': setMode('translate'); break;
    case 'e': case 'E': setMode('rotate'); break;
    case 'r': case 'R': setMode('scale'); break;
    case 'Escape': editor.select(null); break;
    default: return;
  }
  e.preventDefault();
});

// ---------- scan import ----------

async function importScan(file, { fromDevice = false } = {}) {
  status(`Importing ${file.name}…`);
  try {
    const object = await parseScan(file);
    object.userData.scan.source = fromDevice ? `device ${file.source}` : 'file';
    editor.dropToSurface(object, editor.orbit.target.x, editor.orbit.target.z);
    editor.addObject(object, { label: 'Import' });
    editor.focus(object);
    const { points, triangles } = object.userData.scan;
    const detail = points ? `${points.toLocaleString()} points` : `${triangles.toLocaleString()} triangles`;
    toast(`${fromDevice ? 'Received' : 'Imported'} ${file.name} (${detail})`);
    status(`${fromDevice ? 'Received' : 'Imported'} ${file.name}`);
  } catch (err) {
    console.error(err);
    toast(`Could not import ${file.name}: ${err.message}`, true);
    status('Import failed');
  }
}

api.onScanReceived((scan) => importScan(scan, { fromDevice: true }));

// Drag & drop files straight onto the viewport.
let dragDepth = 0;
viewport.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; viewport.classList.add('dragging'); });
viewport.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; viewport.classList.remove('dragging'); } });
viewport.addEventListener('dragover', (e) => e.preventDefault());
viewport.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  viewport.classList.remove('dragging');
  for (const f of e.dataTransfer.files) {
    const ext = f.name.split('.').pop().toLowerCase();
    if (!SCAN_FORMATS.includes(ext)) {
      toast(`Unsupported file: ${f.name}`, true);
      continue;
    }
    await importScan({ name: f.name, ext, data: await f.arrayBuffer() });
  }
});

// ---------- scan receiver dialog ----------

const dialog = $('#receiver-dialog');
const toggle = $('#receiver-toggle');

async function openReceiver() {
  renderReceiver(await api.receiverInfo());
  dialog.showModal();
}

function renderReceiver(info) {
  const body = $('#receiver-body');
  body.replaceChildren();
  const btn = $('#btn-receiver');
  btn.classList.toggle('on', !!info.running);
  const rs = $('#receiver-status');
  rs.textContent = info.running ? `Receiving scans at ${info.urls[0].split('?')[0]}` : 'Scan receiver off';
  rs.className = info.running ? 'live' : 'muted';
  toggle.textContent = info.running ? 'Stop receiver' : 'Start receiver';

  if (!info.running) {
    const p = document.createElement('p');
    p.textContent = 'Start the receiver to let phones and scanners on the same Wi-Fi network send scans directly into this world.';
    body.append(p);
    return;
  }
  const grid = document.createElement('div');
  grid.className = 'receiver-grid';
  const img = document.createElement('img');
  img.src = info.qr;
  img.alt = 'QR code with upload link';
  const steps = document.createElement('ol');
  const items = [
    'Connect your phone to the same Wi-Fi network as this computer.',
    'Scan this QR code with the phone camera (or open the link below).',
    'Pick the exported scan file – it appears in the scene instantly.',
  ];
  for (const text of items) {
    const li = document.createElement('li');
    li.textContent = text;
    steps.append(li);
  }
  grid.append(img, steps);
  body.append(grid);
  for (const url of info.urls) {
    const line = document.createElement('div');
    const span = document.createElement('span');
    span.className = 'url';
    span.textContent = url;
    line.append(span);
    body.append(line);
  }
  const note = document.createElement('p');
  note.textContent = 'Scripts and scanners can also POST the raw file to /upload with headers X-Filename and X-WorldForge-Key (the k= value in the link).';
  body.append(note);
}

toggle.addEventListener('click', async () => {
  const info = await api.receiverInfo();
  try {
    renderReceiver(info.running ? await api.stopReceiver() : await api.startReceiver());
  } catch (err) {
    toast(`Receiver error: ${err.message}`, true);
  }
});
$('#receiver-close').addEventListener('click', () => dialog.close());

window.addEventListener('beforeunload', (e) => {
  if (dirty) e.returnValue = false;
});

starterWorld();
status(`Ready – supports ${SCAN_FORMATS.map((f) => f.toUpperCase()).join(', ')}`);
