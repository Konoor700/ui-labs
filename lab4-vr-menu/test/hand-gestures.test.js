import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HandGestures } from '../public/js/hand-gestures.js';
import { hand } from './hand.js';

// Послідовність кадрів 30 FPS: fn(частка 0…1) → параметри руки.
function run(g, from, duration, fn) {
  const events = [];
  const n = Math.round((duration / 1000) * 30);
  for (let i = 0; i <= n; i++) {
    const p = fn(i / n);
    events.push(...g.update({ t: from + (i * duration) / n, landmarks: hand(p), category: p.category ?? 'None' }));
  }
  return events;
}
const types = (events, type) => events.filter((e) => e.type === type);

test('курсор іде за долонею, дзеркально, у координатах екрана −1…1', () => {
  const g = new HandGestures();
  const center = types(run(g, 0, 500, () => ({ pose: 'open', x: 0.5, y: 0.42 })), 'cursor').at(-1);
  assert.ok(Math.abs(center.x) < 0.03 && Math.abs(center.y) < 0.03);
  const right = types(run(new HandGestures(), 0, 500, () => ({ pose: 'open', x: 0.25, y: 0.42 })), 'cursor').at(-1);
  assert.ok(right.x > 0.6, 'ліва частина кадру — права частина екрана');
});

test('щипок — одна подія вибору на кожне зімкнення, кулак — не щипок', () => {
  const g = new HandGestures();
  const events = [
    ...run(g, 0, 200, () => ({ pose: 'open' })),
    ...run(g, 233, 300, () => ({ pose: 'pinch' })),
    ...run(g, 566, 200, () => ({ pose: 'open' })),
    ...run(g, 800, 300, () => ({ pose: 'pinch' })),
  ];
  assert.equal(types(events, 'pinch').length, 2);
  assert.equal(types(run(new HandGestures(), 0, 500, () => ({ pose: 'fist' })), 'pinch').length, 0);
});

test('мах долонею вбік — гортання (з урахуванням дзеркала); повільний рух — ні', () => {
  const left = types(run(new HandGestures(), 0, 300, (k) => ({ pose: 'open', x: 0.3 + 0.4 * k })), 'swipe');
  assert.deepEqual(left.map((e) => e.dir), ['left'], 'рух вправо в кадрі — вліво для користувача');
  const right = types(run(new HandGestures(), 0, 300, (k) => ({ pose: 'open', x: 0.7 - 0.4 * k })), 'swipe');
  assert.deepEqual(right.map((e) => e.dir), ['right']);
  assert.equal(types(run(new HandGestures(), 0, 2500, (k) => ({ pose: 'open', x: 0.7 - 0.4 * k })), 'swipe').length, 0);
  assert.equal(types(run(new HandGestures(), 0, 300, (k) => ({ pose: 'fist', x: 0.7 - 0.4 * k })), 'swipe').length, 0, 'кулаком не гортаємо');
});

test('рука зникла — подія lost', () => {
  const g = new HandGestures();
  run(g, 0, 200, () => ({ pose: 'open' }));
  assert.deepEqual(g.update({ t: 300, landmarks: null }), [{ type: 'lost' }]);
});
