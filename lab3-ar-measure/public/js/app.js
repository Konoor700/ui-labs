// Головний модуль: зв'язує симулятор / справжній AR, поточний вимір, 3D-шар та інтерфейс.
import { Measurement } from './measurement.js';
import { resultLine, formatLength, formatArea, accuracyPercent, findSnap } from './geometry.js';
import { MeasureLayer, placeReticle, setReticleSnapped } from './layer.js';
import { Simulator } from './sim/simulator.js';
import { REFERENCES, LIGHTING } from './sim/tracking.js';
import { isArSupported, WebXRSession } from './xr/webxr.js';
import { api } from './api.js';

const $ = (id) => document.getElementById(id);
// ?test — режим автотестів: трекінг оновлюється лише кроками з тесту, генератор похибки детермінований.
const TEST_MODE = new URLSearchParams(location.search).has('test');

const els = {
  view: $('view'),
  overlay: $('overlay'),
  strip: $('point-strip'),
  hint: $('hint'),
  notice: $('notice'),
  result: $('result'),
  resultExtra: $('result-extra'),
  menu: $('edit-menu'),
  menuTitle: $('menu-title'),
  editButton: $('btn-edit'),
  addButton: $('btn-add'),
  modeStatus: $('mode-status'),
  fps: $('fps'),
  arButton: $('btn-ar'),
  exitAr: $('btn-exit-ar'),
  drawer: $('saved-drawer'),
  savedList: $('saved-list'),
  savedEmpty: $('saved-empty'),
};

const measurement = new Measurement();
const state = { selectedId: null, unit: 'cm', mode: 'sim', lastHit: null, xr: null, previewKey: '', hintText: '', accuracyLog: [], snap: true };

const sim = new Simulator({ canvas: els.view, autoUpdate: !TEST_MODE, seed: TEST_MODE ? 12345 : Date.now() });
let layer = new MeasureLayer(sim.scene);

/* ---------- Відображення виміру ---------- */

function render() {
  const { points, closed } = measurement;
  if (state.selectedId && !points.some((p) => p.id === state.selectedId)) state.selectedId = null;

  els.strip.replaceChildren(...points.map((p, i) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = String(i + 1);
    b.title = `Точка ${i + 1}`;
    b.setAttribute('aria-pressed', String(p.id === state.selectedId));
    b.addEventListener('click', () => {
      state.selectedId = state.selectedId === p.id ? null : p.id;
      render();
    });
    li.append(b);
    return li;
  }));

  const summary = measurement.summary();
  els.result.textContent = points.length === 0 ? 'Поставте першу точку'
    : points.length === 1 ? 'Поставте ще одну точку'
    : resultLine(summary, state.unit);
  els.resultExtra.textContent = !closed ? ''
    : summary.area != null ? `площа ${formatArea(summary.area)}`
    : 'контур не плоский — площу не пораховано';

  layer.unit = state.unit;
  layer.update(measurement, state.selectedId);
  state.previewKey = null; // примусово перемалювати прев'ю в наступному кадрі (зокрема прибрати його)
  updateMenu();
}

function updateMenu() {
  const { points, closed } = measurement;
  const index = points.findIndex((p) => p.id === state.selectedId);
  els.menuTitle.textContent = index >= 0 ? `Точка ${index + 1} з ${points.length}` : `Вимір: ${points.length} точок`;
  const cmd = (name) => els.menu.querySelector(`[data-cmd="${name}"]`);
  cmd('delete').textContent = index >= 0 ? 'Видалити вибрану точку' : 'Видалити останню точку';
  cmd('delete').disabled = !points.length;
  cmd('up').disabled = index <= 0;
  cmd('down').disabled = index < 0 || index === points.length - 1;
  cmd('close').textContent = closed ? 'Розімкнути контур' : 'Замкнути контур';
  cmd('close').disabled = points.length < 3;
  cmd('undo').disabled = !measurement.history.length;
  cmd('clear').disabled = !points.length;
  cmd('save').disabled = points.length < 2;
}

measurement.onChange(render);

let noticeTimer = 0;
function notice(text, status = 'warn') {
  els.notice.textContent = text;
  els.notice.dataset.status = status;
  els.notice.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (els.notice.hidden = true), 3200);
}

/* ---------- Точки ---------- */

function currentHit() {
  return state.mode === 'xr' ? state.lastHit : sim.hitTest(0, 0);
}

// Прилипання: якщо приціл ближче 6 см до наявної точки, беремо точно її координати.
function applySnap(hit) {
  if (!hit?.ok || !state.snap) return hit;
  const snap = findSnap(measurement.points, hit.point);
  return snap ? { ...hit, point: { x: snap.point.x, y: snap.point.y, z: snap.point.z }, snap } : hit;
}

function addPoint(rawHit) {
  const hit = applySnap(rawHit);
  if (!hit?.ok) return notice(hit?.reason ?? 'Наведіть приціл на поверхню.');
  const count = measurement.points.length;
  if (hit.snap) {
    const { index } = hit.snap;
    if (index === count - 1) return notice('Тут уже є остання точка — відведіть приціл далі.');
    if (index === 0) {
      // Повернулися до першої точки — замикаємо контур, а не дублюємо точку.
      if (count < 3) return notice('Щоб замкнути контур, потрібно щонайменше 3 точки.');
      if (measurement.closed) return notice('Контур уже замкнено.');
      measurement.setClosed(true);
      return notice('Контур замкнено: остання точка з’єднана з першою.', 'ok');
    }
  }
  const result = measurement.add(hit.point, hit.surface);
  if (!result.ok) return notice(result.reason);
  if (hit.snap) notice(`Точку приєднано до точки ${hit.snap.index + 1}.`, 'ok');
  state.selectedId = null;
  render();
}

function snapHint(snap) {
  const count = measurement.points.length;
  if (snap.index === 0 && count >= 3 && !measurement.closed) return 'Приціл біля точки 1 — натисніть, щоб замкнути контур.';
  if (snap.index === count - 1) return `Приціл на останній точці (${count}) — відведіть його далі.`;
  return `Прилипання до точки ${snap.index + 1}.`;
}

// Щокадрово: прилипання, підказка та пунктирна лінія від останньої точки до прицілу.
function onFrame(rawHit) {
  state.lastHit = rawHit;
  const hit = applySnap(rawHit);
  const reticle = state.mode === 'xr' ? state.xr?.reticle : sim.reticle;
  if (reticle) setReticleSnapped(reticle, Boolean(hit.snap));
  if (hit.snap && state.mode === 'sim') placeReticle(sim.reticle, hit.point, hit.normal);
  layer.setSnap(hit.snap ? hit.point : null);

  const text = !hit.ok ? hit.reason
    : hit.snap ? snapHint(hit.snap)
    : `Приціл: ${hit.label}. Натисніть «+» або Пробіл, щоб поставити точку.`;
  if (text !== state.hintText) {
    state.hintText = text;
    els.hint.textContent = text;
    els.hint.dataset.ok = String(hit.ok);
  }
  const last = measurement.points.at(-1);
  const onLast = hit.snap && hit.snap.index === measurement.points.length - 1;
  const key = hit.ok && last && !onLast ? `${last.id}|${Math.round(hit.point.x * 500)}|${Math.round(hit.point.y * 500)}|${Math.round(hit.point.z * 500)}|${state.unit}` : '';
  if (key !== state.previewKey) {
    state.previewKey = key;
    layer.setPreview(key ? last : null, key ? hit.point : null);
  }
}

sim.on('frame', (hit) => state.mode === 'sim' && onFrame(hit));
sim.on('click', (ndc) => state.mode === 'sim' && addPoint(sim.hitTest(ndc.x, ndc.y)));
sim.on('detect', (s) => notice(`Знайдено поверхню: ${s.label}`, 'ok'));
sim.on('stats', ({ fps }) => (els.fps.textContent = `${fps} кадр/с`));

/* ---------- Меню редагування ---------- */

function toggleMenu(open = els.menu.hidden) {
  els.menu.hidden = !open;
  els.editButton.setAttribute('aria-expanded', String(open));
  if (open) updateMenu();
}

const commands = {
  delete() {
    const id = state.selectedId ?? measurement.points.at(-1)?.id;
    if (id) measurement.remove(id);
  },
  deleteLast() {
    const last = measurement.points.at(-1);
    if (!last) return notice('Точок ще немає.');
    measurement.remove(last.id);
  },
  up: () => measurement.move(state.selectedId, -1),
  down: () => measurement.move(state.selectedId, 1),
  close() {
    if (!measurement.setClosed(!measurement.closed)) notice('Щоб замкнути контур, потрібно щонайменше 3 точки.');
  },
  undo() {
    if (!measurement.undo()) notice('Немає дій для скасування.');
  },
  clear: () => measurement.clear(),
  save: () => openSave(),
  accuracy: () => openAccuracy(),
};

els.menu.addEventListener('click', (e) => {
  const button = e.target.closest('[data-cmd]');
  if (!button || button.disabled) return;
  commands[button.dataset.cmd]();
  if (['save', 'accuracy', 'clear'].includes(button.dataset.cmd)) toggleMenu(false);
  else updateMenu();
});
els.editButton.addEventListener('click', () => toggleMenu());
els.addButton.addEventListener('click', () => addPoint(currentHit()));
$('btn-delete-last').addEventListener('click', () => commands.deleteLast());

document.querySelectorAll('[data-unit]').forEach((b) => b.addEventListener('click', () => {
  state.unit = b.dataset.unit;
  document.querySelectorAll('[data-unit]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  render();
}));

/* ---------- Налаштування симулятора ---------- */

$('opt-lighting').addEventListener('change', (e) => {
  sim.setLighting(e.target.value);
  if (e.target.value === 'dark') notice('Темно: трекінг призупинено, нові точки ставити не можна.');
});
$('opt-noise').addEventListener('change', (e) => sim.setNoise(e.target.checked));
$('opt-planes').addEventListener('change', (e) => sim.setPlanesVisible(e.target.checked));
$('opt-snap').addEventListener('change', (e) => {
  state.snap = e.target.checked;
  state.previewKey = null;
});

/* ---------- Діалоги ---------- */

const openModal = (id) => ($(id).hidden = false);
const closeModals = () => document.querySelectorAll('.modal').forEach((m) => (m.hidden = true));
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeModals));
$('btn-help').addEventListener('click', () => openModal('help-modal'));

// Збереження.
function openSave() {
  if (measurement.points.length < 2) return notice('Для збереження потрібно щонайменше 2 точки.');
  const summary = measurement.summary();
  $('save-name').value = `Вимір ${new Date().toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' })}`;
  $('save-summary').textContent = `${measurement.points.length} точок · ${resultLine(summary, state.unit)}${summary.area != null ? ` · площа ${formatArea(summary.area)}` : ''}`;
  $('save-error').textContent = '';
  openModal('save-modal');
  $('save-name').select();
}

$('save-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const { ok, data } = await api.create({
    name: $('save-name').value,
    points: measurement.points.map(({ x, y, z }) => ({ x, y, z })),
    closed: measurement.closed,
    source: state.mode === 'xr' ? 'webxr' : 'sim',
  });
  if (!ok) {
    $('save-error').textContent = data.errors ? Object.values(data.errors).join(' ') : data.message;
    return;
  }
  closeModals();
  notice(data.message, 'ok');
  if (!els.drawer.hidden) loadSaved();
});

// Збережені виміри.
async function loadSaved() {
  const { ok, data } = await api.list();
  if (!ok) return notice(data.message, 'error');
  els.savedEmpty.hidden = data.rows.length > 0;
  els.savedList.replaceChildren(...data.rows.map((row) => {
    const li = document.createElement('li');
    const name = document.createElement('b');
    name.textContent = row.name;
    const info = document.createElement('span');
    info.className = 'dim';
    info.textContent = `${formatLength(row.total_m, state.unit)}${row.area_m2 != null ? ` · ${formatArea(row.area_m2)}` : ''} · ${row.points.length} точ. · ${row.source === 'webxr' ? 'AR' : 'симулятор'} · ${row.created_at}`;
    const actions = document.createElement('div');
    actions.className = 'actions';
    const open = document.createElement('button');
    open.className = 'link';
    open.type = 'button';
    open.textContent = 'показати';
    open.addEventListener('click', () => {
      measurement.load(row.points, row.closed);
      notice(`Відкрито: ${row.name}`, 'ok');
    });
    const remove = document.createElement('button');
    remove.className = 'link';
    remove.type = 'button';
    remove.textContent = 'видалити';
    remove.addEventListener('click', async () => {
      const res = await api.remove(row.id);
      notice(res.data.message, res.ok ? 'ok' : 'error');
      loadSaved();
    });
    actions.append(open, remove);
    li.append(name, info, actions);
    return li;
  }));
}

$('btn-saved').addEventListener('click', () => {
  els.drawer.hidden = !els.drawer.hidden;
  if (!els.drawer.hidden) loadSaved();
});
$('saved-close').addEventListener('click', () => (els.drawer.hidden = true));

// Перевірка точності.
const refSelect = $('acc-ref');
refSelect.replaceChildren(...REFERENCES.map((r) => new Option(`${r.label} — ${formatLength(r.meters)}`, r.id)));

function currentCheck() {
  const ref = REFERENCES.find((r) => r.id === refSelect.value);
  const measured = measurement.points.length >= 2 ? measurement.summary().total : null;
  return { ref, measured, accuracy: measured == null ? null : accuracyPercent(measured, ref.meters) };
}

function updateAccuracy() {
  const { ref, measured, accuracy } = currentCheck();
  $('acc-reference').textContent = formatLength(ref.meters);
  $('acc-measured').textContent = measured == null ? 'немає виміру (потрібно 2 точки)' : formatLength(measured);
  $('acc-error').textContent = measured == null ? '—' : `${(measured - ref.meters) * 100 >= 0 ? '+' : '−'}${Math.abs((measured - ref.meters) * 100).toFixed(1).replace('.', ',')} см`;
  $('acc-percent').textContent = accuracy == null ? '—' : `${accuracy.toFixed(1).replace('.', ',')} %`;
}

function renderAccuracyLog() {
  $('acc-log').replaceChildren(...state.accuracyLog.map((r) => {
    const tr = document.createElement('tr');
    for (const [text, cls] of [[r.label], [r.lighting], [formatLength(r.reference), 'num'], [formatLength(r.measured), 'num'], [`${r.accuracy.toFixed(1).replace('.', ',')} %`, 'num']]) {
      const td = document.createElement('td');
      td.textContent = text;
      if (cls) td.className = cls;
      tr.append(td);
    }
    return tr;
  }));
  const avg = state.accuracyLog.length ? state.accuracyLog.reduce((s, r) => s + r.accuracy, 0) / state.accuracyLog.length : null;
  $('acc-average').textContent = avg == null ? '' : `середня точність ${avg.toFixed(1).replace('.', ',')} %`;
}

function openAccuracy() {
  updateAccuracy();
  renderAccuracyLog();
  openModal('accuracy-modal');
}

refSelect.addEventListener('change', updateAccuracy);
$('acc-record').addEventListener('click', () => {
  const { ref, measured, accuracy } = currentCheck();
  if (measured == null) return notice('Спочатку виміряйте об’єкт: поставте 2 точки.');
  state.accuracyLog.push({ label: ref.label, lighting: LIGHTING[sim.lighting].label, reference: ref.meters, measured, accuracy });
  renderAccuracyLog();
});
$('acc-copy').addEventListener('click', async () => {
  const rows = state.accuracyLog.map((r) => `| ${r.label} | ${r.lighting} | ${formatLength(r.reference)} | ${formatLength(r.measured)} | ${r.accuracy.toFixed(1).replace('.', ',')} % |`);
  const text = ['| Об’єкт | Освітлення | Еталон | Виміряно | Точність |', '|---|---|---|---|---|', ...rows].join('\n');
  try {
    await navigator.clipboard.writeText(text);
    notice('Таблицю скопійовано.', 'ok');
  } catch {
    notice('Не вдалося скопіювати таблицю.', 'error');
  }
});

/* ---------- Справжній AR (WebXR) ---------- */

async function startAr() {
  if (measurement.points.length) measurement.clear(); // точки симулятора не мають сенсу в реальному просторі
  const xr = new WebXRSession({
    overlay: els.overlay,
    onFrame: (hit) => onFrame(hit),
    onSelect: (hit) => addPoint(hit),
    onEnd: () => {
      state.mode = 'sim';
      state.xr = null;
      layer = new MeasureLayer(sim.scene);
      els.exitAr.hidden = true;
      els.modeStatus.textContent = 'Режим: симулятор';
      els.modeStatus.dataset.state = 'ok';
      measurement.clear();
      render();
    },
  });
  try {
    const scene = await xr.start();
    state.xr = xr;
    state.mode = 'xr';
    layer = new MeasureLayer(scene);
    els.exitAr.hidden = false;
    els.modeStatus.textContent = 'Режим: AR (камера)';
    els.modeStatus.dataset.state = 'ar';
    render();
  } catch (err) {
    notice(`Не вдалося запустити AR: ${err.message}`, 'error');
  }
}

els.arButton.addEventListener('click', startAr);
els.exitAr.addEventListener('click', () => state.xr?.end());
// Дотики до кнопок інтерфейсу в AR не повинні ставити точку.
els.overlay.addEventListener('beforexrselect', (e) => {
  if (e.target.closest('button, select, input, .menu, .point-strip, .resultbar')) e.preventDefault();
});

isArSupported().then((supported) => {
  els.arButton.hidden = !supported;
});

/* ---------- Клавіатура ---------- */

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select')) return;
  const modalOpen = [...document.querySelectorAll('.modal')].some((m) => !m.hidden);
  if (e.key === 'Escape') {
    closeModals();
    toggleMenu(false);
    return;
  }
  if (modalOpen) return;
  if (e.code === 'Space') {
    e.preventDefault();
    addPoint(currentHit());
  } else if (e.key === 'Backspace') {
    e.preventDefault();
    commands.deleteLast();
  } else if (e.key === 'Delete') {
    commands.delete();
  } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
    e.preventDefault();
    commands.undo();
  } else if (e.code === 'KeyC' && !e.ctrlKey) {
    commands.close();
  }
});

/* ---------- Старт ---------- */

render();
sim.start();
if (!TEST_MODE) {
  try {
    if (!localStorage.getItem('ar-help-seen')) {
      openModal('help-modal');
      localStorage.setItem('ar-help-seen', '1');
    }
  } catch {
    /* localStorage недоступний — довідку просто не показуємо автоматично */
  }
}

if (TEST_MODE) window.__ar = { sim, measurement, state, addAtCenter: () => addPoint(sim.hitTest(0, 0)), get layer() { return layer; } };
