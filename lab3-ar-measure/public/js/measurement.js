// Поточний вимір: точки, порядок, замкненість контуру, скасування дій.
// Не залежить від three.js і DOM — однаково працює в симуляторі та в справжньому AR.
import { isValidPoint, distance, MIN_POINT_GAP, summarize } from './geometry.js';

export const MAX_POINTS = 50;

export class Measurement {
  constructor() {
    this.points = []; // { id, x, y, z, surface }
    this.closed = false;
    this.history = [];
    this.nextId = 1;
    this.listeners = new Set();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this);
  }

  snapshot() {
    return { points: this.points.map((p) => ({ ...p })), closed: this.closed, nextId: this.nextId };
  }

  commit(change) {
    this.history.push(this.snapshot());
    if (this.history.length > 100) this.history.shift();
    change();
    this.emit();
  }

  // Повертає { ok, point } або { ok: false, reason }.
  add(p, surface = null) {
    if (!isValidPoint(p)) return { ok: false, reason: 'Некоректні координати точки.' };
    if (this.points.length >= MAX_POINTS) return { ok: false, reason: `Не більше ${MAX_POINTS} точок в одному вимірі.` };
    const last = this.points.at(-1);
    if (last && distance(last, p) < MIN_POINT_GAP) return { ok: false, reason: 'Точка збігається з попередньою.' };
    const point = { id: this.nextId, x: p.x, y: p.y, z: p.z, surface };
    this.commit(() => {
      this.points.push(point);
      this.nextId++;
    });
    return { ok: true, point };
  }

  remove(id) {
    const index = this.points.findIndex((p) => p.id === id);
    if (index < 0) return false;
    this.commit(() => {
      this.points.splice(index, 1);
      if (this.points.length < 3) this.closed = false;
    });
    return true;
  }

  // Змінити порядок: direction −1 — раніше, +1 — пізніше.
  move(id, direction) {
    const index = this.points.findIndex((p) => p.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= this.points.length) return false;
    this.commit(() => {
      [this.points[index], this.points[target]] = [this.points[target], this.points[index]];
    });
    return true;
  }

  setClosed(closed) {
    if (closed && this.points.length < 3) return false;
    if (this.closed === closed) return true;
    this.commit(() => {
      this.closed = closed;
    });
    return true;
  }

  clear() {
    if (!this.points.length) return;
    this.commit(() => {
      this.points = [];
      this.closed = false;
    });
  }

  load(points, closed = false) {
    this.commit(() => {
      this.points = points.map((p, i) => ({ id: i + 1, x: p.x, y: p.y, z: p.z, surface: p.surface ?? null }));
      this.nextId = this.points.length + 1;
      this.closed = closed && this.points.length >= 3;
    });
  }

  undo() {
    const previous = this.history.pop();
    if (!previous) return false;
    this.points = previous.points;
    this.closed = previous.closed;
    this.nextId = previous.nextId;
    this.emit();
    return true;
  }

  summary() {
    return summarize(this.points, this.closed);
  }
}
