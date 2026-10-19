// Браузерні перевірки лабораторної №2 (Chrome без вікна й без звуку). Запуск: npm run test:e2e
//  A. справжня модель MediaPipe на офіційних тестових фото рук від Google;
//  B. повний ланцюжок «камера → модель → інтерфейс» (фото подається як відео з камери);
//  C. сценарії інтерфейсу з синтетичними кадрами руки (режим ?test).
// Скрипт сам запускає сервер з тимчасовою базою й після роботи все прибирає.
// Шлях до Chrome можна задати змінною CHROME_PATH.
import { spawn } from 'node:child_process';
import { readFileSync, rmSync, mkdtempSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hand } from '../hand.js';

const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 3190 + Math.floor(Math.random() * 50);
const APP = `http://localhost:${PORT}/`;
const WORK = mkdtempSync(path.join(tmpdir(), 'gesture-e2e-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, details = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${details ? `\n      ${details}` : ''}`); };

// Тестові фото рук з набору MediaPipe.
for (const name of ['thumb_up', 'fist', 'pointing_up', 'victory']) {
  const res = await fetch(`https://storage.googleapis.com/mediapipe-assets/${name}.jpg`);
  if (!res.ok) throw new Error(`Не вдалося завантажити тестове фото ${name}.jpg (HTTP ${res.status})`);
  writeFileSync(path.join(WORK, `${name}.jpg`), Buffer.from(await res.arrayBuffer()));
}
copyFileSync(path.join(WORK, 'thumb_up.jpg'), path.join(WORK, 'thumb_up.mjpeg')); // кадр для «камери»

const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], {
  cwd: PROJECT, env: { ...process.env, PORT: String(PORT), DB_FILE: path.join(WORK, 'test.db') }, stdio: 'ignore',
});
const browsers = [];
process.on('exit', () => {
  browsers.forEach((b) => b.kill());
  server.kill();
  try { rmSync(WORK, { recursive: true, force: true }); } catch { /* файли ще зайняті — приберуться системою */ }
});
for (let i = 0; i < 50; i++) { try { await fetch(`${APP}api/employees`); break; } catch { await sleep(200); } }

async function launch(extraArgs, profile, port) {
  rmSync(profile, { recursive: true, force: true });
  const chrome = spawn(CHROME, ['--headless=new', '--mute-audio', `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--enable-unsafe-swiftshader', ...extraArgs, 'about:blank']);
  browsers.push(chrome);
  let pages;
  for (let i = 0; i < 50; i++) { try { pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (pages.find((p) => p.type === 'page')) break; } catch {} await sleep(200); }
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
  const ev = async (expr) => { const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description); return r.result.result.value; };
  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
  return { chrome, ws, cdp, ev, errors, close: () => { ws.close(); chrome.kill(); } };
}

async function waitFor(ev, expr, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = await ev(expr).catch(() => null); if (v) return { value: v, waited: Date.now() - t0 }; await sleep(100); }
  return { value: null, timeout: true };
}

/* ---------- A. Справжня модель на фото ---------- */
{
  const b = await launch([], path.join(WORK, 'pa'), 9340);
  await b.cdp('Page.navigate', { url: `${APP}?test` }); await sleep(1500);
  const images = { thumb_up: 'Thumb_Up', fist: 'Closed_Fist', pointing_up: 'Pointing_Up', victory: 'Victory' };
  const data = Object.fromEntries(Object.keys(images).map((n) => [n, readFileSync(path.join(WORK, `${n}.jpg`)).toString('base64')]));
  const out = await b.ev(`(async () => {
    const { GestureRecognizer, FilesetResolver } = await import('/vendor/mediapipe/vision_bundle.mjs');
    const { detectPose } = await import('/js/gestures.js');
    const fileset = await FilesetResolver.forVisionTasks('/vendor/mediapipe/wasm');
    const t0 = performance.now();
    const rec = await GestureRecognizer.createFromOptions(fileset, { baseOptions: { modelAssetPath: '/models/gesture_recognizer.task', delegate: 'CPU' }, runningMode: 'IMAGE', numHands: 1 });
    const loadMs = Math.round(performance.now() - t0);
    const data = ${JSON.stringify(data)};
    const res = {};
    for (const [name, b64] of Object.entries(data)) {
      const img = new Image(); img.src = 'data:image/jpeg;base64,' + b64; await img.decode();
      const s = performance.now();
      const r = rec.recognize(img);
      const lm = r.landmarks[0];
      res[name] = { category: r.gestures[0]?.[0]?.categoryName, score: r.gestures[0]?.[0]?.score, ms: Math.round(performance.now() - s),
        geometric: lm ? detectPose(lm, 'None', 0) : null };
    }
    return { loadMs, res };
  })()`);
  check('модель MediaPipe завантажується з локального сервера', out.loadMs > 0, `час завантаження ${out.loadMs} мс`);
  for (const [name, expected] of Object.entries(images)) {
    const r = out.res[name];
    check(`фото «${name}» → ${expected}`, r.category === expected, `модель: ${r.category} (${(r.score * 100).toFixed(0)} %), ${r.ms} мс; власні правила пози: ${r.geometric}`);
  }
  const geo = { fist: 'fist', pointing_up: 'point' };
  for (const [name, pose] of Object.entries(geo)) check(`власні правила пози на справжній руці: ${name} → ${pose}`, out.res[name].geometric === pose, `отримано: ${out.res[name].geometric}`);
  check('без помилок у консолі (A)', b.errors.length === 0, b.errors.join(' | '));
  b.close();
}

/* ---------- B. Камера → модель → інтерфейс (фото як фейкова камера) ---------- */
{
  const b = await launch([`--use-file-for-fake-video-capture=${path.join(WORK, 'thumb_up.mjpeg')}`], path.join(WORK, 'pb'), 9341);
  await b.cdp('Page.navigate', { url: APP });
  const ready = await waitFor(b.ev, `window.__cameraStatus?.model === 'ready' && window.__cameraStatus?.camera === 'ready' && window.__cameraStatus?.fps > 0 && window.__cameraStatus`, 30000);
  check('камера + модель працюють у реальному часі', !ready.timeout, ready.value ? `делегат ${ready.value.delegate}, ${ready.value.fps} FPS, обробка кадру ${ready.value.inferMs} мс` : 'не дочекалися');
  const pose = await waitFor(b.ev, `document.getElementById('pose-badge').textContent.includes('Великий палець угору') && document.getElementById('pose-badge').textContent`, 10000);
  check('рука з камери розпізнана в інтерфейсі', !pose.timeout, pose.value ?? await b.ev(`document.getElementById('pose-badge').textContent`));
  check('без помилок у консолі (B)', b.errors.length === 0, b.errors.join(' | '));
  b.close();
}

/* ---------- C. Сценарії інтерфейсу з синтетичною рукою ---------- */
{
  const b = await launch([], path.join(WORK, 'pc'), 9342);
  await b.cdp('Page.navigate', { url: `${APP}?test` }); await sleep(1500);
  // Віртуальний час кадрів не відстає від реального (важливо для пауз між спробами).
  const started = Date.now();
  let clock = 1e6;
  const feed = async (list) => {
    clock = Math.max(clock, 1e6 + Date.now() - started);
    const frames = list.map((p) => { clock += 33; return { t: clock, landmarks: p ? hand(p) : null, category: p?.category ?? 'None', score: p?.category ? 0.9 : 0 }; });
    await b.ev(`${JSON.stringify(frames)}.forEach((f) => window.__gesture.feed(f))`);
    await sleep(150);
  };
  const seq = (n, fn) => Array.from({ length: n + 1 }, (_, i) => fn(i / n));
  const box = { x0: 0.15, x1: 0.85, y0: 0.12, y1: 0.72 };
  const toHand = async (selector) => {
    const r = await b.ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); const r = e.getBoundingClientRect(); return { x: (r.left + r.width / 2) / innerWidth, y: (r.top + r.height / 2) / innerHeight }; })()`);
    return { x: 1 - (box.x0 + r.x * (box.x1 - box.x0)), y: box.y0 + r.y * (box.y1 - box.y0) };
  };
  const pinchOn = async (selector) => {
    const p = await toHand(selector);
    await feed([...seq(14, () => ({ ...p, pose: 'open' })), ...seq(4, () => ({ ...p, pose: 'pinch' })), ...seq(4, () => ({ ...p, pose: 'open' }))]);
    await sleep(250);
  };
  const toast = () => b.ev(`document.getElementById('toast').textContent`);
  const swipeUp = () => feed(seq(9, (k) => ({ pose: 'open', y: 0.7 - 0.35 * k })));
  const swipeSide = () => feed(seq(9, (k) => ({ pose: 'open', x: 0.7 - 0.4 * k })));
  const circle = () => feed(seq(36, (k) => ({ pose: 'point', x: 0.5 + 0.08 * Math.cos(2 * Math.PI * k), y: 0.5 + 0.08 * Math.sin(2 * Math.PI * k) })));
  const fistPoint = () => feed([...seq(12, () => ({ pose: 'fist' })), ...seq(14, () => ({ pose: 'point' }))]);
  const thumb = (category, pose = 'fist') => feed(seq(28, () => ({ pose, category })));
  // Утримання зі «збоями»: кожен 5-й кадр класифікатор повертає None.
  const glitchyThumb = (category) => feed(seq(30, (k) => ({ pose: 'fist', category: Math.round(k * 30) % 5 === 4 ? undefined : category })));
  const handAway = () => feed([null, null]);
  // Навести курсор і потримати ~1,2 с (клік затримкою).
  const dwellOn = async (selector) => {
    const p = await toHand(selector);
    await feed(seq(40, () => ({ ...p, pose: 'open' })));
    await sleep(200);
  };
  const api = () => b.ev(`fetch('/api/employees').then((r) => r.json()).then((j) => j.rows)`);
  const visible = (id) => b.ev(`!document.getElementById('${id}').hidden`);

  await swipeUp();
  check('мах угору більше нічого не робить', (await toast()) === 'Готово.', await toast());
  await handAway();

  await thumb('Victory', 'open');
  check('✌️ утримання → показано всіх', /Показати всіх: 7/.test(await toast()), await toast());
  await handAway(); await sleep(1100);

  await circle();
  check('☝️🔄 коло без вибраного запису → підказка', /Спочатку виберіть запис/.test(await toast()), await toast());
  await handAway();

  await dwellOn('#rows tr[data-id="2"]');
  check('⏳ затримка курсора на рядку → запис вибрано', (await b.ev(`window.__gesture.state.selectedId`)) === 2);
  await pinchOn('#rows tr[data-id="3"]');
  check('👌 щипок на іншому рядку → вибрано його', (await b.ev(`window.__gesture.state.selectedId`)) === 3);
  await dwellOn('#rows tr[data-id="2"]');
  await handAway();

  await sleep(1100); await circle();
  const editOpen = await b.ev(`!document.getElementById('form-modal').hidden && document.getElementById('f-name').value`);
  check('☝️🔄 коло → форма редагування', editOpen === 'Андрій Шевченко', `форма: ${editOpen}`);
  await dwellOn('[data-step="1000"]');
  await dwellOn('#last-chips .chip:nth-child(8)'); // прізвище «Петренко»
  check('⏳ кнопки форми натискаються затримкою курсора', (await b.ev(`document.getElementById('f-name').value`)) === 'Андрій Петренко'
    && (await b.ev(`document.getElementById('f-salary').textContent`)).startsWith('46'), await b.ev(`document.getElementById('f-name').value + ' · ' + document.getElementById('f-salary').textContent`));
  await handAway();
  await glitchyThumb('Thumb_Up'); await sleep(500);
  const andrii = (await api()).find((r) => r.id === 2);
  check('👍 зі «збоями» розпізнавання все одно зберігає, таблиця оновлюється', andrii.name === 'Андрій Петренко' && andrii.salary === 46000 && !(await visible('form-modal'))
    && (await b.ev(`document.querySelector('#rows tr[data-id="2"]').textContent`)).includes('Петренко'), JSON.stringify(andrii));
  await handAway(); await sleep(1100);

  await swipeSide();
  const confirmOpen = await b.ev(`!document.getElementById('confirm-modal').hidden && document.getElementById('confirm-text').textContent`);
  check('👋↔️ мах убік → запит підтвердження', /Андрій Петренко/.test(confirmOpen || ''), confirmOpen);
  await thumb('Thumb_Down'); await sleep(300);
  check('👎 → видалення скасовано', (await api()).some((r) => r.id === 2) && !(await visible('confirm-modal')));
  await handAway(); await sleep(1100);
  await swipeSide(); await handAway();
  await dwellOn('#confirm-yes'); await sleep(400);
  check('👋↔️ + затримка на «Так» → запис видалено', !(await api()).some((r) => r.id === 2), await toast());
  await handAway(); await sleep(1100);

  await fistPoint(); await handAway();
  check('✊➜☝️ → форма додавання', (await visible('form-modal')) && (await b.ev(`document.getElementById('form-title').textContent`)) === 'Новий працівник');
  await dwellOn('#first-chips .chip:nth-child(6)'); // Олена
  await dwellOn('#last-chips .chip:nth-child(5)'); // Мельник
  await dwellOn('#position-chips .chip:nth-child(1)');
  await dwellOn('#salary-chips .chip:nth-child(3)'); // 40 000
  await pinchOn('#keyboard-toggle');
  const kb = await visible('keyboard');
  await dwellOn('#keyboard .key.wide'); // пробіл
  for (const k of ['в', 'н']) await pinchOn(`#keyboard .key[data-k="${k}"]`);
  await pinchOn('#keyboard .key.action'); // ⌫
  const typed = await b.ev(`document.getElementById('f-name').value`);
  check('швидкий вибір імені + клавіатура за потреби', kb && typed === 'Олена Мельник В', `ім'я: «${typed}», клавіатура відкрилась: ${kb}`);
  await pinchOn('#keyboard .key.action'); await pinchOn('#keyboard .key.action'); // прибрати « В»
  const position = await b.ev(`document.getElementById('f-position').value`);
  await handAway();
  await thumb('Thumb_Up'); await sleep(500);
  const olena = (await api()).find((r) => r.name === 'Олена Мельник');
  check('👍 → новий працівник збережений', olena && olena.salary === 40000 && olena.position === position, JSON.stringify(olena));
  await handAway();

  // Валідація: порожнє ім'я не зберігається.
  await sleep(1100); await fistPoint(); await handAway(); await thumb('Thumb_Up'); await sleep(400);
  const err = await b.ev(`document.querySelector('[data-error="name"]').textContent`);
  check('валідація: порожнє ім’я не зберігається', !!err && (await visible('form-modal')), err);
  await thumb('Thumb_Down'); await handAway();

  // Пауза: жести ігноруються.
  await b.ev(`document.getElementById('btn-pause').click()`);
  await sleep(1100); await swipeSide(); await circle();
  check('⏸ пауза — жести не виконуються', !(await visible('confirm-modal')) && !(await visible('form-modal')));
  await b.ev(`document.getElementById('btn-pause').click()`);

  // Режим перевірки точності: 3 спроби на жест, у першій спробі «коло» навмисно показуємо інший жест.
  await b.ev(`document.getElementById('btn-accuracy').click()`);
  await b.ev(`document.getElementById('acc-trials').value = '3'`);
  await b.ev(`document.getElementById('acc-start').click()`);
  const GESTURE_BY_NAME = {
    'V-жест (утримати)': () => thumb('Victory', 'open'), 'Кулак, потім вказівний палець': fistPoint, 'Коло вказівним пальцем': circle,
    'Мах долонею вбік': swipeSide, 'Щипок (жест «OK»)': () => feed([...seq(4, () => ({ pose: 'open' })), ...seq(4, () => ({ pose: 'pinch' }))]),
    'Великий палець угору (утримати)': () => thumb('Thumb_Up'), 'Великий палець униз (утримати)': () => thumb('Thumb_Down'),
  };
  let sabotaged = false;
  for (let i = 0; i < 21; i++) {
    const ready = await waitFor(b.ev, `document.getElementById('acc-feedback').textContent === 'Покажіть жест!' && document.getElementById('acc-name').textContent`, 8000);
    if (ready.timeout) break;
    if (ready.value === 'Коло вказівним пальцем' && !sabotaged) { sabotaged = true; await swipeSide(); }
    else await GESTURE_BY_NAME[ready.value]();
    await handAway();
    await waitFor(b.ev, `document.getElementById('acc-feedback').dataset.result`, 8000);
  }
  const total = await waitFor(b.ev, `!document.getElementById('acc-results').hidden && document.querySelector('.acc-total').textContent`, 10000);
  check('🎯 перевірка точності рахує влучання й помилки', total.value === 'Загальна точність: 95 % (20 з 21)', total.value ?? 'не завершилась');
  await b.ev(`document.getElementById('acc-close').click()`);

  check('без помилок у консолі (C)', b.errors.length === 0, b.errors.join(' | '));
  b.close();
}

process.exit(results.every(Boolean) ? 0 : 1);
