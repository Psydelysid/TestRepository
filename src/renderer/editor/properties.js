import * as THREE from 'three';
import { regenerateTerrain, TERRAIN_DEFAULTS } from './terrain.js';
import { makeRock, makeTree, rng } from './primitives.js';
import { snapshotTransform, applyTransform } from './editor.js';
import { reorientScan, snapshotInner, applyInner } from './scans.js';

const DEG = THREE.MathUtils.RAD2DEG;
const RAD = THREE.MathUtils.DEG2RAD;

// Builds the right-hand inspector. Every field is bound with get()/set() so it can
// refresh live during gizmo drags and record undoable changes on commit.
export class PropertiesPanel {
  constructor(editor, root, titleEl, { toast } = {}) {
    this.editor = editor;
    this.root = root;
    this.titleEl = titleEl;
    this.toast = toast || (() => {});
    this.bindings = [];
    editor.addEventListener('selectionChanged', () => this.render());
    editor.addEventListener('objectChanged', () => this.refresh());
    editor.addEventListener('envChanged', () => this.refresh());
    editor.addEventListener('sceneChanged', () => { if (!this.editor.selected) this.render(); });
    this.render();
  }

  render() {
    this.root.replaceChildren();
    this.bindings = [];
    const o = this.editor.selected;
    if (!o) {
      this.titleEl.textContent = 'Environment';
      this.renderEnvironment();
      return;
    }
    this.titleEl.textContent = o.userData.kind === 'scan' ? 'Scan' : o.isLight ? 'Light' : 'Object';
    this.renderObject(o);
    if (!o.isHemisphereLight) this.renderTransform(o);
    if (o.isLight) this.renderLight(o);
    const mat = singleMaterial(o);
    if (mat) this.renderMaterial(o, mat);
    if (o.userData.kind === 'terrain') this.renderTerrain(o);
    if (o.userData.kind === 'scan') this.renderScan(o);
    this.renderActions(o);
  }

  refresh() {
    for (const b of this.bindings) b.refresh();
  }

  // ---------- sections ----------

  renderEnvironment() {
    const ed = this.editor;
    const env = (key) => ({
      get: () => ed.env[key],
      set: (v) => ed.setEnv({ [key]: v }),
    });
    const s = this.section('Sky & atmosphere');
    this.color(s, 'Sky color', env('background'), 'Sky color');
    this.color(s, 'Fog color', env('fogColor'), 'Fog color');
    this.range(s, 'Fog density', env('fogDensity'), { min: 0, max: 0.03, step: 0.0005 }, 'Fog density');
    this.range(s, 'Exposure', env('exposure'), { min: 0.1, max: 3, step: 0.05 }, 'Exposure');
    this.checkbox(s, 'Show grid', env('showGrid'), 'Toggle grid');

    const stats = this.section('World');
    let objects = 0;
    let points = 0;
    let triangles = 0;
    ed.world.traverse((o) => {
      if (o === ed.world) return;
      objects++;
      const g = o.geometry;
      if (!g) return;
      if (o.isPoints) points += g.attributes.position.count;
      else if (o.isMesh) triangles += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
    });
    stats.append(info([
      ['Top-level objects', ed.world.children.length],
      ['Total nodes', objects],
      ['Triangles', Math.round(triangles).toLocaleString()],
      ['Scan points', points.toLocaleString()],
    ]));
    const tip = document.createElement('p');
    tip.className = 'info';
    tip.textContent = 'Start with “＋ Add → Generated terrain”, or bring in a real place with “Import scan” / “Receive scans”.';
    stats.append(tip);
  }

  renderObject(o) {
    const s = this.section('Object');
    this.text(s, 'Name', { get: () => o.name, set: (v) => { o.name = v; this.editor.emit('sceneChanged'); } }, 'Rename');
    this.checkbox(s, 'Visible', { get: () => o.visible, set: (v) => { o.visible = v; this.editor.emit('sceneChanged'); } }, 'Visibility');
    if (o.isMesh || o.isGroup) {
      this.checkbox(s, 'Cast shadow', {
        get: () => anyMesh(o, (m) => m.castShadow),
        set: (v) => o.traverse((m) => { if (m.isMesh && m.userData.kind !== 'water') m.castShadow = v; }),
      }, 'Cast shadow');
    }
  }

  renderTransform(o) {
    const s = this.section('Transform');
    this.vec3(s, 'Position', { get: () => o.position.toArray(), set: (v) => o.position.fromArray(v) }, 'Move', 0.1);
    this.vec3(s, 'Rotation°', {
      get: () => [o.rotation.x * DEG, o.rotation.y * DEG, o.rotation.z * DEG],
      set: (v) => o.rotation.set(v[0] * RAD, v[1] * RAD, v[2] * RAD),
    }, 'Rotate', 1);
    this.vec3(s, 'Scale', { get: () => o.scale.toArray(), set: (v) => o.scale.fromArray(v) }, 'Scale', 0.05);
    if (!o.isLight) {
      this.buttons(s, [
        ['Drop to surface', () => this.transformCommand(o, 'Drop to surface', () => this.editor.dropToSurface(o, o.position.x, o.position.z))],
        ['Reset rotation', () => this.transformCommand(o, 'Reset rotation', () => o.rotation.set(0, 0, 0))],
      ]);
    }
  }

  renderLight(l) {
    const s = this.section('Light');
    this.color(s, l.isHemisphereLight ? 'Sky color' : 'Color', colorBinding(l.color), 'Light color');
    if (l.isHemisphereLight) this.color(s, 'Ground color', colorBinding(l.groundColor), 'Ground color');
    this.range(s, 'Intensity', { get: () => l.intensity, set: (v) => { l.intensity = v; } },
      { min: 0, max: l.isPointLight || l.isSpotLight ? 200 : 10, step: 0.1 }, 'Intensity');
    if (l.isPointLight || l.isSpotLight) {
      this.range(s, 'Range', { get: () => l.distance, set: (v) => { l.distance = v; } }, { min: 0, max: 200, step: 1 }, 'Light range');
    }
    if (l.isSpotLight) {
      this.range(s, 'Angle°', { get: () => l.angle * DEG, set: (v) => { l.angle = v * RAD; } }, { min: 1, max: 89, step: 1 }, 'Spot angle');
      this.range(s, 'Softness', { get: () => l.penumbra, set: (v) => { l.penumbra = v; } }, { min: 0, max: 1, step: 0.05 }, 'Spot softness');
    }
    if (!l.isHemisphereLight) {
      this.checkbox(s, 'Shadows', { get: () => l.castShadow, set: (v) => { l.castShadow = v; } }, 'Light shadows');
    }
  }

  renderMaterial(o, mat) {
    const s = this.section(mat.isPointsMaterial ? 'Points' : 'Material');
    if (!mat.vertexColors) this.color(s, 'Color', colorBinding(mat.color), 'Color');
    if (mat.isPointsMaterial) {
      this.range(s, 'Point size', { get: () => mat.size, set: (v) => { mat.size = v; } }, { min: 0.001, max: 0.5, step: 0.001 }, 'Point size');
      return;
    }
    if ('roughness' in mat) this.range(s, 'Roughness', { get: () => mat.roughness, set: (v) => { mat.roughness = v; } }, { min: 0, max: 1, step: 0.01 }, 'Roughness');
    if ('metalness' in mat) this.range(s, 'Metalness', { get: () => mat.metalness, set: (v) => { mat.metalness = v; } }, { min: 0, max: 1, step: 0.01 }, 'Metalness');
    this.range(s, 'Opacity', {
      get: () => mat.opacity,
      set: (v) => { mat.opacity = v; mat.transparent = v < 1; mat.needsUpdate = true; },
    }, { min: 0, max: 1, step: 0.01 }, 'Opacity');
    if ('flatShading' in mat) {
      this.checkbox(s, 'Flat shading', { get: () => mat.flatShading, set: (v) => { mat.flatShading = v; mat.needsUpdate = true; } }, 'Flat shading');
    }
  }

  renderTerrain(t) {
    const s = this.section('Terrain generator');
    const gen = (key) => ({
      get: () => t.userData.generator[key],
      set: (v) => regenerateTerrain(t, { [key]: v }),
    });
    this.range(s, 'Size (m)', gen('size'), { min: 20, max: 1000, step: 10 }, 'Terrain size');
    this.range(s, 'Height (m)', gen('height'), { min: 0, max: 200, step: 1 }, 'Terrain height');
    this.range(s, 'Detail', gen('segments'), { min: 16, max: 512, step: 16 }, 'Terrain detail');
    this.range(s, 'Roughness', gen('roughness'), { min: 0.2, max: 0.8, step: 0.01 }, 'Terrain roughness');
    this.range(s, 'Octaves', gen('octaves'), { min: 1, max: 8, step: 1 }, 'Terrain octaves');
    this.range(s, 'Water level', gen('waterLevel'), { min: 0, max: 1, step: 0.01 }, 'Water level');
    this.range(s, 'Seed', gen('seed'), { min: 1, max: 9999, step: 1 }, 'Terrain seed');
    this.buttons(s, [
      ['🎲 Randomize', () => {
        const before = { ...t.userData.generator };
        const after = { ...before, seed: Math.floor(Math.random() * 9999) + 1 };
        this.editor.change('Randomize terrain', (v) => regenerateTerrain(t, v), before, after);
      }],
      ['Reset', () => {
        const before = { ...t.userData.generator };
        this.editor.change('Reset terrain', (v) => regenerateTerrain(t, v), before, { ...TERRAIN_DEFAULTS });
      }],
    ]);

    const sc = this.section('Scatter');
    const countInput = document.createElement('input');
    countInput.type = 'number';
    countInput.value = 60;
    countInput.min = 1;
    countInput.max = 2000;
    sc.append(row('Count', countInput));
    this.buttons(sc, [
      ['🌲 Scatter trees', () => this.scatter(t, 'tree', Number(countInput.value))],
      ['🪨 Scatter rocks', () => this.scatter(t, 'rock', Number(countInput.value))],
    ]);
  }

  scatter(terrain, type, count) {
    const g = terrain.userData.generator;
    const rand = rng(Date.now());
    const group = new THREE.Group();
    group.name = type === 'tree' ? 'Forest' : 'Rocks';
    const raycaster = new THREE.Raycaster();
    terrain.updateMatrixWorld(true);
    const waterY = terrain.localToWorld(new THREE.Vector3(0, g.waterLevel * g.height, 0)).y;
    let placed = 0;
    for (let i = 0; i < count * 4 && placed < count; i++) {
      const local = new THREE.Vector3((rand() - 0.5) * g.size, g.height + 10, (rand() - 0.5) * g.size);
      const origin = terrain.localToWorld(local);
      raycaster.set(origin, new THREE.Vector3(0, -1, 0));
      const hit = raycaster.intersectObject(terrain, false)[0];
      if (!hit || hit.point.y < waterY + 0.5) continue;
      // Avoid steep slopes and snow caps for trees.
      const normal = hit.face.normal.clone().transformDirection(terrain.matrixWorld);
      if (type === 'tree' && (normal.y < 0.8 || hit.point.y > waterY + (g.height * (0.88 - g.waterLevel)))) continue;
      const prop = type === 'tree' ? makeTree() : makeRock(rand() * 1e9);
      const scale = type === 'tree' ? 0.7 + rand() * 0.8 : 0.4 + rand() * 1.6;
      prop.scale.setScalar(scale);
      prop.rotation.y = rand() * Math.PI * 2;
      prop.position.copy(hit.point);
      if (type === 'rock') prop.position.y += 0.15 * scale;
      group.add(prop);
      placed++;
    }
    if (!placed) {
      this.toast('No dry land to scatter on – try lowering the water level.', true);
      return;
    }
    this.editor.addObject(group, { label: 'Scatter' });
    this.toast(`Scattered ${placed} ${type === 'tree' ? 'trees' : 'rocks'}`);
  }

  renderScan(o) {
    const s = this.section('Scan');
    const scan = o.userData.scan || {};
    const size = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());
    s.append(info([
      ['Format', (scan.format || '?').toUpperCase()],
      ['Points', (scan.points || 0).toLocaleString()],
      ['Triangles', (scan.triangles || 0).toLocaleString()],
      ['Size (m)', `${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)}`],
      ['Source', scan.source || 'file'],
    ]));
    this.buttons(s, [
      ['Z-up → Y-up', () => this.reorient(o, 'Fix scan orientation', -Math.PI / 2)],
      ['Flip upside down', () => this.reorient(o, 'Flip scan', Math.PI)],
    ]);
    const units = document.createElement('select');
    for (const [label, factor] of [['meters', 1], ['centimeters', 0.01], ['millimeters', 0.001], ['inches', 0.0254], ['feet', 0.3048]]) {
      units.append(new Option(`File is in ${label}`, factor));
    }
    units.value = String(o.userData.scan?.unitScale ?? 1);
    units.addEventListener('change', () => {
      const factor = Number(units.value);
      const before = snapshotTransform(o);
      const after = { ...before, s: [factor, factor, factor] };
      this.editor.change('Scan units', (v) => applyTransform(o, v), before, after);
      o.userData.scan.unitScale = factor;
    });
    s.append(row('Units', units));

    const clouds = [];
    o.traverse((c) => { if (c.isPoints) clouds.push(c.material); });
    if (clouds.length && !singleMaterial(o)) {
      this.range(s, 'Point size', {
        get: () => clouds[0].size,
        set: (v) => clouds.forEach((m) => { m.size = v; }),
      }, { min: 0.001, max: 0.5, step: 0.001 }, 'Point size');
    }
  }

  renderActions(o) {
    const s = this.section('Actions');
    const buttons = [['Focus', () => this.editor.focus(o)]];
    if (!o.isHemisphereLight) buttons.push(['Duplicate', () => this.editor.duplicate(o)]);
    buttons.push(['Delete', () => this.editor.removeObject(o), 'danger']);
    this.buttons(s, buttons);
  }

  reorient(o, label, angle) {
    const before = snapshotInner(o);
    reorientScan(o, new THREE.Vector3(1, 0, 0), angle);
    const after = snapshotInner(o);
    applyInner(o, before);
    this.editor.change(label, (v) => { applyInner(o, v); this.render(); }, before, after);
  }

  transformCommand(o, label, fn) {
    const before = snapshotTransform(o);
    fn();
    const after = snapshotTransform(o);
    applyTransform(o, before);
    this.editor.change(label, (v) => applyTransform(o, v), before, after);
  }

  // ---------- field builders ----------

  section(title) {
    const el = document.createElement('div');
    el.className = 'section';
    const h = document.createElement('h3');
    h.textContent = title;
    el.append(h);
    this.root.append(el);
    return el;
  }

  bind(binding, label, read, write, inputs) {
    let committed = clone(binding.get());
    const commit = () => {
      const value = read();
      const before = committed;
      committed = clone(value);
      this.editor.change(label, (v) => binding.set(clone(v)), before, value);
    };
    for (const input of inputs) {
      input.addEventListener('input', () => binding.set(read()));
      input.addEventListener('change', commit);
    }
    this.bindings.push({
      refresh: () => {
        if (inputs.includes(document.activeElement)) return;
        committed = clone(binding.get());
        write(committed);
      },
    });
    write(committed);
  }

  text(parent, label, binding, histLabel) {
    const input = document.createElement('input');
    input.type = 'text';
    parent.append(row(label, input));
    this.bind(binding, histLabel, () => input.value, (v) => { input.value = v; }, [input]);
  }

  color(parent, label, binding, histLabel) {
    const input = document.createElement('input');
    input.type = 'color';
    parent.append(row(label, input));
    this.bind(binding, histLabel, () => input.value, (v) => { input.value = v; }, [input]);
  }

  checkbox(parent, label, binding, histLabel) {
    const input = document.createElement('input');
    input.type = 'checkbox';
    parent.append(row(label, input));
    this.bind(binding, histLabel, () => input.checked, (v) => { input.checked = !!v; }, [input]);
  }

  range(parent, label, binding, { min, max, step }, histLabel) {
    const wrap = document.createElement('div');
    wrap.className = 'range';
    const slider = Object.assign(document.createElement('input'), { type: 'range', min, max, step });
    const num = Object.assign(document.createElement('input'), { type: 'number', min, max, step });
    wrap.append(slider, num);
    parent.append(row(label, wrap));
    const sync = (from, to) => from.addEventListener('input', () => { to.value = from.value; });
    sync(slider, num);
    sync(num, slider);
    this.bind(binding, histLabel, () => Number(slider === document.activeElement ? slider.value : num.value),
      (v) => { slider.value = v; num.value = round(v, step); }, [slider, num]);
  }

  vec3(parent, label, binding, histLabel, step) {
    const wrap = document.createElement('div');
    wrap.className = 'vec';
    const inputs = [0, 1, 2].map(() => Object.assign(document.createElement('input'), { type: 'number', step }));
    wrap.append(...inputs);
    parent.append(row(label, wrap));
    this.bind(binding, histLabel, () => inputs.map((i) => Number(i.value) || 0),
      (v) => inputs.forEach((i, k) => { i.value = round(v[k], 0.001); }), inputs);
  }

  buttons(parent, list) {
    const wrap = document.createElement('div');
    wrap.className = 'buttons';
    for (const [label, fn, cls] of list) {
      const b = document.createElement('button');
      b.textContent = label;
      if (cls) b.className = cls;
      b.addEventListener('click', fn);
      wrap.append(b);
    }
    parent.append(wrap);
  }
}

// ---------- utils ----------

function row(label, control) {
  const el = document.createElement('div');
  el.className = 'row';
  const l = document.createElement('label');
  l.textContent = label;
  el.append(l, control);
  return el;
}

function info(pairs) {
  const el = document.createElement('div');
  el.className = 'info';
  for (const [k, v] of pairs) {
    const line = document.createElement('div');
    const b = document.createElement('b');
    b.textContent = String(v);
    line.append(`${k}: `, b);
    el.append(line);
  }
  return el;
}

function colorBinding(color) {
  return { get: () => `#${color.getHexString()}`, set: (v) => color.set(v) };
}

function singleMaterial(o) {
  if ((o.isMesh || o.isPoints) && !Array.isArray(o.material)) return o.material;
  return null;
}

function anyMesh(o, test) {
  let result = false;
  o.traverse((m) => { if (m.isMesh && test(m)) result = true; });
  return result;
}

function round(v, step) {
  const decimals = Math.max(0, Math.min(6, -Math.floor(Math.log10(step || 1))));
  return Number(Number(v).toFixed(decimals));
}

function clone(v) {
  return Array.isArray(v) ? [...v] : v;
}
