// Перевірка точності вибору: 3×3 цілі в просторі, система підсвічує одну — користувач обирає її
// заданим способом (погляд, миша/контролер, рука, голос — номер). Рахуються влучання, помилки, час.
import * as THREE from 'three';
import { makeButton, makePanel, disposeTree } from './ui3d.js';

export const METHODS = {
  gaze: 'Погляд (затримка)',
  eyes: 'Очі через вебкамеру',
  mouse: 'Миша / промінь контролера',
  controller: 'Контролер окулярів',
  hand: 'Рука (вебкамера, щипок)',
  voice: 'Голос (номер цілі)',
};
const TRIAL_MS = 8000;
const PAUSE_MS = 700;

export class AccuracyTest {
  constructor({ scene, onFinish, onProgress, onRebuild }) {
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    this.onFinish = onFinish;
    this.onProgress = onProgress;
    this.onRebuild = onRebuild;
    this.targets = [];
    this.running = false;
  }

  start({ method, trials, pose }) {
    this.method = method;
    // Випадкові цілі без повторів поспіль: інакше погляд уже стоїть на цілі, і захист від
    // випадкового вибору чекає, поки він зійде з кнопки.
    this.queue = [];
    while (this.queue.length < trials) {
      const n = 1 + Math.floor(Math.random() * 9);
      if (n !== this.queue.at(-1)) this.queue.push(n);
    }
    this.results = [];
    this.running = true;
    this.group.position.copy(pose.position);
    this.group.quaternion.copy(pose.quaternion);
    this.group.visible = true;
    this.next();
  }

  build(highlight, message) {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      disposeTree(c);
    }
    this.targets = [];
    let highlighted = null;
    const header = makePanel({
      w: 0.6,
      h: 0.11,
      lines: [
        { text: message, size: 0.03, bold: true, align: 'center' },
        { text: `Спосіб: ${METHODS[this.method]} · спроба ${this.results.length + (highlight ? 1 : 0)} з ${this.results.length + this.queue.length + (highlight ? 1 : 0)}`, size: 0.021, color: '#c4cad3', align: 'center' },
      ],
      padding: 0.016,
    });
    header.position.set(0, 0.33, -0.005);
    this.group.add(header);
    for (let n = 1; n <= 9; n++) {
      const b = makeButton({ id: `target-${n}`, w: 0.13, h: 0.13, label: String(n), size: 0.055, variant: n === highlight ? 'accent' : 'default' });
      b.position.set(((n - 1) % 3 - 1) * 0.16, 0.16 - Math.floor((n - 1) / 3) * 0.16, 0);
      b.userData.baseZ = 0;
      b.userData.target = n;
      this.group.add(b);
      this.targets.push(b);
      if (n === highlight) highlighted = b;
    }
    this.onRebuild?.(highlighted);
  }

  next() {
    clearTimeout(this.timer);
    this.current = null;
    if (!this.queue.length) return this.finish();
    const target = this.queue.shift();
    this.build(null, 'Приготуйтесь…');
    this.timer = setTimeout(() => {
      this.current = { target, since: performance.now() };
      this.build(target, `Оберіть ціль ${target}`);
      this.timer = setTimeout(() => this.record(null, null), TRIAL_MS);
    }, PAUSE_MS);
  }

  // Вибір цілі. Зараховуються лише вибори заданим способом — інші ігноруються.
  handleSelect(object, source) {
    if (!this.running || !this.current || !object.userData.target) return false;
    if (source !== this.method && !(this.method === 'mouse' && source === 'controller')) return false;
    this.record(object.userData.target, source);
    return true;
  }

  handleNumber(n) {
    if (!this.running || !this.current || this.method !== 'voice') return false;
    this.record(n, 'voice');
    return true;
  }

  record(selected, source) {
    if (!this.current) return;
    const ms = Math.round(performance.now() - this.current.since);
    const ok = selected === this.current.target;
    this.results.push({ target: this.current.target, selected, ok, ms, source });
    this.onProgress?.(ok ? `Влучно (${(ms / 1000).toFixed(1)} с)` : selected ? `Помилка: обрано ${selected}` : 'Час вийшов');
    this.current = null;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.next(), 400);
  }

  finish() {
    this.running = false;
    this.group.visible = false;
    const hits = this.results.filter((r) => r.ok);
    const summary = {
      method: this.method,
      label: METHODS[this.method],
      total: this.results.length,
      hits: hits.length,
      wrong: this.results.filter((r) => r.selected && !r.ok).length,
      missed: this.results.filter((r) => !r.selected).length,
      accuracy: this.results.length ? (hits.length / this.results.length) * 100 : 0,
      avgMs: hits.length ? hits.reduce((s, r) => s + r.ms, 0) / hits.length : null,
    };
    this.onFinish(summary);
  }

  stop() {
    clearTimeout(this.timer);
    this.running = false;
    this.current = null;
    this.group.visible = false;
  }
}
