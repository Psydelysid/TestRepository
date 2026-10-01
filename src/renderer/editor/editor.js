import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { History } from './history.js';
import { createSun, createSkyLight } from './primitives.js';

export const WORLD_FORMAT = 'worldforge-world';
export const WORLD_VERSION = 1;

export const ENV_DEFAULTS = {
  background: '#9cc4e8',
  fogColor: '#c7dcef',
  fogDensity: 0.004,
  exposure: 1,
  showGrid: true,
};

export class Editor extends EventTarget {
  constructor(container) {
    super();
    this.container = container;
    this.history = new History();
    this.history.onChange = () => this.emit('history');
    this.selected = null;
    this.env = { ...ENV_DEFAULTS };

    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.world = new THREE.Group();
    this.world.name = 'World';
    this.scene.add(this.world);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.05, 5000);
    this.camera.position.set(18, 14, 22);

    this.grid = new THREE.GridHelper(200, 200, 0x4a5568, 0x2d3440);
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.35;
    this.scene.add(this.grid);

    this.helpers = new THREE.Group();
    this.scene.add(this.helpers);
    this.selectionBox = new THREE.BoxHelper(undefined, 0x4f8cff);
    this.selectionBox.visible = false;
    this.helpers.add(this.selectionBox);
    this.lightHelper = null;

    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.1;
    this.orbit.target.set(0, 1, 0);

    this.transform = new TransformControls(this.camera, this.renderer.domElement);
    this.scene.add(this.transform.getHelper());
    this.setupTransformControls();
    this.setupPicking();

    this.applyEnvironment();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.render());
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  // ---------- world lifecycle ----------

  newWorld({ withDefaults = true } = {}) {
    this.select(null);
    for (const child of [...this.world.children]) {
      this.world.remove(child);
      disposeObject(child);
    }
    this.env = { ...ENV_DEFAULTS };
    if (withDefaults) {
      this.world.add(createSkyLight());
      this.world.add(createSun());
    }
    this.applyEnvironment();
    this.history.clear();
    this.emit('sceneChanged');
  }

  toJSON() {
    return {
      format: WORLD_FORMAT,
      version: WORLD_VERSION,
      env: this.env,
      camera: { position: this.camera.position.toArray(), target: this.orbit.target.toArray() },
      world: this.world.toJSON(),
    };
  }

  async loadJSON(json) {
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    if (data.format !== WORLD_FORMAT) throw new Error('Not a WorldForge world file');
    const world = await new THREE.ObjectLoader().parseAsync(data.world);
    this.newWorld({ withDefaults: false });
    for (const child of [...world.children]) this.world.add(child);
    this.env = { ...ENV_DEFAULTS, ...data.env };
    if (data.camera) {
      this.camera.position.fromArray(data.camera.position);
      this.orbit.target.fromArray(data.camera.target);
    }
    this.applyEnvironment();
    this.emit('sceneChanged');
  }

  exportGLB() {
    const prevSelected = this.selected;
    this.select(null);
    return new GLTFExporter()
      .parseAsync(this.world, { binary: true, onlyVisible: true })
      .finally(() => this.select(prevSelected));
  }

  // ---------- environment ----------

  setEnv(patch) {
    Object.assign(this.env, patch);
    this.applyEnvironment();
    this.emit('envChanged');
  }

  applyEnvironment() {
    const e = this.env;
    this.scene.background = new THREE.Color(e.background);
    this.scene.fog = e.fogDensity > 0 ? new THREE.FogExp2(e.fogColor, e.fogDensity) : null;
    this.renderer.toneMappingExposure = e.exposure;
    this.grid.visible = e.showGrid;
  }

  // ---------- objects ----------

  addObject(object, { select = true, parent = this.world, label = 'Add' } = {}) {
    this.history.execute({
      label: `${label} ${object.name}`,
      redo: () => {
        parent.add(object);
        this.emit('sceneChanged');
        if (select) this.select(object);
      },
      undo: () => {
        if (this.selected === object) this.select(null);
        parent.remove(object);
        this.emit('sceneChanged');
      },
    });
    return object;
  }

  removeObject(object) {
    if (!object || !object.parent) return;
    const parent = object.parent;
    const index = parent.children.indexOf(object);
    this.history.execute({
      label: `Delete ${object.name}`,
      redo: () => {
        if (this.selected === object) this.select(null);
        parent.remove(object);
        this.emit('sceneChanged');
      },
      undo: () => {
        parent.add(object);
        // Restore original ordering in the outliner.
        parent.children.splice(parent.children.indexOf(object), 1);
        parent.children.splice(index, 0, object);
        this.emit('sceneChanged');
        this.select(object);
      },
    });
  }

  duplicate(object = this.selected) {
    if (!object || object.parent !== this.world) return null;
    const copy = cloneDeep(object);
    copy.name = `${object.name} copy`;
    copy.position.x += 1;
    return this.addObject(copy, { label: 'Duplicate' });
  }

  // Records a property change made through the UI so it can be undone.
  // `apply(value)` must set the property; `before`/`after` are plain values.
  change(label, apply, before, after) {
    if (valuesEqual(before, after)) return;
    this.history.execute({
      label,
      redo: () => { apply(after); this.emit('objectChanged', this.selected); },
      undo: () => { apply(before); this.emit('objectChanged', this.selected); },
    });
  }

  select(object) {
    if (object && object === this.selected) return;
    this.selected = object || null;
    if (this.lightHelper) {
      this.helpers.remove(this.lightHelper);
      this.lightHelper.dispose?.();
      this.lightHelper = null;
    }
    if (object && !object.isHemisphereLight) {
      this.transform.attach(object);
    } else {
      this.transform.detach();
    }
    if (object?.isLight) {
      this.lightHelper = makeLightHelper(object);
      if (this.lightHelper) this.helpers.add(this.lightHelper);
    }
    this.updateSelectionBox();
    this.emit('selectionChanged', this.selected);
  }

  updateSelectionBox() {
    const o = this.selected;
    if (o && !o.isLight) {
      this.selectionBox.setFromObject(o);
      this.selectionBox.visible = true;
    } else {
      this.selectionBox.visible = false;
    }
  }

  focus(object = this.selected) {
    const box = object && !object.isLight ? new THREE.Box3().setFromObject(object) : null;
    let center;
    let radius;
    if (box && !box.isEmpty()) {
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      center = sphere.center;
      radius = Math.max(sphere.radius, 0.5);
    } else if (object) {
      center = object.getWorldPosition(new THREE.Vector3());
      radius = 3;
    } else {
      return;
    }
    const dir = this.camera.position.clone().sub(this.orbit.target).normalize();
    const distance = radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2));
    this.orbit.target.copy(center);
    this.camera.position.copy(center).addScaledVector(dir, distance);
  }

  // Lay an object on whatever surface is underneath it (terrain, ground, scans).
  dropToSurface(object, x, z) {
    const others = this.world.children.filter((c) => c !== object && c.visible && !c.isLight);
    const ray = new THREE.Raycaster(new THREE.Vector3(x, 10000, z), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObjects(others, true).find((h) => h.object.userData.kind !== 'water' && !h.object.isPoints);
    object.position.set(x, hit ? hit.point.y : 0, z);
  }

  // ---------- internals ----------

  setupTransformControls() {
    let before = null;
    this.transform.addEventListener('dragging-changed', (e) => {
      this.orbit.enabled = !e.value;
      const obj = this.transform.object;
      if (!obj) return;
      if (e.value) {
        before = snapshotTransform(obj);
      } else if (before) {
        const after = snapshotTransform(obj);
        const start = before;
        before = null;
        this.change(`Transform ${obj.name}`, (v) => applyTransform(obj, v), start, after);
      }
    });
    this.transform.addEventListener('objectChange', () => {
      this.updateSelectionBox();
      this.emit('objectChanged', this.selected);
    });
  }

  setupPicking() {
    const el = this.renderer.domElement;
    const down = new THREE.Vector2();
    const raycaster = new THREE.Raycaster();
    el.addEventListener('pointerdown', (e) => down.set(e.clientX, e.clientY));
    el.addEventListener('pointerup', (e) => {
      if (e.button !== 0 || down.distanceTo(new THREE.Vector2(e.clientX, e.clientY)) > 4) return;
      if (this.transform.dragging || this.transform.axis) return;
      const rect = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, this.camera);
      const dist = this.camera.position.distanceTo(this.orbit.target);
      raycaster.params.Points.threshold = Math.max(0.02, dist * 0.004);
      const hits = raycaster.intersectObjects(this.world.children, true).filter((h) => isVisibleChain(h.object));
      this.select(hits.length ? topLevel(hits[0].object, this.world) : null);
    });
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.orbit.update();
    if (this.selected && !this.selected.isLight) this.selectionBox.setFromObject(this.selected);
    this.lightHelper?.update?.();
    this.renderer.render(this.scene, this.camera);
  }
}

// ---------- helpers ----------

export function topLevel(object, root) {
  let o = object;
  while (o.parent && o.parent !== root) o = o.parent;
  return o.parent === root ? o : null;
}

function isVisibleChain(object) {
  for (let o = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}

export function snapshotTransform(o) {
  return { p: o.position.toArray(), r: o.rotation.toArray().slice(0, 3), s: o.scale.toArray() };
}

export function applyTransform(o, t) {
  o.position.fromArray(t.p);
  o.rotation.set(t.r[0], t.r[1], t.r[2]);
  o.scale.fromArray(t.s);
}

function valuesEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function makeLightHelper(light) {
  if (light.isDirectionalLight) return new THREE.DirectionalLightHelper(light, 5);
  if (light.isSpotLight) return new THREE.SpotLightHelper(light);
  if (light.isPointLight) return new THREE.PointLightHelper(light, 0.5);
  return null;
}

// Clone with independent materials and geometry so edits don't leak into the original.
export function cloneDeep(object) {
  const copy = object.clone(true);
  copy.traverse((o) => {
    if (o.geometry) o.geometry = o.geometry.clone();
    if (o.material) o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
  });
  copy.userData = structuredClone(object.userData);
  return copy;
}

export function disposeObject(object) {
  object.traverse((o) => {
    o.geometry?.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
      m.dispose();
    }
  });
}
