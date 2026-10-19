// Браузерні перевірки відстеження очей (Chrome без вікна й без звуку). Запуск: npm run test:e2e:eyes
// 1) Справжній MediaPipe Face Landmarker: замість вебкамери — фото обличчя (test/fixtures/face.mjpeg).
// 2) Калібрування й вибір очима: ознаки очей імітуються (людина «дивиться» в задану точку екрана).
import { spawn } from 'node:child_process';
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 3340 + Math.floor(Math.random() * 50);
const APP = `http://localhost:${PORT}/`;
const WORK = mkdtempSync(path.join(tmpdir(), 'vr-eyes-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, details = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${details ? `\n      ${details}` : ''}`); };

const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], {
  cwd: PROJECT, env: { ...process.env, PORT: String(PORT), DB_FILE: path.join(WORK, 'test.db') }, stdio: 'ignore',
});
const chrome = spawn(CHROME, [
  '--headless=new', '--mute-audio', '--remote-debugging-port=9372', `--user-data-dir=${path.join(WORK, 'profile')}`, '--enable-unsafe-swiftshader',
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${path.join(PROJECT, 'test', 'fixtures', 'face.mjpeg')}`,
  'about:blank',
]);
process.on('exit', () => {
  chrome.kill();
  server.kill();
  try { rmSync(WORK, { recursive: true, force: true }); } catch { /* файли ще зайняті */ }
});
for (let i = 0; i < 50; i++) { try { await fetch(`${APP}api/menu`); break; } catch { await sleep(200); } }
let pages;
for (let i = 0; i < 50; i++) { try { pages = await (await fetch('http://127.0.0.1:9372/json/list')).json(); if (pages.find((p) => p.type === 'page')) break; } catch {} await sleep(200); }
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
const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
const waitFor = async (code, ms) => { for (let t = 0; t < ms; t += 200) { if (await V(code)) return true; await sleep(200); } return false; };

// 1. Справжнє розпізнавання обличчя й зіниць на кадрі з «камери».
await V(`m.show(); return true`);
await ev(`${q('#btn-eyes')}.click()`);
const faceOk = await waitFor(`return document.querySelector('[data-calib="face"]').dataset.ok === 'true'`, 30000);
const real = await V(`return { f: v.eyes.last.features, blink: v.eyes.last.blink, frames: v.eyes.frames, ms: v.eyes.detectMs, intro: !document.getElementById('calib').hidden }`);
check('Face Landmarker знаходить обличчя й зіниці на кадрі з камери', faceOk && real.f?.length === 5 && real.f.every(Number.isFinite) && !real.blink && real.intro,
  `ознаки [${real.f?.map((x) => x.toFixed(3)).join(', ')}], кадрів ${real.frames}, розпізнавання ${real.ms?.toFixed(0)} мс`);
check('положення зіниць у межах ока (h ≈ 0,5, v ≈ 0)', real.f && real.f[0] > 0.35 && real.f[0] < 0.65 && Math.abs(real.f[1]) < 0.15, `h = ${real.f?.[0].toFixed(3)}, v = ${real.f?.[1].toFixed(3)}`);

// Скасування першого калібрування — очі вимикаються, камера зупиняється.
await ev(`document.querySelector('[data-calib="cancel"]').click()`);
await sleep(300);
const off = await V(`return { pressed: document.getElementById('btn-eyes').getAttribute('aria-pressed'), running: v.eyes.running, calib: !document.getElementById('calib').hidden }`);
check('скасування калібрування вимикає очі', off.pressed === 'false' && !off.running && !off.calib, JSON.stringify(off));

// 2. Імітовані очі: ознаки залежать від точки, куди «дивиться» людина (точка калібрування або window.__look).
await V(`
  window.__look = null;
  window.__face = true;
  const dot = document.querySelector('.calib-dot');
  let n = 0;
  v.calibration.timing = { settle: 250, collect: 450 };
  v.eyes.startSimulated(() => {
    n++;
    if (!window.__face) return { features: null };
    let p = window.__look;
    if (v.calibration.running && !dot.hidden) p = { x: parseFloat(dot.style.left) / 100, y: parseFloat(dot.style.top) / 100 };
    if (!p) p = { x: 0.5, y: 0.5 };
    if (window.__jitter && n % 6 === 0) p = { x: p.x + 0.3, y: p.y }; // короткі «вискоки» далеко за межі кнопки
    const noise = () => (Math.random() - 0.5) * 0.004;
    return { features: [0.38 + p.x * 0.24 + noise(), -0.05 + p.y * 0.1 + noise() / 2, 0.3 - p.y * 0.05, 0, 0] };
  });
  document.getElementById('btn-eyes').setAttribute('aria-pressed', 'true');
  document.getElementById('btn-calib').hidden = false;
  document.getElementById('btn-calib').click();
  return true;
`);
await sleep(300);
await ev(`document.querySelector('[data-calib="go"]').click()`);
const done = await waitFor(`return document.querySelector('[data-calib="go"]').textContent === 'Готово' && !document.querySelector('.calib-box').hidden`, 15000);
const calibText = await ev(`document.querySelector('[data-calib="text"]').textContent`);
const marks = await ev(`document.querySelectorAll('.calib-marks > span').length`);
const px = Number(calibText.match(/(\d+) пікс\./)?.[1]);
check('калібрування: 9 точок + 4 контрольні, показано похибку в пікселях і градусах', done && marks === 8 && px < 30 && /°/.test(calibText), calibText.slice(0, 110));
await ev(`document.querySelector('[data-calib="go"]').click()`);
await sleep(200);
const mode = await V(`return { kind: v.manager.pointers.get('gaze').kind, hidden: document.getElementById('calib').hidden, status: document.getElementById('statusline').textContent }`);
check('після калібрування погляд керується очима', mode.kind === 'eyes' && mode.hidden && mode.status.startsWith('Очі:'), mode.status);

// 3. Вибір очима: дивимося на кнопку категорії — через ~1 с вона спрацьовує.
const lookAt = (bid) => V(`const p = v.buttonScreen(${JSON.stringify(bid)}); const r = document.getElementById('view').getBoundingClientRect(); window.__look = { x: (p.x - r.left) / r.width, y: (p.y - r.top) / r.height }; return window.__look`);
await V(`v.desktop.lookAt(v.view.root.position); return true`);
await sleep(300);
await lookAt('cat-drinks');
await sleep(500);
const early = await V(`return m.page`);
await sleep(1300);
const selected = await V(`return { page: m.page, cat: m.categoryId, status: document.getElementById('statusline').textContent, reticle: v.manager.pointers.get('gaze').enabled }`);
check('очі: погляд на кнопку ~1 с — вибір (джерело «очі»)', early === 'home' && selected.page === 'category' && selected.cat === 'drinks' && selected.status.includes('очі (вебкамера)'),
  `через 0,5 с: ${early}; потім: ${selected.page}/${selected.cat}; «${selected.status}»`);

// Тремтіння оцінки: короткі вискоки за межі кнопки не скидають відлік.
await V(`m.home(); return true`);
await sleep(300);
await lookAt('cat-pizza');
await V(`window.__jitter = true; return true`);
const trace = [];
for (let i = 0; i < 22; i++) { trace.push(await V(`const g = v.manager.pointers.get('gaze'); return [g.hit?.object.userData.id ?? '-', v.manager.dwell.target?.userData.id ?? '-', v.manager.dwell.elapsed.toFixed(0), v.eyes.point && v.eyes.point.x.toFixed(2)].join(' ')`)); await sleep(100); }
if (process.env.TRACE) console.log(trace.join(' | '));
const jitter = await V(`window.__jitter = false; return { page: m.page, cat: m.categoryId }`);
check('тремтіння погляду не заважає вибору', jitter.page === 'category' && jitter.cat === 'pizza', JSON.stringify(jitter));

// Обличчя зникло з кадру — погляд нічого не обирає.
await V(`m.home(); return true`);
await sleep(300);
await lookAt('cat-soups');
await V(`window.__face = false; return true`);
await sleep(1800);
const lost = await V(`window.__face = true; return { page: m.page, enabled: v.manager.pointers.get('gaze').enabled }`);
check('обличчя не видно — нічого не обирається', lost.page === 'home' && !lost.enabled, JSON.stringify(lost));

// Замовлення, підтверджене очима, зберігається з цим способом.
const saved = await ev(`fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ dishId: window.__vr.model.dishes[0].id, qty: 1 }], method: 'eyes' }) }).then((r) => r.json())`);
const orders = (await ev(`fetch('/api/orders').then((r) => r.json())`)).rows;
check('сервер приймає спосіб «eyes»', orders[0]?.method === 'eyes', saved.message);

// Вимкнення очей повертає звичайний погляд (центр поля зору).
await ev(`${q('#btn-eyes')}.click()`);
await sleep(200);
const back = await V(`return { kind: v.manager.pointers.get('gaze').kind, running: v.eyes.running, calibBtn: document.getElementById('btn-calib').hidden }`);
check('вимкнення очей повертає погляд «головою»', back.kind === 'gaze' && !back.running && back.calibBtn, JSON.stringify(back));

check('без помилок у консолі', errors.length === 0, errors.join(' | '));
ws.close();
process.exit(results.every(Boolean) ? 0 : 1);
