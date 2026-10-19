import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';

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

test('меню: 6 категорій, 20 страв з інгредієнтами', async () => {
  const { data } = await api('GET', '/api/menu');
  assert.equal(data.categories.length, 6);
  assert.equal(data.dishes.length, 20);
  assert.ok(data.dishes.every((d) => d.price > 0 && d.ingredients.length && d.model));
});

test('замовлення: суму рахує сервер за цінами з бази', async () => {
  const { data: menu } = await api('GET', '/api/menu');
  const margarita = menu.dishes.find((d) => d.name === 'Маргарита');
  const borsch = menu.dishes.find((d) => d.name === 'Борщ');
  const res = await api('POST', '/api/orders', {
    items: [{ dishId: margarita.id, qty: 2, price: 1 }, { dishId: borsch.id, qty: 1 }, { dishId: margarita.id, qty: 1 }],
    method: 'gaze', total: 3,
  });
  assert.equal(res.status, 201);
  assert.equal(res.data.row.total, 3 * 189 + 119, 'ціни з бази, однакові позиції об’єднано');
  assert.equal(res.data.row.items.length, 2);
  assert.equal(res.data.row.method, 'gaze');
  assert.equal((await api('GET', '/api/orders')).data.rows.length, 1);
});

test('помилки замовлення', async () => {
  assert.equal((await api('POST', '/api/orders', { items: [] })).status, 400);
  assert.equal((await api('POST', '/api/orders', { items: [{ dishId: 999, qty: 1 }] })).status, 400);
  assert.equal((await api('POST', '/api/orders', { items: [{ dishId: 1, qty: 0 }] })).status, 400);
  assert.equal((await api('POST', '/api/orders', { items: [{ dishId: 1, qty: 1.5 }] })).status, 400);
  assert.equal((await api('POST', '/api/orders', { items: [{ dishId: 1, qty: 15 }, { dishId: 1, qty: 15 }] })).status, 400);
  assert.equal((await api('POST', '/api/orders', '{не json')).status, 400);
});

test('three.js та MediaPipe роздаються локально', async () => {
  for (const url of ['/vendor/three/build/three.module.js', '/vendor/mediapipe/vision_bundle.mjs', '/models/gesture_recognizer.task']) {
    assert.equal((await fetch(base + url, { method: 'HEAD' })).status, 200, url);
  }
});
