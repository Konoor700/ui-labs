import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  distance, segmentLengths, totalLength, polygonArea, planarityError, summarize,
  formatLength, resultLine, formatArea, accuracyPercent, isValidPoint, findSnap,
} from '../public/js/geometry.js';
import { Measurement } from '../public/js/measurement.js';
import { detectionRate, noiseSigma, createRandom, LIGHTING } from '../public/js/sim/tracking.js';

const P = (x, y, z) => ({ x, y, z });
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('відстані та довжина ламаної', () => {
  near(distance(P(0, 0, 0), P(3, 4, 0)), 5);
  near(distance(P(1, 2, 3), P(1, 2, 3)), 0);
  const pts = [P(0, 0, 0), P(1.13, 0, 0), P(1.13, 0.778, 0), P(1.13, 0.778, 1.265)];
  assert.deepEqual(segmentLengths(pts).map((d) => +d.toFixed(3)), [1.13, 0.778, 1.265]);
  near(totalLength(pts), 3.173);
  near(totalLength([P(0, 0, 0), P(1, 0, 0), P(1, 1, 0)], true), 2 + Math.SQRT2);
});

test('площа замкненого контуру — в будь-якій площині', () => {
  // прямокутник 2 × 1 м на підлозі (y = 0)
  near(polygonArea([P(0, 0, 0), P(2, 0, 0), P(2, 0, 1), P(0, 0, 1)]), 2);
  // той самий прямокутник на нахиленій стіні
  const tilt = (p) => P(p.x, p.z * Math.sin(0.6), p.z * Math.cos(0.6));
  near(polygonArea([P(0, 0, 0), P(2, 0, 0), P(2, 0, 1), P(0, 0, 1)].map(tilt)), 2, 1e-9);
  // неопуклий Г-подібний контур: 2×2 мінус 1×1 = 3
  near(polygonArea([P(0, 0, 0), P(2, 0, 0), P(2, 0, 1), P(1, 0, 1), P(1, 0, 2), P(0, 0, 2)]), 3);
});

test('площа не рахується, якщо точки не в одній площині', () => {
  const pts = [P(0, 0, 0), P(1, 0, 0), P(1, 0.5, 1), P(0, 0, 1)];
  assert.ok(planarityError(pts) > 0.02);
  assert.equal(polygonArea(pts), null);
  assert.equal(summarize(pts, true).area, null);
  assert.equal(summarize(pts, false).area, null, 'відкрита ламана площі не має');
});

test('форматування українською', () => {
  assert.equal(formatLength(2.1), '210,0 см');
  assert.equal(formatLength(2.1, 'm'), '2,10 м');
  assert.equal(resultLine(summarize([P(0, 0, 0), P(1.13, 0, 0), P(1.13, 0.778, 0), P(1.13, 0.778, 1.265)])), '113,0 + 77,8 + 126,5 = 317,3 см');
  assert.equal(resultLine(summarize([P(0, 0, 0), P(2.797, 0, 0)])), '279,7 см');
  assert.equal(resultLine(summarize([])), '');
  assert.equal(formatArea(2), '2,00 м²');
});

test('точність відносно еталона', () => {
  near(accuracyPercent(2.1, 2.1), 100);
  near(accuracyPercent(2.079, 2.1), 99, 1e-9);
  near(accuracyPercent(1.89, 2.1), 90, 1e-9);
  assert.equal(accuracyPercent(1, 0), null);
});

test('прилипання: найближча точка в радіусі 6 см', () => {
  const pts = [P(0, 0, 0), P(1, 0, 0), P(1, 0, 1)];
  assert.equal(findSnap(pts, P(0.03, 0, 0.02)).index, 0);
  assert.equal(findSnap(pts, P(1.0, 0, 0.95)).index, 2);
  assert.equal(findSnap(pts, P(0.5, 0, 0.5)), null, 'далеко від усіх точок');
  assert.equal(findSnap(pts, P(0.07, 0, 0)), null, '7 см — уже поза радіусом');
  assert.equal(findSnap([P(0, 0, 0), P(0.05, 0, 0)], P(0.04, 0, 0)).index, 1, 'обирається найближча');
  assert.equal(findSnap([], P(0, 0, 0)), null);
});

test('валідація координат', () => {
  assert.ok(isValidPoint(P(0.5, 1.2, -3)));
  assert.ok(!isValidPoint(P(NaN, 0, 0)));
  assert.ok(!isValidPoint(P(0, Infinity, 0)));
  assert.ok(!isValidPoint(P(500, 0, 0)));
  assert.ok(!isValidPoint({ x: 1, y: 2 }));
  assert.ok(!isValidPoint(null));
});

test('вимір: додавання, повтори, видалення, порядок, скасування', () => {
  const m = new Measurement();
  let changes = 0;
  m.onChange(() => changes++);
  assert.ok(m.add(P(0, 0, 0)).ok);
  assert.ok(m.add(P(1, 0, 0)).ok);
  assert.equal(m.add(P(1.001, 0, 0)).ok, false, 'майже та сама точка — подвійний дотик');
  assert.equal(m.add(P(NaN, 0, 0)).ok, false);
  assert.ok(m.add(P(1, 1, 0)).ok);
  near(m.summary().total, 2);

  assert.ok(m.move(3, -1)); // поміняти 2-гу і 3-тю
  assert.deepEqual(m.points.map((p) => p.id), [1, 3, 2]);
  near(m.summary().total, Math.SQRT2 + 1);
  assert.equal(m.move(1, -1), false, 'першу точку не можна посунути раніше');

  assert.ok(m.setClosed(true));
  near(m.summary().area, 0.5);
  assert.ok(m.remove(3));
  assert.equal(m.closed, false, 'з двох точок контур не замкнений');

  assert.ok(m.undo());
  assert.deepEqual(m.points.map((p) => p.id), [1, 3, 2]);
  assert.equal(m.closed, true);
  m.clear();
  assert.equal(m.points.length, 0);
  assert.ok(m.undo());
  assert.equal(m.points.length, 3);
  assert.ok(changes >= 8);
});

test('вимір: завантаження збереженого та ліміт точок', () => {
  const m = new Measurement();
  m.load([P(0, 0, 0), P(0, 2.1, 0)]);
  assert.deepEqual(m.points.map((p) => p.id), [1, 2]);
  near(m.summary().total, 2.1);
  assert.ok(m.add(P(1, 2.1, 0)).ok, 'після завантаження нумерація продовжується');
  assert.equal(m.points.at(-1).id, 3);

  const full = new Measurement();
  for (let i = 0; i < 50; i++) full.add(P(i * 0.1, 0, 0));
  assert.equal(full.add(P(99, 0, 0)).ok, false);
});

test('трекінг: поверхні знаходяться при нормальному світлі, повільніше при тьмяному, у темряві — ні', () => {
  const normal = detectionRate('normal', 2, 0.9);
  const dim = detectionRate('dim', 2, 0.9);
  assert.ok(normal > dim && dim > 0);
  assert.equal(detectionRate('dark', 2, 0.9), 0);
  assert.ok(detectionRate('normal', 4, 0.9) < normal, 'далі — повільніше');
  assert.ok(detectionRate('normal', 2, 0.4) < normal, 'під кутом — повільніше');
  assert.equal(detectionRate('normal', 6, 1), 0, 'надто далеко');
  assert.equal(detectionRate('normal', 2, 0.1), 0, 'надто гострий кут');
  assert.ok(noiseSigma('dim', 2) > noiseSigma('normal', 2));
  assert.ok(noiseSigma('normal', 4) > noiseSigma('normal', 1));
  assert.ok(Object.keys(LIGHTING).length === 3);
});

test('трекінг: генератор випадкових чисел відтворюваний, похибка ~ нормальна', () => {
  const a = createRandom(42);
  const b = createRandom(42);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  const r = createRandom(7);
  const samples = Array.from({ length: 20000 }, () => r.gaussian());
  const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
  const sd = Math.sqrt(samples.reduce((s, v) => s + (v - mean) ** 2, 0) / samples.length);
  assert.ok(Math.abs(mean) < 0.03 && Math.abs(sd - 1) < 0.03, `mean ${mean}, sd ${sd}`);
});
