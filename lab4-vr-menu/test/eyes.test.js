import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFeatures, EYE } from '../public/js/eye-features.js';
import { dominantTarget } from '../public/js/interaction.js';
import { fit, predict, evaluate, dropOutliers, OneEuroFilter, MedianFilter, CALIBRATION_POINTS, VALIDATION_POINTS, pixelsToDegrees } from '../public/js/gaze-calibration.js';

// Синтетичне обличчя: 478 точок, задано лише ті, що використовуються. gx, gy — куди «дивляться» зіниці (−1…1).
function face({ gx = 0, gy = 0, blink = false, cx = 0.5, cy = 0.45 } = {}) {
  const lm = Array.from({ length: 478 }, () => ({ x: cx, y: cy, z: 0 }));
  const set = (i, x, y) => (lm[i] = { x, y, z: 0 });
  const eye = (e, ox, a, b) => {
    set(a, ox - 0.03, cy); // ліва (на зображенні) точка ока
    set(b, ox + 0.03, cy);
    set(e.top, ox, cy - (blink ? 0.002 : 0.012));
    set(e.bottom, ox, cy + (blink ? 0.002 : 0.012));
    set(e.iris, ox + gx * 0.012, cy + gy * 0.006);
  };
  eye(EYE.right, cx - 0.06, EYE.right.outer, EYE.right.inner);
  eye(EYE.left, cx + 0.06, EYE.left.inner, EYE.left.outer);
  set(1, cx, cy + 0.06); set(234, cx - 0.12, cy + 0.05); set(454, cx + 0.12, cy + 0.05); set(10, cx, cy - 0.1); set(152, cx, cy + 0.2);
  return lm;
}

test('ознаки очей: зіниця вправо/вниз змінює h/v, закриті очі — моргання', () => {
  const center = extractFeatures(face()).features;
  const right = extractFeatures(face({ gx: 1 })).features;
  const down = extractFeatures(face({ gy: 1 })).features;
  assert.ok(Math.abs(center[0] - 0.5) < 1e-9, 'зіниця по центру — h = 0,5');
  assert.ok(right[0] > center[0] + 0.15);
  assert.ok(down[1] > center[1] + 0.05);
  assert.equal(extractFeatures(face()).blink, false);
  assert.equal(extractFeatures(face({ blink: true })).blink, true);
  assert.equal(extractFeatures(null).features, null);
});

// «Віртуальне око»: ознаки, які дало б обличчя, що дивиться в точку екрана (x, y), з шумом.
function eyeLooking(x, y, noise, rnd) {
  const lm = face({ gx: (x - 0.5) * 2 + rnd() * noise, gy: (y - 0.5) * 2 + rnd() * noise });
  return extractFeatures(lm).features;
}
function random(seed = 1) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
}

test('калібрування за 9 точками: похибка на контрольних точках мала', () => {
  const rnd = random(3);
  const samples = CALIBRATION_POINTS.flatMap(([x, y]) => Array.from({ length: 20 }, () => ({ f: eyeLooking(x, y, 0.05, rnd), x, y })));
  const model = fit(samples);
  const validation = VALIDATION_POINTS.flatMap(([x, y]) => Array.from({ length: 10 }, () => ({ f: eyeLooking(x, y, 0.05, rnd), x, y })));
  const err = evaluate(model, validation, { width: 1400, height: 800 });
  assert.ok(err.mean < 40, `середня похибка ${err.mean.toFixed(1)} пікс.`);
  const p = predict(model, eyeLooking(0.9, 0.1, 0, rnd));
  assert.ok(Math.abs(p.x - 0.9) < 0.05 && Math.abs(p.y - 0.1) < 0.05);
});

test('мала зміна пози голови після калібрування не дає стрибків', () => {
  const rnd = random(7);
  // Голова під час калібрування нерухома: yaw і pitch майже не змінюються.
  const samples = CALIBRATION_POINTS.flatMap(([x, y]) => Array.from({ length: 20 }, () => {
    const f = eyeLooking(x, y, 0.05, rnd);
    f[3] = rnd() * 0.002;
    f[4] = rnd() * 0.002;
    return { f, x, y };
  }));
  const model = fit(samples);
  const f = eyeLooking(0.5, 0.5, 0, rnd);
  f[3] = 0.02; // поворот на ~1°
  const p = predict(model, f);
  assert.ok(Math.abs(p.x - 0.5) < 0.2 && Math.abs(p.y - 0.5) < 0.2, `оцінка лишилась біля центру (${p.x.toFixed(2)}, ${p.y.toFixed(2)})`);
});

test('замало даних — помилка; пікселі → градуси', () => {
  assert.throws(() => fit([{ f: [0, 0, 0, 0, 0], x: 0, y: 0 }]));
  const deg = pixelsToDegrees(38);
  assert.ok(deg > 0.9 && deg < 1.0, `38 пікс. ≈ 1 см ≈ 0,95° на відстані 60 см (${deg.toFixed(2)})`);
});

test('фільтр One Euro згладжує тремтіння і не відстає на стрибку', () => {
  const f = new OneEuroFilter();
  const rnd = random(5);
  let t = 0;
  const raw = [];
  const smooth = [];
  for (let i = 0; i < 60; i++) {
    t += 33;
    const v = 0.5 + rnd() * 0.02;
    raw.push(v);
    smooth.push(f.filter(v, t));
  }
  const spread = (a) => Math.max(...a.slice(20)) - Math.min(...a.slice(20));
  assert.ok(spread(smooth) < spread(raw) / 2, 'тремтіння зменшилось більш ніж удвічі');
  let after;
  for (let i = 0; i < 10; i++) {
    t += 33;
    after = f.filter(0.9, t);
  }
  assert.ok(after > 0.85, `після стрибку за ~0,3 с значення наздогнало (${after.toFixed(3)})`);
});

test('очі: ціль — кнопка, на якій погляд був найдовше за вікно (короткі вискоки ігноруються)', () => {
  const frames = (seq) => seq.map((target) => ({ target, ms: 33 }));
  assert.equal(dominantTarget(frames(['піца', 'піца', 'бургер', 'піца', 'піца', null, 'піца'])), 'піца');
  assert.equal(dominantTarget(frames([null, null, null, 'піца'])), null);
  assert.equal(dominantTarget(frames(['піца', 'бургер', 'бургер', 'бургер'])), 'бургер');
});

test('медіанний фільтр повністю прибирає поодинокий викид', () => {
  const m = new MedianFilter(5);
  const out = [0.4, 0.4, 0.4, 0.7, 0.4, 0.4, 0.41].map((v) => m.filter(v));
  assert.ok(out.every((v) => v < 0.45), out.join(', '));
});

test('викиди однієї точки відкидаються (кліпання, погляд убік)', () => {
  const good = Array.from({ length: 20 }, (_, i) => [0.5 + (i % 3) * 0.002, 0.01 + (i % 2) * 0.001, 0.3, 0, 0]);
  const bad = [[0.7, 0.08, 0.1, 0, 0], [0.3, -0.06, 0.3, 0, 0]];
  const kept = dropOutliers([...good, ...bad]);
  assert.equal(kept.length, 20);
  assert.ok(kept.every((f) => Math.abs(f[0] - 0.5) < 0.01));
});
