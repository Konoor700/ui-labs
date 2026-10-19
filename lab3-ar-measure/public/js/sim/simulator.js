// Симулятор AR-сесії: віртуальна кімната замість камери телефона.
// Імітує те, що робить ARCore: поступове знаходження площин, hit-test тільки по знайдених ділянках,
// похибку трекінгу, втрату трекінгу в темряві. Керування: WASD/стрілки — рух, миша — огляд, клік — точка.
import * as THREE from 'three';
import { buildRoom, ROOM } from './room.js';
import { LIGHTING, detectionRate, noiseSigma, createRandom } from './tracking.js';
import { makeReticle, placeReticle } from '../layer.js';

const LIGHT_LEVEL = { normal: 1, dim: 0.28, dark: 0.04 };
// Промені, якими «трекінг» оглядає сцену: центр кадру і чотири точки довкола.
const SAMPLES = [[0, 0, 1], [0.4, 0, 0.5], [-0.4, 0, 0.5], [0, 0.4, 0.5], [0, -0.4, 0.5]];
const MOVE_SPEED = 1.3; // м/с
const LIFT_SPEED = 0.8;

export class Simulator {
  constructor({ canvas, autoUpdate = true, seed = Date.now() }) {
    this.canvas = canvas;
    this.autoUpdate = autoUpdate;
    this.random = createRandom(seed);
    this.lighting = 'normal';
    this.noise = true;
    this.planesVisible = true;
    this.listeners = { frame: new Set(), detect: new Set(), click: new Set(), stats: new Set() };

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x202020);
    this.camera = new THREE.PerspectiveCamera(63, 1, 0.03, 30);
    this.camera.rotation.order = 'YXZ';

    const room = buildRoom(this.scene);
    this.surfaces = room.surfaces;
    this.hitMeshes = room.hitMeshes;
    this.lights = room.lights;
    this.baseIntensity = { hemi: this.lights.hemi.intensity, sun: this.lights.sun.intensity, lamp: this.lights.lamp.intensity };

    this.reticle = makeReticle();
    this.scene.add(this.reticle);
    this.raycaster = new THREE.Raycaster();

    this.pose = { position: new THREE.Vector3(0.3, 1.5, 1.4), yaw: 0.15, pitch: -0.25 };
    this.keys = new Set();
    this.applyPose();
    this.bindInput();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  on(event, fn) {
    this.listeners[event].add(fn);
  }

  emit(event, payload) {
    for (const fn of this.listeners[event]) fn(payload);
  }

  /* ---------- Налаштування ---------- */

  setLighting(name) {
    if (!LIGHTING[name]) return;
    this.lighting = name;
    const k = LIGHT_LEVEL[name];
    this.lights.hemi.intensity = this.baseIntensity.hemi * k;
    this.lights.sun.intensity = this.baseIntensity.sun * k;
    this.lights.lamp.intensity = this.baseIntensity.lamp * k;
    this.renderer.toneMappingExposure = name === 'dark' ? 0.6 : 1;
  }

  setNoise(on) {
    this.noise = Boolean(on);
  }

  setPlanesVisible(on) {
    this.planesVisible = Boolean(on);
  }

  resetTracking() {
    for (const s of this.surfaces) {
      s.progress = 0;
      s.detected = false;
      s.radius = 0;
      if (s.overlay) s.overlay.material.uniforms.uOpacity.value = 0;
      if (s.features) s.features.geometry.setDrawRange(0, 0);
    }
  }

  detectedSurfaces() {
    return this.surfaces.filter((s) => s.detected).map((s) => s.label);
  }

  /* ---------- Камера ---------- */

  setPose({ x, y, z, yaw, pitch }) {
    if (x !== undefined) this.pose.position.set(x, y, z);
    if (yaw !== undefined) this.pose.yaw = yaw;
    if (pitch !== undefined) this.pose.pitch = pitch;
    this.applyPose();
  }

  lookAt(target) {
    const d = new THREE.Vector3(target.x, target.y, target.z).sub(this.pose.position);
    this.pose.yaw = Math.atan2(-d.x, -d.z);
    this.pose.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    this.applyPose();
  }

  applyPose() {
    const p = this.pose.position;
    const m = 0.25;
    p.x = Math.min(ROOM.width / 2 - m, Math.max(-ROOM.width / 2 + m, p.x));
    p.z = Math.min(ROOM.depth / 2 - m, Math.max(-ROOM.depth / 2 + m, p.z));
    p.y = Math.min(2.4, Math.max(0.3, p.y));
    this.pose.pitch = Math.min(1.45, Math.max(-1.45, this.pose.pitch));
    this.camera.position.copy(p);
    this.camera.rotation.set(this.pose.pitch, this.pose.yaw, 0);
    this.camera.updateMatrixWorld();
  }

  bindInput() {
    const c = this.canvas;
    let start = null;
    c.addEventListener('pointerdown', (e) => {
      start = { x: e.clientX, y: e.clientY, yaw: this.pose.yaw, pitch: this.pose.pitch, drag: false };
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!start.drag && Math.hypot(dx, dy) > 5) start.drag = true;
      if (start.drag) {
        this.pose.yaw = start.yaw + dx * 0.0045;
        this.pose.pitch = start.pitch + dy * 0.0045;
        this.applyPose();
      }
    });
    c.addEventListener('pointerup', (e) => {
      if (start && !start.drag) {
        const r = c.getBoundingClientRect();
        this.emit('click', { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 });
      }
      start = null;
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.move(e.deltaY < 0 ? 0.15 : -0.15, 0, 0);
    }, { passive: false });
    const typing = (e) => e.target.closest?.('input, textarea, select');
    window.addEventListener('keydown', (e) => {
      if (!typing(e)) this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  move(forward, right, up) {
    const yaw = this.pose.yaw;
    this.pose.position.x += -Math.sin(yaw) * forward + Math.cos(yaw) * right;
    this.pose.position.z += -Math.cos(yaw) * forward - Math.sin(yaw) * right;
    this.pose.position.y += up;
    this.applyPose();
  }

  handleKeys(dt) {
    const k = this.keys;
    const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const r = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const u = (k.has('KeyR') ? 1 : 0) - (k.has('KeyF') ? 1 : 0);
    const turn = (k.has('ArrowLeft') ? 1 : 0) - (k.has('ArrowRight') ? 1 : 0);
    if (turn) {
      this.pose.yaw += turn * 1.4 * dt;
      this.applyPose();
    }
    if (f || r || u) this.move(f * MOVE_SPEED * dt, r * MOVE_SPEED * dt, u * LIFT_SPEED * dt);
  }

  /* ---------- Трекінг ---------- */

  cast(ndcX, ndcY) {
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const hit = this.raycaster.intersectObjects(this.hitMeshes, false)[0];
    if (!hit) return null;
    return { hit, surface: hit.object.userData.surface, direction: this.raycaster.ray.direction.clone() };
  }

  // Один крок «трекінгу»: поверхні, на які дивиться камера, поступово знаходяться й розростаються.
  updateTracking(dt) {
    const growth = LIGHTING[this.lighting].growth;
    for (const [x, y, weight] of SAMPLES) {
      const c = this.cast(x, y);
      if (!c || !c.surface.detectable) continue;
      const s = c.surface;
      const viewCos = Math.abs(c.direction.dot(s.normal));
      const rate = detectionRate(this.lighting, c.hit.distance, viewCos) * weight;
      if (rate <= 0) continue;
      const local = s.mesh.worldToLocal(c.hit.point.clone());
      if (!s.detected) {
        s.progress = Math.min(1, s.progress + rate * dt);
        if (s.progress >= 1) {
          s.detected = true;
          s.center = new THREE.Vector2(local.x, local.y);
          s.overlay.material.uniforms.uCenter.value.copy(s.center);
          s.radius = 0.35;
          this.emit('detect', s);
        }
      } else {
        const needed = s.center.distanceTo(new THREE.Vector2(local.x, local.y)) + 0.35;
        const max = Math.hypot(s.width, s.height);
        if (needed > s.radius) s.radius = Math.min(needed, max, s.radius + growth * weight * dt * 1.6);
      }
    }
    for (const s of this.surfaces) {
      if (!s.detectable) continue;
      const u = s.overlay.material.uniforms;
      u.uRadius.value = s.radius;
      const target = s.detected && this.planesVisible ? 1 : 0;
      u.uOpacity.value += (target - u.uOpacity.value) * Math.min(1, dt * 4);
      const count = s.features.geometry.attributes.position.count;
      s.features.geometry.setDrawRange(0, Math.floor(count * Math.min(1, s.progress)));
      s.features.material.opacity = s.detected ? 0.25 : 0.85;
      s.features.visible = this.planesVisible;
    }
  }

  // Детермінований прогін часу (для автотестів).
  advance(seconds, step = 1 / 30) {
    for (let t = 0; t < seconds; t += step) this.updateTracking(step);
  }

  /* ---------- Hit-test ---------- */

  // Як ARCore hit-test: промінь з точки екрана (NDC, −1…1) до знайденої площини.
  hitTest(ndcX = 0, ndcY = 0, { noise = this.noise } = {}) {
    if (this.lighting === 'dark') return { ok: false, reason: 'Замало світла: трекінг призупинено. Увімкніть світло.' };
    const c = this.cast(ndcX, ndcY);
    if (!c) return { ok: false, reason: 'Наведіть приціл на поверхню.' };
    const s = c.surface;
    if (!s.detectable) return { ok: false, reason: `Поверхню «${s.label}» не розпізнано: на ній немає деталей для трекінгу.` };
    if (!s.detected) return { ok: false, reason: 'Поверхню ще не знайдено — повільно поводіть камерою.' };
    const local = s.mesh.worldToLocal(c.hit.point.clone());
    if (s.center.distanceTo(new THREE.Vector2(local.x, local.y)) > s.radius) {
      return { ok: false, reason: 'Ця частина поверхні ще не знайдена — поводіть камерою над нею.' };
    }
    // Точка лежить на площині поверхні; похибка трекінгу — уздовж площини.
    const point = c.hit.point.clone();
    point.addScaledVector(s.normal, -point.clone().sub(s.mesh.position).dot(s.normal));
    if (noise) {
      const sigma = noiseSigma(this.lighting, c.hit.distance);
      const u = new THREE.Vector3(1, 0, 0).applyQuaternion(s.mesh.quaternion);
      const v = new THREE.Vector3(0, 1, 0).applyQuaternion(s.mesh.quaternion);
      point.addScaledVector(u, this.random.gaussian() * sigma).addScaledVector(v, this.random.gaussian() * sigma);
    }
    return { ok: true, point: { x: point.x, y: point.y, z: point.z }, normal: s.normal.clone(), surface: s.id, label: s.label, distance: c.hit.distance };
  }

  /* ---------- Цикл ---------- */

  resize() {
    const { clientWidth: w, clientHeight: h } = this.canvas;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  start() {
    let last = performance.now();
    let frames = 0;
    let fpsSince = last;
    const loop = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this.handleKeys(dt);
      if (this.autoUpdate) this.updateTracking(dt);

      // Приціл — без похибки, щоб не тремтів (похибка додається лише до поставленої точки).
      const center = this.hitTest(0, 0, { noise: false });
      if (center.ok) placeReticle(this.reticle, center.point, center.normal);
      else this.reticle.visible = false;
      this.emit('frame', center);

      this.renderer.render(this.scene, this.camera);
      frames++;
      if (now - fpsSince >= 1000) {
        this.emit('stats', { fps: Math.round((frames * 1000) / (now - fpsSince)) });
        frames = 0;
        fpsSince = now;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}
