import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';
import { validateEmployee } from '../src/validation.js';

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

before(async () => {
  server = createApp(openDatabase(':memory:')).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('валідація даних працівника', () => {
  assert.deepEqual(validateEmployee({ name: '  Іван   Іванов ', position: 'Менеджер', salary: 30000 }), {
    ok: true, value: { name: 'Іван Іванов', position: 'Менеджер', salary: 30000 },
  });
  assert.ok(validateEmployee({ name: 'Іван', position: 'Менеджер', salary: 1 }).errors.name, 'потрібні ім’я та прізвище');
  assert.ok(validateEmployee({ name: 'Robert; DROP TABLE', position: 'x', salary: 1 }).errors.name);
  assert.ok(validateEmployee({ name: 'Іван Іванов', position: 'М', salary: 1 }).errors.position);
  assert.ok(validateEmployee({ name: 'Іван Іванов', position: 'Менеджер', salary: -5 }).errors.salary);
  assert.ok(validateEmployee({ name: 'Іван Іванов', position: 'Менеджер', salary: 1.5 }).errors.salary);
});

test('CRUD через REST API', async () => {
  const list = await api('GET', '/api/employees');
  assert.equal(list.data.rows.length, 7);
  assert.ok(list.data.positions.includes('Розробник'));

  const created = await api('POST', '/api/employees', { name: 'Іван Іванов', position: 'Менеджер', salary: 31000 });
  assert.equal(created.status, 201);
  const { id } = created.data.row;

  const updated = await api('PUT', `/api/employees/${id}`, { name: 'Іван Іванов', position: 'Старший менеджер', salary: 36000 });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.row.position, 'Старший менеджер');

  const removed = await api('DELETE', `/api/employees/${id}`);
  assert.equal(removed.status, 200);
  assert.equal((await api('GET', '/api/employees')).data.rows.length, 7);
});

test('помилки API: некоректні дані, неіснуючий запис, поганий JSON', async () => {
  const bad = await api('POST', '/api/employees', { name: 'А', position: '', salary: 'багато' });
  assert.equal(bad.status, 400);
  assert.deepEqual(Object.keys(bad.data.errors).sort(), ['name', 'position', 'salary']);

  assert.equal((await api('PUT', '/api/employees/999', { name: 'Іван Іванов', position: 'Менеджер', salary: 1 })).status, 404);
  assert.equal((await api('DELETE', '/api/employees/999')).status, 404);
  assert.equal((await api('DELETE', '/api/employees/abc')).status, 400);
  assert.equal((await api('POST', '/api/employees', '{не json')).status, 400);
});

test('локальна копія MediaPipe та модель роздаються сервером', async () => {
  const bundle = await fetch(`${base}/vendor/mediapipe/vision_bundle.mjs`);
  assert.equal(bundle.status, 200);
  const wasm = await fetch(`${base}/vendor/mediapipe/wasm/vision_wasm_internal.wasm`, { method: 'HEAD' });
  assert.equal(wasm.status, 200);
  const model = await fetch(`${base}/models/gesture_recognizer.task`, { method: 'HEAD' });
  assert.equal(model.status, 200);
});
