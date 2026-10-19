// Браузерні перевірки лабораторної №3 (Chrome без вікна й без звуку). Запуск: npm run test:e2e
// Скрипт сам запускає сервер з тимчасовою базою, керує симулятором через режим ?test і все прибирає.
// Шлях до Chrome можна задати змінною CHROME_PATH.
import { spawn } from 'node:child_process';
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 3240 + Math.floor(Math.random() * 50);
const APP = `http://localhost:${PORT}/`;
const WORK = mkdtempSync(path.join(tmpdir(), 'ar-e2e-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, details = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${details ? `\n      ${details}` : ''}`); };

const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], {
  cwd: PROJECT, env: { ...process.env, PORT: String(PORT), DB_FILE: path.join(WORK, 'test.db') }, stdio: 'ignore',
});
const chrome = spawn(CHROME, ['--headless=new', '--mute-audio', '--remote-debugging-port=9361', `--user-data-dir=${path.join(WORK, 'profile')}`, '--enable-unsafe-swiftshader', 'about:blank']);
process.on('exit', () => {
  chrome.kill();
  server.kill();
  try { rmSync(WORK, { recursive: true, force: true }); } catch { /* файли ще зайняті */ }
});
for (let i = 0; i < 50; i++) { try { await fetch(`${APP}api/measurements`); break; } catch { await sleep(200); } }

let pages;
for (let i = 0; i < 50; i++) { try { pages = await (await fetch('http://127.0.0.1:9361/json/list')).json(); if (pages.find((p) => p.type === 'page')) break; } catch {} await sleep(200); }
const ws = new WebSocket(pages.find((p) => p.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const waiting = new Map(); const errors = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
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

// Допоміжні дії в симуляторі.
const A = (code) => ev(`(() => { const a = window.__ar, sim = a.sim, m = a.measurement; ${code} })()`);
const text = (id) => ev(`document.getElementById('${id}').textContent`);
// «Оглянути» точки: подивитися на кожну, даючи трекінгу час знайти й розширити поверхню.
const survey = (pointsJs, seconds = 2.5) => A(`for (const p of ${pointsJs}) { sim.lookAt(p); sim.advance(${seconds}); }`);
const measure = (pointsJs) => A(`for (const p of ${pointsJs}) { sim.lookAt(p); a.addAtCenter(); } return m.summary();`);
const reset = () => A(`m.clear(); m.history.length = 0; sim.resetTracking(); sim.setLighting('normal'); sim.setNoise(false);`);

check('сторінка запускається, симулятор і тестовий доступ готові', (await ev(`typeof window.__ar`)) === 'object');

// 1. До знаходження поверхонь точку поставити не можна.
await A(`sim.setNoise(false); sim.setPose({ x: -1, y: 1.4, z: 0.4 }); sim.lookAt({ x: -1, y: 1, z: -2 }); a.addAtCenter();`);
check('без знайденої поверхні точка не ставиться', (await A(`return m.points.length`)) === 0 && /ще не знайдено/.test(await text('notice')), await text('notice'));

// 2. Трекінг знаходить стіну, поки на неї дивишся.
await A(`sim.advance(0.5)`);
const early = await A(`return sim.detectedSurfaces()`);
await A(`sim.advance(2)`);
const later = await A(`return sim.detectedSurfaces()`);
check('поверхня знаходиться не миттєво, а за ~1–2 с огляду', early.length === 0 && later.includes('стіна з дверима'), `через 0,5 с: [${early}], через 2,5 с: [${later}]`);

// 3. Висота дверей (еталон 210 см), без похибки трекінгу.
const DOOR = `[{ x: -1, y: 0.002, z: -2 }, { x: -1, y: 2.1, z: -2 }]`;
await survey(DOOR);
const door = await measure(DOOR);
check('висота дверей: 210 см ± 0,5 см', Math.abs(door.total - 2.1) < 0.005, `виміряно ${(door.total * 100).toFixed(1)} см; рядок результату: «${await text('result')}»`);

// 4. Точність з похибкою трекінгу: 10 вимірів дверей при нормальному і тьмяному освітленні.
for (const lighting of ['normal', 'dim']) {
  const acc = await A(`
    sim.setLighting('${lighting}'); sim.setNoise(true);
    const out = [];
    for (let i = 0; i < 10; i++) {
      m.clear();
      for (const p of ${DOOR}) { sim.lookAt(p); a.addAtCenter(); }
      out.push(100 - Math.abs(m.summary().total - 2.1) / 2.1 * 100);
    }
    sim.setNoise(false); sim.setLighting('normal');
    return { mean: out.reduce((s, v) => s + v, 0) / out.length, min: Math.min(...out) };`);
  check(`точність вимірювання з похибкою трекінгу (${lighting === 'normal' ? 'нормальне' : 'тьмяне'} світло) > 90 %`, acc.min > 90,
    `середня ${acc.mean.toFixed(2)} %, мінімальна ${acc.min.toFixed(2)} %`);
}

// 5. Стільниця: замкнений контур, площа 1,2 × 0,7 = 0,84 м².
await reset();
await A(`sim.setPose({ x: 1.2, y: 1.6, z: 0.3 })`);
const TABLE = `[{ x: 0.601, y: 0.75, z: -1.249 }, { x: 1.799, y: 0.75, z: -1.249 }, { x: 1.799, y: 0.75, z: -0.551 }, { x: 0.601, y: 0.75, z: -0.551 }]`;
await survey(`[{ x: 1.2, y: 0.75, z: -0.9 }, ...${TABLE}]`, 2);
await measure(TABLE);
await A(`m.setClosed(true)`);
const table = await A(`return m.summary()`);
check('стільниця: периметр 380 см і площа 0,84 м²', Math.abs(table.total - 3.8) < 0.01 && Math.abs(table.area - 0.84) < 0.005,
  `периметр ${(table.total * 100).toFixed(1)} см, площа ${table.area?.toFixed(3)} м²; «${await text('result')} ${await text('result-extra')}»`);
check('площа показується в результаті', /площа 0,8[34] м²/.test(await text('result-extra')), await text('result-extra'));

// 6. Стеля не розпізнається, у темряві трекінг зупиняється.
await A(`sim.setPose({ x: 0, y: 1.5, z: 0 }); sim.lookAt({ x: 0, y: 2.7, z: -0.5 }); sim.advance(4)`);
const ceiling = await A(`return sim.hitTest(0, 0)`);
check('однотонна стеля не розпізнається', !ceiling.ok && /не розпізнано/.test(ceiling.reason), ceiling.reason);
await A(`sim.resetTracking(); sim.setLighting('dark'); sim.lookAt({ x: 0, y: 0, z: 1 }); sim.advance(4)`);
const dark = await A(`return { hit: sim.hitTest(0, 0), floor: sim.detectedSurfaces().includes('підлога') }`);
check('у темряві трекінг призупиняється й нові поверхні не знаходяться', !dark.hit.ok && /Замало світла/.test(dark.hit.reason) && !dark.floor, dark.hit.reason);
await A(`sim.setLighting('normal')`);

// 7. Клік мишею по поверхні ставить точку саме там, де клікнули.
await reset();
await A(`sim.setPose({ x: 0, y: 1.6, z: 0.5 }); sim.lookAt({ x: 0, y: 0, z: -0.6 }); sim.advance(3); sim.lookAt({ x: 0.4, y: 0, z: -0.8 }); sim.advance(2); sim.lookAt({ x: 0, y: 0, z: -0.6 })`);
await sleep(300);
const box = await ev(`(() => { const r = document.getElementById('view').getBoundingClientRect(); return { x: r.left + r.width * 0.6, y: r.top + r.height * 0.55 }; })()`);
for (const type of ['mousePressed', 'mouseReleased']) await cdp('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
await sleep(300);
const clicked = await A(`return { n: m.points.length, p: m.points[0], expected: sim.hitTest(0.2, -0.1, { noise: false }) }`);
check('клік по підлозі ставить точку в місці кліку', clicked.n === 1 && Math.abs(clicked.p.y) < 0.001 && Math.hypot(clicked.p.x - clicked.expected.point.x, clicked.p.z - clicked.expected.point.z) < 0.01,
  `точка (${clicked.p?.x.toFixed(2)}, ${clicked.p?.y.toFixed(3)}, ${clicked.p?.z.toFixed(2)})`);

// 8. Меню редагування: порядок, видалення, скасування.
await reset();
await A(`sim.setPose({ x: 0, y: 1.6, z: 0.5 }); sim.lookAt({ x: 0, y: 0, z: -0.6 }); sim.advance(3);
  for (const p of [{ x: -0.3, y: 0, z: -0.3 }, { x: 0.3, y: 0, z: -0.3 }, { x: 0.3, y: 0, z: -0.9 }]) { sim.lookAt(p); sim.advance(1); }
  for (const p of [{ x: -0.3, y: 0, z: -0.3 }, { x: 0.3, y: 0, z: -0.3 }, { x: 0.3, y: 0, z: -0.9 }]) { sim.lookAt(p); a.addAtCenter(); }`);
const before = await text('result');
await ev(`document.querySelector('#point-strip li:nth-child(3) button').click()`);
await ev(`document.getElementById('btn-edit').click()`);
await ev(`document.querySelector('[data-cmd="up"]').click()`);
const reordered = await text('result');
await ev(`document.querySelector('[data-cmd="delete"]').click()`);
const deleted = await A(`return m.points.length`);
await ev(`document.querySelector('[data-cmd="undo"]').click()`);
const undone = await A(`return m.points.length`);
check('меню: зміна порядку точок, видалення, скасування', before === '60,0 + 60,0 = 120,0 см' && reordered !== before && deleted === 2 && undone === 3,
  `до: «${before}», після «раніше»: «${reordered}», після видалення: ${deleted} точки, після скасування: ${undone}`);
await ev(`document.querySelector('[data-unit="m"]').click()`);
check('перемикання одиниць: метри', (await text('result')).endsWith(' м'), await text('result'));
await ev(`document.querySelector('[data-unit="cm"]').click()`);

// 9. Збереження в базу та відкриття збереженого.
await A(`m.undo();`); // повернути початковий порядок точок
await ev(`document.getElementById('btn-edit').click()`);
await ev(`document.querySelector('[data-cmd="save"]').click()`);
await ev(`document.getElementById('save-name').value = 'Підлога біля столу'; document.getElementById('save-form').requestSubmit()`);
await sleep(500);
const saved = await ev(`fetch('/api/measurements').then((r) => r.json()).then((j) => j.rows[0])`);
check('вимір зберігається в базі', saved?.name === 'Підлога біля столу' && saved.points.length === 3 && Math.abs(saved.total_m - 1.2) < 0.001, JSON.stringify({ name: saved?.name, total_m: saved?.total_m }));
await A(`m.clear()`);
await ev(`document.getElementById('btn-saved').click()`);
await sleep(500);
await ev(`[...document.querySelectorAll('#saved-list .link')].find((b) => b.textContent === 'показати').click()`);
check('збережений вимір відкривається з бази', (await A(`return m.points.length`)) === 3 && (await text('result')) === '60,0 + 60,0 = 120,0 см', await text('result'));

// 10. Перевірка точності за еталоном.
await reset();
await survey(DOOR);
await measure(DOOR);
await ev(`document.getElementById('btn-edit').click(); document.querySelector('[data-cmd="accuracy"]').click()`);
await ev(`const s = document.getElementById('acc-ref'); s.value = 'door-h'; s.dispatchEvent(new Event('change'))`);
await ev(`document.getElementById('acc-record').click()`);
const accuracy = await text('acc-percent');
check('діалог точності порівнює з еталоном', /^(99|100),\d %$/.test(accuracy) && (await ev(`document.querySelectorAll('#acc-log tr').length`)) === 1, `точність ${accuracy}, похибка ${await text('acc-error')}`);
await ev(`document.querySelector('#accuracy-modal [data-close]').click()`);

// 11. Прилипання точок.
await reset();
await A(`sim.setPose({ x: 0, y: 1.6, z: 0.6 }); sim.lookAt({ x: 0, y: 0, z: -0.5 }); sim.advance(3);
  const R = [{ x: -0.4, y: 0, z: -0.2 }, { x: 0.4, y: 0, z: -0.2 }, { x: 0.4, y: 0, z: -0.9 }, { x: -0.4, y: 0, z: -0.9 }];
  for (const p of R) { sim.lookAt(p); sim.advance(1); }
  for (const p of R.slice(0, 3)) { sim.lookAt(p); a.addAtCenter(); }`);
await A(`sim.lookAt({ x: 0.43, y: 0, z: -0.88 }); a.addAtCenter();`);
check('біля останньої точки нова не ставиться', (await A(`return m.points.length`)) === 3 && /остання точка/.test(await text('notice')), await text('notice'));

await A(`sim.lookAt({ x: -0.37, y: 0, z: -0.23 })`);
await sleep(300); // кадр, щоб оновились приціл і підказка
const nearFirst = { hint: await text('hint'), orange: await A(`return sim.reticle.children[0].material.color.getHex() === 0xff8a00`) };
await A(`a.addAtCenter()`);
const closedState = await A(`return { n: m.points.length, closed: m.closed, area: m.summary().area }`);
check('біля першої точки приціл стає помаранчевим, а точка замикає контур', nearFirst.orange && /замкнути контур/.test(nearFirst.hint) && closedState.n === 3 && closedState.closed && Math.abs(closedState.area - 0.28) < 1e-6,
  `підказка: «${nearFirst.hint}»; точок ${closedState.n}, площа ${closedState.area?.toFixed(3)} м²`);

await A(`m.setClosed(false); sim.lookAt({ x: 0.43, y: 0, z: -0.17 }); a.addAtCenter();`);
const joined = await A(`const [, b] = m.points; const last = m.points.at(-1); return { n: m.points.length, same: b.x === last.x && b.y === last.y && b.z === last.z }`);
check('біля проміжної точки нова точка ставиться точно в неї', joined.n === 4 && joined.same, `точок ${joined.n}, збіг координат: ${joined.same}`);

await ev(`document.getElementById('opt-snap').click()`);
await A(`sim.lookAt({ x: -0.37, y: 0, z: -0.23 }); a.addAtCenter();`);
const free = await A(`return { n: m.points.length, closed: m.closed }`);
await ev(`document.getElementById('opt-snap').click()`);
check('з вимкненим прилипанням точка ставиться там, де приціл', free.n === 5 && !free.closed, `точок ${free.n}`);

// 12. Видалити останню точку: клавіша Backspace і кнопка.
await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
const afterKey = await A(`return m.points.length`);
await ev(`document.getElementById('btn-delete-last').click()`);
const afterButton = await A(`return m.points.length`);
check('Backspace і кнопка видаляють останню точку', afterKey === 4 && afterButton === 3, `після Backspace: ${afterKey}, після кнопки: ${afterButton}`);

// 13. Після очищення прев'ю-лінія зникає, навіть якщо приціл не на поверхні.
await A(`sim.lookAt({ x: 0.2, y: 0, z: -0.4 })`);
await sleep(300);
const previewBefore = await A(`return a.layer.preview.children.length`);
await A(`sim.lookAt({ x: 0, y: 2.7, z: -0.5 }); m.clear();`); // стеля — hit-test не проходить
await sleep(300);
const previewAfter = await A(`return a.layer.preview.children.length`);
check('після очищення прев’ю-лінія зникає', previewBefore > 0 && previewAfter === 0, `до: ${previewBefore} об’єкти, після: ${previewAfter}`);

check('без помилок у консолі', errors.length === 0, errors.join(' | '));
ws.close();
process.exit(results.every(Boolean) ? 0 : 1);
