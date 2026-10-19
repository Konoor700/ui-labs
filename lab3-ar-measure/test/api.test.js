import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';
import { validateMeasurement } from '../src/validation.js';

let server;
let base;
const api = async (method, path, body) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
};
const door = { name: 'Висота дверей', points: [{ x: -1, y: 0, z: -2 }, { x: -1, y: 2.1, z: -2 }], closed: false, source: 'sim' };

before(async () => {
  server = createApp(openDatabase(':memory:')).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('валідація виміру: довжину й площу рахує сервер', () => {
  const ok = validateMeasurement({ ...door, total: 999 });
  assert.ok(ok.ok);
  assert.ok(Math.abs(ok.value.total - 2.1) < 1e-9, 'клієнтське значення total ігнорується');
  assert.equal(ok.value.area, null);

  const square = validateMeasurement({ name: 'Стільниця', closed: true, source: 'sim', points: [{ x: 0, y: 0.75, z: 0 }, { x: 1.2, y: 0.75, z: 0 }, { x: 1.2, y: 0.75, z: 0.7 }, { x: 0, y: 0.75, z: 0.7 }] });
  assert.ok(Math.abs(square.value.area - 0.84) < 1e-9);

  assert.ok(validateMeasurement({ ...door, name: '' }).errors.name);
  assert.ok(validateMeasurement({ ...door, points: [door.points[0]] }).errors.points);
  assert.ok(validateMeasurement({ ...door, points: [{ x: 0, y: 0, z: 0 }, { x: 'a', y: 0, z: 0 }] }).errors.points);
  assert.ok(validateMeasurement({ ...door, closed: true }).errors.closed);
  assert.ok(validateMeasurement({ ...door, source: 'hack' }).errors.source);
});

test('збереження, список, читання, видалення', async () => {
  const created = await api('POST', '/api/measurements', door);
  assert.equal(created.status, 201);
  const { id } = created.data.row;
  assert.equal(created.data.row.closed, false);
  assert.deepEqual(created.data.row.points, door.points);

  const list = await api('GET', '/api/measurements');
  assert.equal(list.data.rows.length, 1);
  assert.equal((await api('GET', `/api/measurements/${id}`)).data.row.name, 'Висота дверей');

  assert.equal((await api('DELETE', `/api/measurements/${id}`)).status, 200);
  assert.equal((await api('GET', `/api/measurements/${id}`)).status, 404);
});

test('помилки API', async () => {
  const bad = await api('POST', '/api/measurements', { name: '', points: [], source: 'x' });
  assert.equal(bad.status, 400);
  assert.deepEqual(Object.keys(bad.data.errors).sort(), ['name', 'points', 'source']);
  assert.equal((await api('DELETE', '/api/measurements/999')).status, 404);
  assert.equal((await api('GET', '/api/measurements/abc')).status, 404);
  assert.equal((await api('POST', '/api/measurements', '{не json')).status, 400);
});

test('three.js роздається локально', async () => {
  const res = await fetch(`${base}/vendor/three/build/three.module.js`, { method: 'HEAD' });
  assert.equal(res.status, 200);
});
