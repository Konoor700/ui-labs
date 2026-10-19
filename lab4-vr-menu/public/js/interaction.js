// Менеджер взаємодії: усі «вказівники» (погляд, миша/контролер, рука з вебкамери, контролери окулярів)
// кидають промені в кнопки меню. Погляд обирає із затримкою, інші — подією (клік, курок, щипок).
import * as THREE from 'three';
import { DwellTracker } from './dwell.js';

// Погляд очима з вебкамери тремтить і на мить «вискакує» на сусідні кнопки. Тому для очей ціллю
// вважається та кнопка (або порожнеча), на якій погляд був найдовше за останні EYE_WINDOW_MS.
export const EYE_WINDOW_MS = 300;

export function dominantTarget(history) {
  const totals = new Map();
  for (const h of history) totals.set(h.target, (totals.get(h.target) ?? 0) + h.ms);
  let best = null;
  let bestMs = -1;
  for (const [target, ms] of totals) if (ms > bestMs) [best, bestMs] = [target, ms];
  return best;
}

export class InteractionManager {
  constructor({ getTargets, getDwellMs, isGazeEnabled }) {
    this.getTargets = getTargets;
    this.getDwellMs = getDwellMs;
    this.isGazeEnabled = isGazeEnabled;
    this.pointers = new Map(); // id → { kind, ray: THREE.Ray, enabled, hit }
    this.dwell = new DwellTracker(getDwellMs());
    this.raycaster = new THREE.Raycaster();
    this.hovered = new Set();
    this.stats = { samples: [], avgMs: 0, maxMs: 0 };
    this.listeners = new Set();
    this.eyeHistory = [];
  }

  onSelect(fn) {
    this.listeners.add(fn);
  }

  addPointer(id, kind) {
    const pointer = { id, kind, ray: new THREE.Ray(), enabled: false, hit: null };
    this.pointers.set(id, pointer);
    return pointer;
  }

  setRay(id, origin, direction) {
    const p = this.pointers.get(id);
    if (!p) return;
    p.ray.origin.copy(origin);
    p.ray.direction.copy(direction).normalize();
    p.enabled = true;
  }

  disable(id) {
    const p = this.pointers.get(id);
    if (p) {
      p.enabled = false;
      p.hit = null;
    }
  }

  // Один кадр: промені → наведення → затримка погляду. Повертає дані для відображення.
  update(dtMs) {
    const t0 = performance.now();
    const targets = this.getTargets().filter((t) => t.visible !== false && t.userData.interactive);
    const nowHovered = new Set();
    for (const p of this.pointers.values()) {
      p.hit = null;
      if (!p.enabled || !targets.length) continue;
      this.raycaster.ray.copy(p.ray);
      const hit = this.raycaster.intersectObjects(targets, false)[0];
      if (hit) {
        p.hit = { object: hit.object, point: hit.point, distance: hit.distance };
        nowHovered.add(hit.object);
      }
    }
    for (const o of this.hovered) if (!nowHovered.has(o)) o.userData.setHover?.(false);
    for (const o of nowHovered) o.userData.setHover?.(true);
    this.hovered = nowHovered;

    // Погляд: затримка на кнопці → вибір.
    const gaze = this.pointers.get('gaze');
    let gazeProgress = 0;
    if (gaze) {
      this.dwell.dwellMs = this.getDwellMs();
      let target = this.isGazeEnabled() ? gaze.hit?.object ?? null : null;
      if (gaze.kind === 'eyes') {
        this.eyeHistory.push({ target, ms: dtMs });
        let total = this.eyeHistory.reduce((s, h) => s + h.ms, 0);
        while (this.eyeHistory.length > 1 && total - this.eyeHistory[0].ms >= EYE_WINDOW_MS) total -= this.eyeHistory.shift().ms;
        target = dominantTarget(this.eyeHistory);
      }
      // Після появи нової сторінки кнопка, на якій уже «стояв» погляд, не спрацьовує,
      // доки погляд з неї не зійде (вибір — лише свідомим наведенням).
      if (this.gazeBlock) {
        if (this.gazeBlock.target === undefined) this.gazeBlock.target = target === this.gazeBlock.except ? null : target;
        if (target && target === this.gazeBlock.target) target = null;
        else this.gazeBlock = null;
      }
      const previous = this.dwell.target;
      const result = this.dwell.update(target, dtMs);
      if (previous && previous !== target) previous.userData.setProgress?.(0);
      gazeProgress = result.progress;
      target?.userData.setProgress?.(result.progress);
      if (result.fired) {
        target.userData.setProgress?.(0);
        this.fire(target, gaze.kind);
      }
    }

    const ms = performance.now() - t0;
    const s = this.stats;
    s.samples.push(ms);
    if (s.samples.length > 240) s.samples.shift();
    s.avgMs = s.samples.reduce((a, b) => a + b, 0) / s.samples.length;
    s.maxMs = Math.max(...s.samples);
    return { gazeProgress, gazeHit: gaze?.hit ?? null };
  }

  // Подія «вибір» від вказівника (клік миші, курок контролера, щипок руки).
  select(id) {
    const p = this.pointers.get(id);
    if (!p?.enabled) return false;
    // Перераховуємо влучання саме зараз — промінь міг зрушити після останнього кадру.
    const targets = this.getTargets().filter((t) => t.visible !== false && t.userData.interactive);
    this.raycaster.ray.copy(p.ray);
    const target = targets.length ? this.raycaster.intersectObjects(targets, false)[0]?.object : null;
    if (!target) return false;
    this.fire(target, p.kind);
    return true;
  }

  fire(target, source) {
    target.userData.onSelect?.(source);
    for (const fn of this.listeners) fn(target, source);
  }

  // Скинути відлік погляду; requireEnter — вимагати, щоб погляд спершу зійшов з поточної кнопки;
  // except — кнопка, яку блокувати не треба (ціль, яку система щойно запропонувала обрати).
  resetDwell({ requireEnter = true, except = null } = {}) {
    this.dwell.target?.userData.setProgress?.(0);
    this.dwell.reset();
    this.eyeHistory = [];
    this.gazeBlock = requireEnter ? { target: undefined, except } : null;
  }
}
