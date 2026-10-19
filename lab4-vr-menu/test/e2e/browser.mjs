// Браузерні перевірки лабораторної №4 (Chrome без вікна й без звуку). Запуск: npm run test:e2e
// Скрипт сам запускає сервер з тимчасовою базою і керує сторінкою (режим ?test): справжні кліки миші,
// погляд (поворот «голови»), події жестів руки, голосові команди (текстом).
import { spawn } from 'node:child_process';
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 3290 + Math.floor(Math.random() * 50);
const APP = `http://localhost:${PORT}/`;
const WORK = mkdtempSync(path.join(tmpdir(), 'vr-e2e-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, details = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${details ? `\n      ${details}` : ''}`); };

const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], {
  cwd: PROJECT, env: { ...process.env, PORT: String(PORT), DB_FILE: path.join(WORK, 'test.db') }, stdio: 'ignore',
});
const chrome = spawn(CHROME, ['--headless=new', '--mute-audio', '--remote-debugging-port=9371', `--user-data-dir=${path.join(WORK, 'profile')}`, '--enable-unsafe-swiftshader', 'about:blank']);
process.on('exit', () => {
  chrome.kill();
  server.kill();
  try { rmSync(WORK, { recursive: true, force: true }); } catch { /* файли ще зайняті */ }
});
for (let i = 0; i < 50; i++) { try { await fetch(`${APP}api/menu`); break; } catch { await sleep(200); } }
let pages;
for (let i = 0; i < 50; i++) { try { pages = await (await fetch('http://127.0.0.1:9371/json/list')).json(); if (pages.find((p) => p.type === 'page')) break; } catch {} await sleep(200); }
const ws = new WebSocket(pages.find((p) => p.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const waiting = new Map(); const errors = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error' && !String(m.params.args[0]?.value).startsWith('INFO:')) errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
  waiting.get(m.id)?.(m); waiting.delete(m.id);
});
const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => {
  const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
  return r.result.result.value;
};
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
await cdp('Page.navigate', { url: `${APP}?test` });
await sleep(2500);

const V = (code) => ev(`(() => { const v = window.__vr, m = v.model; ${code} })()`);
const page = () => V(`return m.page`);
const frame = () => sleep(120);
// Справжній клік миші в центр кнопки.
async function click(buttonId) {
  const p = await V(`return v.buttonScreen(${JSON.stringify(buttonId)})`);
  if (!p) return false;
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
  await frame();
  for (const type of ['mousePressed', 'mouseReleased']) await cdp('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await frame();
  return true;
}
async function mouseAway() {
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 880 });
}
const dishId = (name) => V(`return m.dishes.find((d) => d.name === ${JSON.stringify(name)}).id`);

check('сторінка запускається, меню завантажено з сервера', (await V(`return m.dishes.length`)) === 20 && (await V(`return m.categories.length`)) === 6);

// 1. Промінь (миша): справжні кліки.
await V(`v.act('open', null, 'mouse')`);
await frame();
await click('cat-pizza');
const afterCat = await page();
await click('next');
const pageIdx = await V(`return m.pageIndex`);
await click('prev');
await click('dish-' + (await dishId('Пепероні')));
check('промінь (миша): клік відкриває категорію, гортає сторінки, відкриває страву',
  afterCat === 'category' && pageIdx === 1 && (await page()) === 'dish' && (await V(`return m.dish().name`)) === 'Пепероні');
await click('plus');
await click('add');
check('кнопки «+» і «Додати» додають у замовлення', (await V(`return m.cartCount()`)) === 2, `у замовленні ${await V(`return m.cartCount()`)} порції`);
await mouseAway();

// 2. Погляд: затримка ~1 с.
await V(`v.act('home', null, 'mouse')`);
await frame();
await V(`v.lookAtButton('cat-drinks')`);
await sleep(600);
const midDwell = await page();
await sleep(900);
check('погляд: через ~1 с затримки на кнопці — вибір', midDwell === 'home' && (await page()) === 'category' && (await V(`return m.categoryId`)) === 'drinks', `через 0,6 с: ${midDwell}, через 1,5 с: ${await page()}`);
// Нова сторінка: погляд уже «стоїть» на кнопці — без свідомого наведення вона не спрацює.
const under = await V(`return v.manager.pointers.get('gaze').hit?.object.userData.id ?? null`);
await sleep(1500);
check('після зміни сторінки кнопка під поглядом не спрацьовує сама', (await page()) === 'category', `під поглядом: ${under}`);
await V(`v.act('setting', ['gaze', false], 'mouse'); v.act('home', null, 'mouse')`);
await frame();
await V(`v.lookAtButton('cat-soups')`);
await sleep(1600);
check('вимкнений погляд нічого не обирає', (await page()) === 'home');
await V(`v.act('setting', ['gaze', true], 'mouse')`);

// 3. Рука (вебкамера): курсор + щипок, мах — гортання.
const toNdc = async (bid) => V(`const p = v.buttonScreen(${JSON.stringify(bid)}); const r = document.getElementById('view').getBoundingClientRect(); return { x: ((p.x - r.left) / r.width) * 2 - 1, y: -(((p.y - r.top) / r.height) * 2 - 1) }`);
await V(`v.desktop.lookAt(v.view.root.position.clone().add({ x: 0, y: 0.6, z: 0 }))`); // погляд убік від кнопок
const pizzaNdc = await toNdc('cat-pizza');
await V(`v.handleHand({ type: 'cursor', x: ${pizzaNdc.x}, y: ${pizzaNdc.y} }); v.handleHand({ type: 'pinch' })`);
await frame();
const handCat = await V(`return m.categoryId`);
await V(`v.handleHand({ type: 'swipe', dir: 'left' })`);
const handPage = await V(`return m.pageIndex`);
await V(`v.handleHand({ type: 'swipe', dir: 'right' })`);
check('рука: щипок обирає пункт під курсором, мах гортає сторінки', handCat === 'pizza' && handPage === 1 && (await V(`return m.pageIndex`)) === 0, `категорія ${handCat}, сторінка після маху ${handPage}`);
await V(`v.handleHand({ type: 'lost' })`);

// 4. Голос: повний сценарій замовлення.
await V(`m.clearCart(); v.act('home', null, 'mouse')`);
const say = (t) => V(`return v.handleVoice(${JSON.stringify(t)}).type`);
const heard = [];
for (const t of ['Напої', 'Капучино', 'плюс', 'плюс', 'додай в замовлення', 'борщ', 'додай', 'моє замовлення']) heard.push(await say(t));
const cart = await V(`return { count: m.cartCount(), total: m.cartTotal(), page: m.page }`);
check('голос: категорія → страва → кількість → додати → замовлення', cart.count === 4 && cart.total === 3 * 59 + 119 && cart.page === 'order', `${heard.join(', ')} → ${JSON.stringify(cart)}`);

// 5. Оформлення лише з підтвердженням.
await say('оформити');
const confirmPage = await page();
await say('ні');
const afterNo = await page();
const ordersBefore = (await ev(`fetch('/api/orders').then((r) => r.json())`)).rows.length;
await say('оформити');
await say('так');
await sleep(500);
const orders = (await ev(`fetch('/api/orders').then((r) => r.json())`)).rows;
check('оформлення: спершу підтвердження; «ні» скасовує, «так» зберігає в базі', confirmPage === 'confirm' && afterNo === 'order' && ordersBefore === 0 && orders.length === 1 && orders[0].total === 296 && orders[0].method === 'voice',
  `замовлення: ${JSON.stringify(orders[0] && { total: orders[0].total, method: orders[0].method, items: orders[0].items.length })}`);
check('після оформлення замовлення очищено, меню на головній', (await V(`return m.cartCount()`)) === 0 && (await page()) === 'home');
check('незрозуміла голосова команда не виконується', (await say('яка погода')) === 'unknown' && (await page()) === 'home');

// 6. Оформлення кліком: «Так» через промінь.
await V(`m.openDish(m.dishes[0].id); m.addToCart(); v.act('checkout', null, 'mouse'); v.desktop.lookAt(v.view.root.position)`);
await frame();
await click('yes');
await sleep(500);
const last = (await ev(`fetch('/api/orders').then((r) => r.json())`)).rows[0];
check('підтвердження променем (кнопка «Так»)', last.method === 'mouse' && last.total === 189, `метод: ${last.method}, сума ${last.total}`);
await mouseAway();

// 7. Налаштування.
await V(`v.act('settings', null, 'mouse'); v.desktop.lookAt(v.view.root.position)`);
await frame();
await click('set-distance-plus');
await click('set-brightness-minus');
const settings = await V(`return m.settings`);
check('налаштування: відстань меню і яскравість', Math.abs(settings.distance - 1.1) < 1e-9 && Math.abs(settings.brightness - 0.8) < 1e-9, JSON.stringify(settings));
await mouseAway();

// 8. Меню слідує за поглядом.
await V(`v.act('home', null, 'mouse')`);
await sleep(300);
const before = await V(`return v.view.root.position.toArray()`);
await V(`v.desktop.yaw += Math.PI / 2; v.desktop.apply()`);
await sleep(1500);
const after = await V(`return v.view.root.position.toArray()`);
const headDir = await V(`const d = new v.view.root.position.constructor(0, 0, -1).applyQuaternion(v.desktop.camera.quaternion); return [d.x, d.z]`);
const toMenu = [after[0], after[2] + 0].map((x, i) => x - [0, 0][i]);
check('меню переміщується за поглядом, якщо відвернутись', Math.hypot(after[0] - before[0], after[2] - before[2]) > 0.8 && Math.sign(toMenu[0]) === Math.sign(headDir[0]), `було (${before.map((x) => x.toFixed(2))}), стало (${after.map((x) => x.toFixed(2))})`);

// 9. Перевірка точності (промінь): 5 спроб, одна навмисна помилка → 80 %.
await V(`document.getElementById('acc-method').value = 'mouse'; document.getElementById('acc-trials').value = '5'; document.getElementById('acc-start').click(); v.desktop.lookAt(v.accuracy.group.position)`);
for (let i = 0; i < 5; i++) {
  let target = null;
  for (let k = 0; k < 40 && !target; k++) { target = await V(`return v.accuracy.current?.target ?? null`); if (!target) await sleep(100); }
  const pick = i === 2 ? (target % 9) + 1 : target; // третя спроба — навмисно не та ціль
  await click(`target-${pick}`);
  await sleep(150);
}
await sleep(800);
const accText = await ev(`document.querySelector('#acc-log tr:last-child td:nth-child(6)')?.textContent`);
check('перевірка точності рахує влучання й помилки', accText === '80 %', `точність: ${accText}`);
await ev(`document.querySelector('#accuracy-modal [data-close]').click()`);

// 10. Затримка обробки взаємодії.
const stats = await V(`return v.manager.stats`);
check('обробка взаємодії за кадр < 20 мс', stats.avgMs < 20 && stats.maxMs < 20, `середня ${stats.avgMs.toFixed(3)} мс, максимум ${stats.maxMs.toFixed(2)} мс`);

check('без помилок у консолі', errors.length === 0, errors.join(' | '));
ws.close();
process.exit(results.every(Boolean) ? 0 : 1);
