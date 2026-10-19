// Головний модуль: сцена, меню, способи взаємодії (погляд, промінь, рука, голос, окуляри) і дії меню.
import * as THREE from 'three';
import { MenuModel } from './menu-model.js';
import { MenuView } from './menu-view.js';
import { InteractionManager } from './interaction.js';
import { DesktopRig, GazeReticle } from './desktop.js';
import { XRRig, xrSupport } from './xr.js';
import { WebcamHand } from './hand-input.js';
import { EyeTracker } from './eye-tracker.js';
import { EyeCalibration } from './eye-calibration.js';
import { VoiceInput } from './voice-input.js';
import { parseVoice } from './voice-commands.js';
import { AccuracyTest } from './accuracy.js';
import { buildEnvironment } from './environment.js';

const $ = (id) => document.getElementById(id);
const TEST_MODE = new URLSearchParams(location.search).has('test');
const SOURCE_LABEL = { gaze: 'погляд', eyes: 'очі (вебкамера)', mouse: 'промінь (миша)', controller: 'контролер', hand: 'рука', voice: 'голос' };

/* ---------- Сцена ---------- */

const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.xr.enabled = true;
const scene = new THREE.Scene();
const background = new THREE.Color(0x1b1512);
scene.background = background;
const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 50);
scene.add(camera);
const environment = buildEnvironment(scene);

function resize() {
  const { clientWidth: w, clientHeight: h } = canvas;
  if (!w || !h || renderer.xr.isPresenting) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas);

/* ---------- Меню ---------- */

const model = new MenuModel();
const view = new MenuView(model, { onAction: (action, payload, source) => act(action, payload, source) });
scene.add(view.root);

const head = () => {
  camera.updateMatrixWorld();
  return { position: camera.getWorldPosition(new THREE.Vector3()), quaternion: camera.getWorldQuaternion(new THREE.Quaternion()) };
};

model.onChange((m, event) => {
  view.root.visible = m.open && !accuracy.running;
  if (event.type === 'open') view.placeInFront(head());
  if (event.type === 'settings') {
    environment.setBrightness(m.settings.brightness);
    $('opt-gaze').checked = m.settings.gaze;
    if (event.key === 'distance') view.targetPose = view.poseFor(head());
  }
  if (m.open) view.rebuild();
  manager.resetDwell();
});

/* ---------- Взаємодія ---------- */

const manager = new InteractionManager({
  getTargets: () => (accuracy.running ? accuracy.targets : view.root.visible ? view.interactives : []),
  getDwellMs: () => model.settings.dwellMs,
  isGazeEnabled: () => model.settings.gaze,
});
manager.addPointer('gaze', 'gaze');
manager.addPointer('hand', 'hand');
manager.onSelect((target, source) => accuracy.handleSelect(target, source));

const desktop = new DesktopRig({ canvas, camera, manager, scene, onClick: () => manager.select('mouse') });
const reticle = new GazeReticle(scene);
const accuracy = new AccuracyTest({
  scene,
  onProgress: (text) => status(`Перевірка точності: ${text}`),
  onFinish: (summary) => finishAccuracy(summary),
  onRebuild: (target) => manager.resetDwell({ except: target }), // на підсвічену ціль можна дивитися одразу
});

let statusTimer = 0;
function status(text, kind = 'ok') {
  const el = $('statusline');
  el.textContent = text;
  el.dataset.status = kind;
  clearTimeout(statusTimer);
}

/* ---------- Дії меню (спільні для всіх способів) ---------- */

async function act(action, payload, source = 'mouse') {
  const how = SOURCE_LABEL[source] ?? source;
  switch (action) {
    case 'open': model.show(); break;
    case 'close': model.hide(); break;
    case 'toggle': model.toggle(); break;
    case 'category': model.openCategory(payload); break;
    case 'dish': model.openDish(payload); break;
    case 'next': if (!model.nextPage()) return status('Це остання сторінка.', 'warn'); break;
    case 'prev': if (!model.prevPage()) return status('Це перша сторінка.', 'warn'); break;
    case 'back': model.back(); break;
    case 'home': model.home(); break;
    case 'order': model.go('order'); break;
    case 'settings': model.go('settings'); break;
    case 'plus': model.changeQty(+1); break;
    case 'minus': model.changeQty(-1); break;
    case 'add': {
      const r = model.addToCart();
      view.toast(r.message);
      return status(`${r.message} (${how})`, r.ok ? 'ok' : 'warn');
    }
    case 'remove': model.removeFromCart(payload); break;
    case 'clear': model.clearCart(); break;
    case 'checkout': {
      const r = model.requestCheckout();
      if (!r.ok) return status(r.message, 'warn');
      break;
    }
    case 'yes': return placeOrder(source);
    case 'no':
      if (model.confirm(false)) status('Оформлення скасовано.', 'warn');
      return;
    case 'setting': model.setSetting(payload[0], payload[1]); break;
    default: return;
  }
  status(`${describe(action, payload)} — ${how}`);
}

function describe(action, payload) {
  const names = {
    open: 'Меню відкрито', close: 'Меню закрито', toggle: model.open ? 'Меню відкрито' : 'Меню закрито',
    next: 'Наступна сторінка', prev: 'Попередня сторінка', back: 'Назад', home: 'Головна', order: 'Замовлення',
    settings: 'Налаштування', plus: `Кількість: ${model.qty}`, minus: `Кількість: ${model.qty}`, remove: 'Позицію прибрано',
    clear: 'Замовлення очищено', checkout: 'Підтвердіть замовлення', setting: 'Налаштування змінено',
  };
  if (action === 'category') return `Категорія: ${model.category(payload)?.name}`;
  if (action === 'dish') return `Страва: ${model.dish(payload)?.name}`;
  return names[action] ?? action;
}

async function placeOrder(source) {
  const confirmed = model.confirm(true);
  if (!confirmed?.items) return;
  const res = await fetch('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: confirmed.items, method: source }),
  }).then((r) => r.json().then((data) => ({ ok: r.ok, data }))).catch(() => ({ ok: false, data: { message: 'Сервер недоступний.' } }));
  if (!res.ok) return status(res.data.message, 'warn');
  model.orderPlaced();
  view.toast(res.data.message);
  status(`${res.data.message} Підтверджено: ${SOURCE_LABEL[source] ?? source}.`);
}

/* ---------- Голос ---------- */

function handleVoice(text) {
  const cmd = parseVoice(text, model.dishes);
  if (accuracy.running) {
    if (cmd.type === 'number') accuracy.handleNumber(cmd.n);
    return cmd;
  }
  const map = {
    open: ['open'], close: ['close'], back: ['back'], home: ['home'], next: ['next'], prev: ['prev'], plus: ['plus'], minus: ['minus'],
    settings: ['settings'], order: ['order'], checkout: ['checkout'], add: ['add'], clear: ['clear'], yes: ['yes'], no: ['no'],
    category: ['category', cmd.id], dish: ['dish', cmd.id],
  };
  if (!map[cmd.type]) {
    status(`Голос: не зрозумів «${text}». Скажіть, наприклад, «меню», «піца», «далі».`, 'warn');
    return cmd;
  }
  if (cmd.type === 'add' && model.page !== 'dish') return status('Щоб додати, спершу відкрийте страву.', 'warn'), cmd;
  if (cmd.type === 'plus' || cmd.type === 'minus') if (model.page !== 'dish') return cmd;
  if ((cmd.type === 'yes' || cmd.type === 'no') && model.page !== 'confirm') return cmd;
  const [action, payload = null] = map[cmd.type];
  act(action, payload, 'voice');
  return cmd;
}

const voice = new VoiceInput({ onText: (t) => { status(`Голос: «${t}»`); handleVoice(t); }, onStatus: (s) => status(s) });
$('btn-voice').addEventListener('click', (e) => {
  const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
  if (on && !voice.start()) return status('Розпізнавання мовлення недоступне в цьому браузері (потрібні Chrome або Edge).', 'warn');
  if (!on) voice.stop();
  e.currentTarget.setAttribute('aria-pressed', String(on));
});

/* ---------- Рука (вебкамера) ---------- */

const handCursor = $('hand-cursor');
function handleHand(e) {
  if (e.type === 'cursor') {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(e.x, e.y), camera);
    manager.setRay('hand', raycaster.ray.origin, raycaster.ray.direction);
    const r = canvas.getBoundingClientRect();
    handCursor.hidden = false;
    handCursor.style.transform = `translate(${((e.x + 1) / 2) * r.width}px, ${((1 - e.y) / 2) * r.height}px)`;
    handCursor.classList.remove('is-pinch');
  } else if (e.type === 'pinch') {
    handCursor.classList.add('is-pinch');
    manager.select('hand');
  } else if (e.type === 'swipe') {
    if (model.page === 'category') act(e.dir === 'left' ? 'next' : 'prev', null, 'hand');
  } else if (e.type === 'lost') {
    manager.disable('hand');
    handCursor.hidden = true;
  }
}
const hand = new WebcamHand({ video: $('webcam-video'), onEvent: handleHand, onStatus: (s) => ($('hand-status').textContent = s) });
$('btn-hand').addEventListener('click', async (e) => {
  const button = e.currentTarget;
  const on = button.getAttribute('aria-pressed') !== 'true';
  button.setAttribute('aria-pressed', String(on));
  $('webcam').hidden = !on;
  if (!on) return hand.stop();
  try {
    await hand.start();
    status('Рука: курсор — центр долоні, щипок («OK») — вибір, мах убік — гортати сторінки.');
  } catch (err) {
    button.setAttribute('aria-pressed', 'false');
    $('webcam').hidden = true;
    status(`Не вдалося увімкнути камеру: ${err.message}`, 'warn');
  }
});

/* ---------- Очі (вебкамера) ---------- */

const eyes = new EyeTracker({ video: $('eyecam-video'), onStatus: (s) => ($('eyecam-status').textContent = s) });
const calibration = new EyeCalibration({ tracker: eyes, layer: $('calib') });
let eyesMode = false; // погляд керується очима (є калібрування), а не центром поля зору

function setEyesMode(on) {
  eyesMode = on;
  manager.pointers.get('gaze').kind = on ? 'eyes' : 'gaze';
  manager.resetDwell();
}

async function calibrateEyes() {
  if (calibration.running) return;
  $('btn-calib').disabled = true;
  try {
    const result = await calibration.run();
    if (!result) {
      if (!eyes.running) return; // очі вже вимкнули кнопкою
      if (!eyes.model) return stopEyes('Калібрування скасовано — очі вимкнено.');
      return status('Калібрування скасовано, залишено попереднє.', 'warn');
    }
    eyes.setModel(result.model);
    setEyesMode(true);
    status(`Очі: похибка ≈ ${Math.round(result.meanPx)} пікс. (${result.deg.toFixed(1).replace('.', ',')}°). Приціл рухається за поглядом — затримайте його на кнопці ~1 с.`);
  } finally {
    $('btn-calib').disabled = false;
  }
}

function stopEyes(message) {
  calibration.cancel();
  eyes.stop();
  eyes.setModel(null);
  setEyesMode(false);
  $('btn-eyes').setAttribute('aria-pressed', 'false');
  $('eyecam').hidden = true;
  $('btn-calib').hidden = true;
  if (message) status(message, 'warn');
}

$('btn-eyes').addEventListener('click', async (e) => {
  const button = e.currentTarget;
  if (button.getAttribute('aria-pressed') === 'true') return stopEyes('Очі вимкнено — погляд знову за центром екрана.');
  button.setAttribute('aria-pressed', 'true');
  $('eyecam').hidden = false;
  try {
    await eyes.start();
  } catch (err) {
    return stopEyes(`Не вдалося увімкнути камеру для очей: ${err.message}`);
  }
  $('btn-calib').hidden = false;
  calibrateEyes();
});
$('btn-calib').addEventListener('click', () => calibrateEyes());

/* ---------- Окуляри (WebXR) ---------- */

const xr = new XRRig({
  renderer,
  scene,
  manager,
  onSqueeze: () => act('toggle', null, 'controller'),
  onEnd: () => {
    environment.group.visible = true;
    scene.background = background;
    $('mode-status').textContent = 'Режим: емуляція окулярів';
    $('mode-status').dataset.state = 'ok';
    resize();
  },
});
xrSupport().then(({ vr, ar }) => {
  $('btn-vr').hidden = !vr;
  $('btn-ar').hidden = !ar;
});
async function enterXR(mode) {
  try {
    if (mode === 'immersive-ar') {
      environment.group.visible = false; // в AR меню «плаває» поверх реального світу
      scene.background = null;
    }
    await xr.enter(mode, $('overlay'));
    $('mode-status').textContent = mode === 'immersive-ar' ? 'Режим: AR (окуляри)' : 'Режим: VR (окуляри)';
    $('mode-status').dataset.state = 'xr';
    model.show();
  } catch (err) {
    environment.group.visible = true;
    scene.background = background;
    status(`Не вдалося увійти в XR: ${err.message}`, 'warn');
  }
}
$('btn-vr').addEventListener('click', () => enterXR('immersive-vr'));
$('btn-ar').addEventListener('click', () => enterXR('immersive-ar'));

/* ---------- Перевірка точності ---------- */

const accuracyLog = [];
function finishAccuracy(summary) {
  accuracyLog.push(summary);
  view.root.visible = model.open;
  renderAccuracyLog();
  $('accuracy-modal').hidden = false;
  status(`Перевірка завершена: ${summary.label} — ${summary.accuracy.toFixed(0)} %`);
}

function renderAccuracyLog() {
  $('acc-empty').hidden = accuracyLog.length > 0;
  $('acc-log').replaceChildren(...accuracyLog.map((s) => {
    const tr = document.createElement('tr');
    const cells = [s.label, s.total, s.hits, s.wrong, s.missed, `${s.accuracy.toFixed(0)} %`, s.avgMs == null ? '—' : `${(s.avgMs / 1000).toFixed(1).replace('.', ',')} с`];
    cells.forEach((text, i) => {
      const td = document.createElement('td');
      td.textContent = text;
      if (i) td.className = 'num';
      tr.append(td);
    });
    return tr;
  }));
}

$('btn-accuracy').addEventListener('click', () => {
  renderAccuracyLog();
  $('accuracy-modal').hidden = false;
});
$('acc-start').addEventListener('click', () => {
  if ($('acc-method').value === 'eyes' && !eyesMode) return status('Спершу увімкніть «Очі (камера)» і пройдіть калібрування.', 'warn');
  $('accuracy-modal').hidden = true;
  view.root.visible = false;
  accuracy.start({ method: $('acc-method').value, trials: Number($('acc-trials').value), pose: view.poseFor(head()) });
  status('Перевірка точності: оберіть підсвічену ціль заданим способом.');
});
$('acc-copy').addEventListener('click', async () => {
  const rows = accuracyLog.map((s) => `| ${s.label} | ${s.total} | ${s.hits} | ${s.wrong} | ${s.missed} | ${s.accuracy.toFixed(0)} % | ${s.avgMs == null ? '—' : `${(s.avgMs / 1000).toFixed(1).replace('.', ',')} с`} |`);
  const text = ['| Спосіб | Спроб | Влучань | Помилок | Пропусків | Точність | Сер. час |', '|---|---|---|---|---|---|---|', ...rows].join('\n');
  try {
    await navigator.clipboard.writeText(text);
    status('Таблицю скопійовано.');
  } catch {
    status('Не вдалося скопіювати.', 'warn');
  }
});

/* ---------- Інтерфейс сторінки ---------- */

$('btn-menu').addEventListener('click', () => act('toggle', null, 'mouse'));
$('opt-gaze').addEventListener('change', (e) => model.setSetting('gaze', e.target.checked));
$('btn-help').addEventListener('click', () => ($('help-modal').hidden = false));
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => {
  b.closest('.modal').hidden = true;
}));
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea')) return;
  if (e.code === 'KeyM') act('toggle', null, 'mouse');
  if (e.key === 'Escape') {
    if (calibration.running) {
      calibration.cancel();
    } else if (accuracy.running) {
      accuracy.stop();
      view.root.visible = model.open;
      status('Перевірку точності зупинено.', 'warn');
    } else {
      model.hide();
    }
    document.querySelectorAll('.modal').forEach((m) => (m.hidden = true));
  }
});

/* ---------- Цикл ---------- */

// Напрям погляду: центр поля зору («голова»), або оцінка очей з вебкамери, або null — погляд невідомий.
const eyeRaycaster = new THREE.Raycaster();
function gazeDirection(h) {
  if (calibration.running) return null; // під час калібрування погляд нічого не обирає
  if (!eyesMode || renderer.xr.isPresenting) return new THREE.Vector3(0, 0, -1).applyQuaternion(h.quaternion);
  const p = eyes.gazePoint();
  if (!p) return null; // обличчя не видно або очі закриті довго
  eyeRaycaster.setFromCamera(new THREE.Vector2(p.x * 2 - 1, 1 - p.y * 2), camera);
  return eyeRaycaster.ray.direction.clone();
}

let last = performance.now();
let statsAt = 0;
let frames = 0;
renderer.setAnimationLoop((time) => {
  const dt = Math.min(0.1, (time - last) / 1000);
  last = time;
  if (!renderer.xr.isPresenting) desktop.update(dt);
  xr.update();
  scene.updateMatrixWorld();
  const h = head();
  const gazeDir = gazeDirection(h);
  // Вимкнений погляд нічого не підсвічує й не обирає.
  if (gazeDir && model.settings.gaze) manager.setRay('gaze', h.position, gazeDir);
  else manager.disable('gaze');
  const { gazeProgress, gazeHit } = manager.update(dt * 1000);
  reticle.update(h, gazeHit, gazeProgress, model.settings.gaze && Boolean(gazeDir), gazeDir);
  view.update(dt, h, time / 1000);
  renderer.render(scene, camera);
  frames++;
  if (time - statsAt > 1000) {
    $('stats').textContent = `${Math.round((frames * 1000) / (time - statsAt))} кадр/с · обробка взаємодії ${manager.stats.avgMs.toFixed(2).replace('.', ',')} мс${eyes.running && eyes.detectMs ? ` · очі ${eyes.detectMs.toFixed(0)} мс` : ''}`;
    statsAt = time;
    frames = 0;
  }
});

/* ---------- Старт ---------- */

fetch('/api/menu').then((r) => r.json()).then((data) => {
  model.setData(data);
  if (TEST_MODE) return;
  model.show();
  try {
    if (!localStorage.getItem('vr-help-seen')) {
      $('help-modal').hidden = false;
      localStorage.setItem('vr-help-seen', '1');
    }
  } catch {
    /* без localStorage довідку просто не показуємо автоматично */
  }
}).catch(() => status('Не вдалося завантажити меню. Перевірте, чи запущено сервер.', 'warn'));

if (TEST_MODE) {
  window.__vr = {
    model, view, manager, desktop, accuracy, act, handleVoice, handleHand, eyes, calibration, setEyesMode,
    // Координати центру кнопки на екрані (для справжніх кліків миші в тестах).
    buttonScreen(id) {
      const b = [...view.interactives, ...accuracy.targets].find((x) => x.userData.id === id);
      if (!b) return null;
      b.updateMatrixWorld();
      const p = b.getWorldPosition(new THREE.Vector3()).project(camera);
      const r = canvas.getBoundingClientRect();
      return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
    },
    lookAtButton(id) {
      const b = [...view.interactives, ...accuracy.targets].find((x) => x.userData.id === id);
      if (b) desktop.lookAt(b.getWorldPosition(new THREE.Vector3()));
      return Boolean(b);
    },
  };
}
