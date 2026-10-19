// Головний модуль: зв'язує камеру й рушій жестів з таблицею, формами та журналом.
import { GestureEngine, COMMANDS } from './gestures.js';
import { api } from './api.js';
import { createForms } from './forms.js';
import { createAccuracyTest } from './accuracy.js';

const $ = (id) => document.getElementById(id);
// ?test — режим автотестів: без камери, кадри подаються через window.__gesture.feed().
const TEST_MODE = new URLSearchParams(location.search).has('test');

const els = {
  video: $('video'),
  overlay: $('overlay'),
  poseBadge: $('pose-badge'),
  holdRing: $('hold-ring'),
  holdIcon: $('hold-icon'),
  cameraMessage: $('camera-message'),
  statusModel: $('status-model'),
  statusCamera: $('status-camera'),
  statusFps: $('status-fps'),
  light: $('light-meter'),
  infer: $('infer-time'),
  rows: $('rows'),
  tableInfo: $('table-info'),
  log: $('log'),
  logEmpty: $('log-empty'),
  toast: $('toast'),
  cursor: $('air-cursor'),
  cursorProgress: $('cursor-progress'),
  cursorLabel: $('cursor-label'),
  dwell: $('opt-dwell'),
  pause: $('btn-pause'),
};

const POSES = {
  open: 'Відкрита долоня', fist: 'Кулак', point: 'Вказівний палець', thumb_up: 'Великий палець угору',
  thumb_down: 'Великий палець униз', victory: 'V-жест', love: 'Жест «I love you»', other: 'Рука в кадрі',
};
// Коротка підпис-підказка біля курсора та в кільці утримання.
const POSE_SHORT = { open: 'долоня', fist: 'кулак', point: 'палець', thumb_up: 'угору', thumb_down: 'униз', victory: 'V' };
const HOLD_LABEL = { thumb_up: 'Так', thumb_down: 'Ні', victory: 'Всі' };
const DWELL_MS = 900; // навести курсор і потримати — клік
const money = new Intl.NumberFormat('uk-UA');

const state = {
  rows: [], positions: [], selectedId: null, paused: false, mode: null,
  cursor: null, hover: null, dwell: { since: 0, done: false }, holding: false,
};
const engine = new GestureEngine();

/* ---------- Таблиця ---------- */

const selectedRow = () => state.rows.find((r) => r.id === state.selectedId) ?? null;

function renderTable(highlightId) {
  els.rows.replaceChildren();
  for (const r of state.rows) {
    const tr = document.createElement('tr');
    tr.dataset.id = r.id;
    if (r.id === state.selectedId) tr.classList.add('is-selected');
    if (r.id === highlightId) tr.classList.add('is-flash');
    for (const [text, cls] of [[r.id, 'num'], [r.name], [r.position], [money.format(r.salary), 'num']]) {
      const td = document.createElement('td');
      td.textContent = text;
      if (cls) td.className = cls;
      tr.append(td);
    }
    tr.addEventListener('click', () => selectRow(r.id));
    els.rows.append(tr);
  }
  const row = selectedRow();
  els.tableInfo.textContent = `Записів: ${state.rows.length}${row ? ` · вибрано: ${row.name} (ID ${row.id})` : ' · запис не вибрано'}`;
}

function selectRow(id) {
  if (state.selectedId === id) return;
  state.selectedId = id;
  renderTable();
  const row = selectedRow();
  if (row) notify(`Вибрано: ${row.name} (ID ${row.id})`, 'info', 'click', { quiet: true });
}

async function load(highlightId) {
  const { ok, data } = await api.list();
  if (!ok) {
    notify(data.message, 'error');
    return false;
  }
  state.rows = data.rows;
  state.positions = data.positions;
  if (!selectedRow()) state.selectedId = null;
  renderTable(highlightId);
  return true;
}

/* ---------- Повідомлення та журнал ---------- */

// Повідомлення — у рядок стану внизу вікна та в журнал.
function notify(message, status = 'ok', gesture, { quiet = false } = {}) {
  if (!quiet) {
    els.toast.textContent = message;
    els.toast.dataset.status = status;
  }
  const li = document.createElement('li');
  li.dataset.status = status;
  const time = document.createElement('time');
  time.textContent = new Date().toLocaleTimeString('uk-UA');
  const text = document.createElement('span');
  text.textContent = message;
  li.append(time, text);
  els.log.prepend(li);
  els.logEmpty.hidden = true;
}

/* ---------- Команди ---------- */

async function runCommand(name, source = 'gesture') {
  if (forms.isFormOpen() || forms.isConfirmOpen()) return;
  const via = source === 'mouse' ? ' (миша)' : '';
  if (name === 'select_all') {
    if (await load()) notify(`${COMMANDS.select_all}: ${state.rows.length} записів${via}`, 'ok', name);
  } else if (name === 'add') {
    forms.openForm('add', null, state.positions);
    notify(`Додавання нового працівника${via}`, 'info', name, { quiet: true });
  } else {
    const row = selectedRow();
    if (!row) {
      notify('Спочатку виберіть запис: наведіть курсор на рядок і потримайте ~1 с (або щипок)', 'warn', name);
    } else if (name === 'update') {
      forms.openForm('edit', row, state.positions);
      notify(`Редагування: ${row.name}${via}`, 'info', name, { quiet: true });
    } else if (name === 'delete') {
      forms.openConfirm(row);
      notify(`Запит на видалення: ${row.name}${via}`, 'warn', name, { quiet: true });
    }
  }
  syncMode();
}

const forms = createForms({
  async onSubmit(mode, row, employee) {
    const { ok, data } = mode === 'add' ? await api.create(employee) : await api.update(row.id, employee);
    if (!ok) {
      const first = data.errors ? Object.values(data.errors)[0] : '';
      notify(first ? `${data.message} ${first}` : data.message, 'error');
      return { ok: false, errors: data.errors };
    }
    state.selectedId = data.row.id;
    await load(data.row.id);
    notify(data.message, 'ok', 'confirm');
    return { ok: true };
  },
  async onDelete(row) {
    const { ok, data } = await api.remove(row.id);
    notify(data.message, ok ? 'ok' : 'error', 'confirm');
    state.selectedId = null;
    await load();
  },
  onClose: () => syncMode(),
  onCancel: (what) => notify(what === 'delete' ? 'Видалення скасовано.' : what === 'add' ? 'Додавання скасовано.' : 'Редагування скасовано.', 'warn'),
});

const accuracy = createAccuracyTest({ onStart: () => syncMode(), onStop: () => syncMode() });

// Режим рушія залежить від того, що відкрито на екрані.
function syncMode() {
  const mode = accuracy.isRunning() ? 'test'
    : state.paused ? 'paused'
    : forms.isConfirmOpen() ? 'confirm'
    : forms.isFormOpen() || accuracy.isOpen() ? 'form'
    : 'command';
  if (mode === state.mode) return;
  state.mode = mode;
  engine.setMode(mode);
  document.body.dataset.mode = mode;
  setHold(null, 0);
}

/* ---------- Повітряний курсор ---------- */

const CLICKABLE = 'button:not(:disabled), tr[data-id], input, select';
const STICKY = 14; // px: наведення «липне» до елемента, щоб курсор не тремтів між сусідніми клавішами
const RING = 2 * Math.PI * 20;

const openModal = () => document.querySelector('.modal:not([hidden])');

function clickableAt(x, y) {
  return document.elementFromPoint(x, y)?.closest(CLICKABLE) ?? null;
}

// Елемент під курсором (лише у відкритому вікні, якщо воно є).
function pickTarget(x, y) {
  const modal = openModal();
  const current = state.hover;
  if (current?.isConnected && (!modal || modal.contains(current))) {
    const r = current.getBoundingClientRect();
    if (x >= r.left - STICKY && x <= r.right + STICKY && y >= r.top - STICKY && y <= r.bottom + STICKY) return current;
  }
  const el = clickableAt(x, y);
  return el && (!modal || modal.contains(el)) ? el : null;
}

// Клік затримкою: у вікнах (форма, підтвердження) — будь-які кнопки й клавіші, в таблиці — рядки.
function dwellAllowed(el) {
  if (!el || !els.dwell.checked || state.mode === 'paused' || state.mode === 'test') return false;
  return openModal() ? true : el.matches('tr[data-id]');
}

function setCursorRing(progress, kind = 'dwell') {
  els.cursor.dataset.ring = kind;
  els.cursorProgress.style.strokeDashoffset = String(RING * (1 - Math.min(1, Math.max(0, progress))));
}

function moveCursor(nx, ny, t) {
  const x = nx * innerWidth;
  const y = ny * innerHeight;
  state.cursor = { x, y };
  els.cursor.hidden = false;
  els.cursor.style.transform = `translate(${x}px, ${y}px)`;

  const target = pickTarget(x, y);
  if (target !== state.hover) {
    state.hover?.classList.remove('g-hover');
    target?.classList.add('g-hover');
    state.hover = target;
    state.dwell = { since: t, done: false };
  }
  if (state.holding) return; // під час утримання статичного жесту кільце показує його прогрес
  if (!dwellAllowed(target) || state.dwell.done || els.cursor.classList.contains('is-pinched')) return setCursorRing(0);
  const progress = (t - state.dwell.since) / DWELL_MS;
  setCursorRing(progress);
  if (progress >= 1) {
    state.dwell.done = true;
    setCursorRing(0);
    activate(target);
  }
}

function activate(target) {
  els.cursor.classList.remove('is-click');
  void els.cursor.offsetWidth;
  els.cursor.classList.add('is-click');
  if (!target) return;
  if (target.matches('input')) target.focus();
  else target.click();
}

// Щипок — миттєвий клік (і без повторного кліку затримкою по тому самому елементу).
function airClick() {
  state.dwell.done = true;
  setCursorRing(0);
  activate(state.cursor && pickTarget(state.cursor.x, state.cursor.y));
}

function hideCursor() {
  els.cursor.hidden = true;
  state.hover?.classList.remove('g-hover');
  state.hover = null;
  state.cursor = null;
}

/* ---------- Події рушія жестів ---------- */

// Прогрес утримання: кільце в кадрі камери і на курсорі (його видно й поверх форми).
function setHold(pose, progress) {
  const show = Boolean(pose) && progress > 0 && progress < 1;
  state.holding = show;
  els.holdRing.hidden = !show;
  if (!show) {
    setCursorRing(0);
    return;
  }
  els.holdIcon.textContent = HOLD_LABEL[pose] ?? '';
  els.holdRing.querySelector('.progress').style.strokeDashoffset = String(RING * (1 - progress));
  setCursorRing(progress, pose);
}

function handleEvents(events) {
  for (const e of events) {
    switch (e.type) {
      case 'hand':
        if (!e.present) {
          els.poseBadge.textContent = 'Рука не в кадрі';
          hideCursor();
          setHold(null, 0);
        }
        break;
      case 'pose':
        els.poseBadge.textContent = POSES[e.pose] ?? e.pose;
        els.cursorLabel.textContent = POSE_SHORT[e.pose] ?? '';
        break;
      case 'cursor':
        moveCursor(e.x, e.y, e.t);
        break;
      case 'pinch':
        els.cursor.classList.toggle('is-pinched', e.phase === 'down');
        if (e.phase === 'down') {
          if (accuracy.isRunning()) accuracy.record('click');
          else airClick();
        }
        break;
      case 'hold':
        setHold(e.pose, e.progress);
        break;
      case 'confirm':
      case 'cancel':
        setHold(null, 0);
        if (accuracy.isRunning()) accuracy.record(e.type);
        else if (e.type === 'confirm') forms.confirm();
        else forms.cancel();
        break;
      case 'command':
        setHold(null, 0);
        if (accuracy.isRunning()) accuracy.record(e.name);
        else runCommand(e.name, 'gesture');
        break;
    }
  }
}

/* ---------- Кнопки, миша, клавіатура ---------- */

document.querySelectorAll('[data-action]').forEach((b) => b.addEventListener('click', () => runCommand(b.dataset.action, 'mouse')));

// Картки жестів: імітація жесту мишею (зручно, якщо немає камери).
document.querySelectorAll('[data-sim]').forEach((card) =>
  card.addEventListener('click', () => {
    const name = card.dataset.sim;
    if (accuracy.isRunning()) return accuracy.record(name);
    if (name === 'confirm') return forms.confirm();
    if (name === 'cancel') return forms.cancel();
    runCommand(name, 'mouse');
  }),
);

els.pause.addEventListener('click', () => {
  state.paused = !state.paused;
  els.pause.setAttribute('aria-pressed', String(state.paused));
  els.pause.textContent = state.paused ? 'Відновити' : 'Пауза';
  if (state.paused) hideCursor();
  syncMode();
});

$('btn-accuracy').addEventListener('click', () => {
  accuracy.open();
  syncMode();
});
$('acc-close').addEventListener('click', () => syncMode());
$('clear-log').addEventListener('click', () => {
  els.log.replaceChildren();
  els.logEmpty.hidden = false;
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (accuracy.isOpen()) accuracy.stop();
    else forms.cancel();
    syncMode();
  } else if (event.key === 'Enter' && (forms.isFormOpen() || forms.isConfirmOpen()) && !event.target.matches('button')) {
    event.preventDefault();
    forms.confirm();
  }
});

/* ---------- Стан камери та моделі ---------- */

function setStatus(el, text, stateName) {
  el.textContent = text;
  if (stateName) el.dataset.state = stateName;
}

function showCameraMessage(text) {
  els.cameraMessage.textContent = text;
  els.cameraMessage.hidden = false;
}

function onStatus(s) {
  if (s.model === 'loading') setStatus(els.statusModel, 'Модель: завантаження…', 'loading');
  if (s.model === 'ready') setStatus(els.statusModel, `Модель: готова (${s.delegate})`, 'ok');
  if (s.model === 'error') {
    setStatus(els.statusModel, 'Модель: помилка', 'error');
    showCameraMessage(`Не вдалося завантажити модель жестів: ${s.error}. Керувати можна мишею — карткам жестів.`);
  }
  if (s.camera === 'ready') setStatus(els.statusCamera, 'Камера: увімкнена', 'ok');
  if (s.camera === 'error') {
    setStatus(els.statusCamera, 'Камера: немає доступу', 'error');
    showCameraMessage(s.error === 'denied'
      ? 'Доступ до камери заборонено. Дозвольте камеру (значок у адресному рядку) й оновіть сторінку. Поки що можна керувати мишею.'
      : 'Камеру не знайдено. Підключіть камеру й оновіть сторінку. Поки що можна керувати мишею.');
  }
  if (s.fps != null) {
    els.statusFps.textContent = `${s.fps} кадр/с`;
    els.infer.textContent = `Обробка кадру: ${s.inferMs} мс`;
  }
  if (s.light != null) {
    const verdict = s.light < 50 ? 'темно, додайте світла' : s.light > 215 ? 'пересвічено' : 'добре';
    els.light.textContent = `Освітлення: ${verdict}`;
    els.light.dataset.warn = String(s.light < 50 || s.light > 215);
  }
  window.__cameraStatus = { ...window.__cameraStatus, ...s };
}

const onFrame = (frame) => handleEvents(engine.update(frame));

syncMode();
load();

if (TEST_MODE) {
  setStatus(els.statusModel, 'Тестовий режим', 'loading');
  setStatus(els.statusCamera, 'Камера: вимкнена', 'loading');
  window.__gesture = { feed: onFrame, engine, state };
} else {
  import('./camera.js')
    .then(({ startCamera }) => startCamera({ video: els.video, canvas: els.overlay, onFrame, onStatus }))
    .catch((err) => onStatus({ model: 'error', error: err.message }));
}
