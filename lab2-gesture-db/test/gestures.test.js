import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GestureEngine, detectPose, pinchRatio } from '../public/js/gestures.js';
import { hand, frames, commandsOf } from './hand.js';

test('пози руки визначаються за положенням пальців, якщо класифікатор не впевнений', () => {
  assert.equal(detectPose(hand({ pose: 'open' }), 'None', 0.9), 'open');
  assert.equal(detectPose(hand({ pose: 'fist' }), 'None', 0.9), 'fist');
  assert.equal(detectPose(hand({ pose: 'point' }), 'None', 0.9), 'point');
  assert.equal(detectPose(hand({ pose: 'fist' }), 'Thumb_Up', 0.9), 'thumb_up');
  assert.equal(detectPose(hand({ pose: 'open' }), 'Closed_Fist', 0.3), 'open', 'низька впевненість ігнорується');
  assert.ok(pinchRatio(hand({ pose: 'pinch' })) < 0.3);
  assert.ok(pinchRatio(hand({ pose: 'open' })) > 0.45);
});

test('✌️ утримання «перемоги» → «показати всіх», один раз за утримання', () => {
  const engine = new GestureEngine();
  const short = frames(engine, { from: 0, duration: 300, pose: 'open', category: 'Victory' });
  assert.deepEqual(commandsOf(short.events), [], 'коротко показаний жест не спрацьовує');
  frames(engine, { from: 400, duration: 500, pose: 'open' });

  const hold = frames(engine, { from: 1000, duration: 1500, pose: 'open', category: 'Victory' });
  assert.deepEqual(commandsOf(hold.events), ['select_all']);
  assert.ok(hold.events.some((e) => e.type === 'hold' && e.pose === 'victory' && e.progress > 0 && e.progress < 1));
});

test('утримання витримує короткі «провали» розпізнавання', () => {
  const engine = new GestureEngine();
  engine.setMode('form');
  const events = [];
  // 👍 з двома провалами по ~130 мс (класифікатор на мить повертає «None»)
  for (let t = 0; t <= 900; t += 33) {
    const glitch = (t > 200 && t < 330) || (t > 450 && t < 580);
    events.push(...engine.update({ t, landmarks: hand({ pose: 'fist' }), category: glitch ? 'None' : 'Thumb_Up', score: 0.9 }));
  }
  assert.equal(events.filter((e) => e.type === 'confirm').length, 1);

  const reset = new GestureEngine();
  reset.setMode('form');
  const long = [
    ...frames(reset, { from: 0, duration: 400, pose: 'fist', category: 'Thumb_Up' }).events,
    ...frames(reset, { from: 433, duration: 500, pose: 'open' }).events, // довга перерва — відлік скинуто
    ...frames(reset, { from: 966, duration: 300, pose: 'fist', category: 'Thumb_Up' }).events,
  ];
  assert.equal(long.filter((e) => e.type === 'confirm').length, 0);
});

test('мах угору тепер нічого не робить (щоб не спрацьовувало, коли піднімаєш руку)', () => {
  const engine = new GestureEngine();
  const { events } = frames(engine, { from: 0, duration: 300 }, (p) => ({ pose: 'open', y: 0.7 - 0.35 * p }));
  assert.deepEqual(commandsOf(events), []);
});

test('повільний рух руки вбік не вважається махом', () => {
  const engine = new GestureEngine();
  const { events } = frames(engine, { from: 0, duration: 2500 }, (p) => ({ pose: 'open', x: 0.7 - 0.4 * p }));
  assert.deepEqual(commandsOf(events), []);
});

test('👋 мах убік → «видалити» (в обидва боки, з урахуванням дзеркала)', () => {
  for (const [from, to] of [[0.7, 0.3], [0.3, 0.7]]) {
    const engine = new GestureEngine();
    const { events } = frames(engine, { from: 0, duration: 300 }, (p) => ({ pose: 'open', x: from + (to - from) * p }));
    assert.deepEqual(commandsOf(events), ['delete']);
  }
});

test('мах кулаком не спрацьовує — потрібна відкрита долоня', () => {
  const engine = new GestureEngine();
  const { events } = frames(engine, { from: 0, duration: 300 }, (p) => ({ pose: 'fist', x: 0.7 - 0.4 * p }));
  assert.deepEqual(commandsOf(events), []);
});

test('🔄 коло вказівним пальцем → «оновити»', () => {
  const engine = new GestureEngine();
  const { events } = frames(engine, { from: 0, duration: 1200 }, (p) => ({
    pose: 'point',
    x: 0.5 + 0.08 * Math.cos(2 * Math.PI * p),
    y: 0.5 + 0.08 * Math.sin(2 * Math.PI * p),
  }));
  assert.deepEqual(commandsOf(events), ['update']);
});

test('🔄 недбале коло теж рахується: овал на ¾ оберту, повільно, маленький радіус', () => {
  const engine = new GestureEngine();
  const { events } = frames(engine, { from: 0, duration: 2200 }, (p) => ({
    pose: 'point',
    x: 0.5 + 0.045 * Math.cos(1.6 * Math.PI * p),
    y: 0.5 + 0.03 * Math.sin(1.6 * Math.PI * p),
  }));
  assert.deepEqual(commandsOf(events), ['update']);
});

test('нерухомий палець, пів кола або рух по прямій — не коло', () => {
  const still = new GestureEngine();
  assert.deepEqual(commandsOf(frames(still, { from: 0, duration: 2000, pose: 'point' }).events), []);

  const half = new GestureEngine();
  const halfCircle = frames(half, { from: 0, duration: 800 }, (p) => ({
    pose: 'point', x: 0.5 + 0.08 * Math.cos(Math.PI * p), y: 0.5 + 0.08 * Math.sin(Math.PI * p),
  }));
  assert.deepEqual(commandsOf(halfCircle.events), []);

  const line = new GestureEngine();
  const back = frames(line, { from: 0, duration: 1500 }, (p) => ({ pose: 'point', x: 0.4 + 0.2 * Math.sin(2 * Math.PI * p) }));
  assert.deepEqual(commandsOf(back.events), []);
});

test('✊ → ☝ кулак, потім вказівний палець → «додати»', () => {
  const engine = new GestureEngine();
  const fist = frames(engine, { from: 0, duration: 400, pose: 'fist' });
  const point = frames(engine, { from: fist.end, duration: 500, pose: 'point' });
  assert.deepEqual(commandsOf([...fist.events, ...point.events]), ['add']);
});

test('вказівний палець без кулака або надто пізно після кулака — не «додати»', () => {
  const noFist = new GestureEngine();
  assert.deepEqual(commandsOf(frames(noFist, { from: 0, duration: 800, pose: 'point' }).events), []);

  const late = new GestureEngine();
  const fist = frames(late, { from: 0, duration: 400, pose: 'fist' });
  const pause = frames(late, { from: fist.end, duration: 2000, pose: 'open' });
  const point = frames(late, { from: pause.end, duration: 600, pose: 'point' });
  assert.deepEqual(commandsOf(point.events), []);
});

test('🤏 щипок дає клік (down/up) і не плутається з кулаком', () => {
  const engine = new GestureEngine();
  const seq = [
    ...frames(engine, { from: 0, duration: 200, pose: 'open' }).events,
    ...frames(engine, { from: 233, duration: 200, pose: 'pinch' }).events,
    ...frames(engine, { from: 466, duration: 200, pose: 'open' }).events,
  ];
  assert.deepEqual(seq.filter((e) => e.type === 'pinch').map((e) => e.phase), ['down', 'up']);

  const fistEngine = new GestureEngine();
  const fist = frames(fistEngine, { from: 0, duration: 500, pose: 'fist' });
  assert.equal(fist.events.filter((e) => e.type === 'pinch').length, 0);
});

test('курсор: центр долоні відображається на екран дзеркально', () => {
  const engine = new GestureEngine();
  const center = frames(engine, { from: 0, duration: 500, pose: 'open', x: 0.5, y: 0.42 }).events.filter((e) => e.type === 'cursor').at(-1);
  assert.ok(Math.abs(center.x - 0.5) < 0.02 && Math.abs(center.y - 0.5) < 0.02);
  const leftInCamera = frames(new GestureEngine(), { from: 0, duration: 500, pose: 'open', x: 0.25, y: 0.42 }).events.filter((e) => e.type === 'cursor').at(-1);
  assert.ok(leftInCamera.x > 0.8, 'ліва частина кадру — права частина екрана (дзеркало)');
});

test('режим форми: команди вимкнені, 👍/👎 з утриманням підтверджують і скасовують', () => {
  const engine = new GestureEngine();
  engine.setMode('form');
  const swipe = frames(engine, { from: 0, duration: 300 }, (p) => ({ pose: 'open', y: 0.7 - 0.35 * p }));
  assert.deepEqual(commandsOf(swipe.events), []);

  const short = frames(engine, { from: 1000, duration: 400, pose: 'fist', category: 'Thumb_Up' });
  assert.equal(short.events.filter((e) => e.type === 'confirm').length, 0, 'коротке утримання не рахується');
  frames(engine, { from: 1450, duration: 200, pose: 'open' });

  const hold = frames(engine, { from: 2000, duration: 1500, pose: 'fist', category: 'Thumb_Up' });
  assert.equal(hold.events.filter((e) => e.type === 'confirm').length, 1, 'одне підтвердження за утримання');
  assert.ok(hold.events.some((e) => e.type === 'hold' && e.progress > 0 && e.progress < 1), 'є прогрес утримання');

  const down = frames(engine, { from: 4000, duration: 900, pose: 'fist', category: 'Thumb_Down' });
  assert.equal(down.events.filter((e) => e.type === 'cancel').length, 1);
});

test('у командному режимі 👍 нічого не підтверджує; на паузі жести ігноруються', () => {
  const engine = new GestureEngine();
  const thumbs = frames(engine, { from: 0, duration: 1200, pose: 'fist', category: 'Thumb_Up' });
  assert.equal(thumbs.events.filter((e) => e.type === 'confirm').length, 0);

  const paused = new GestureEngine();
  paused.setMode('paused');
  const swipe = frames(paused, { from: 0, duration: 300 }, (p) => ({ pose: 'open', y: 0.7 - 0.35 * p }));
  assert.deepEqual(swipe.events.filter((e) => !['hand', 'pose'].includes(e.type)), []);
});

test('рука зникла під час щипка — клік відпускається', () => {
  const engine = new GestureEngine();
  frames(engine, { from: 0, duration: 200, pose: 'pinch' });
  const events = engine.update({ t: 300, landmarks: null });
  assert.deepEqual(events, [{ type: 'hand', present: false }, { type: 'pinch', phase: 'up' }]);
});
