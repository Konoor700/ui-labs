// Режим перевірки точності: система просить показати жести по черзі й рахує влучання,
// помилки (розпізнано інший жест) та пропуски (за відведений час жест не розпізнано).

const $ = (id) => document.getElementById(id);

export const TARGETS = [
  { id: 'select_all', icon: '✌️', name: 'V-жест (утримати)' },
  { id: 'add', icon: '✊→☝️', name: 'Кулак, потім вказівний палець' },
  { id: 'update', icon: '☝️🔄', name: 'Коло вказівним пальцем' },
  { id: 'delete', icon: '👋↔️', name: 'Мах долонею вбік' },
  { id: 'click', icon: '👌', name: 'Щипок (жест «OK»)' },
  { id: 'confirm', icon: '👍', name: 'Великий палець угору (утримати)' },
  { id: 'cancel', icon: '👎', name: 'Великий палець униз (утримати)' },
];
const TRIAL_MS = 6000;
const PAUSE_MS = 1500;

// Підсумки: по кожному жесту — влучання, помилки, пропуски, середній час.
export function summarize(trials) {
  const rows = TARGETS.map((target) => {
    const own = trials.filter((t) => t.target === target.id);
    const hits = own.filter((t) => t.result === 'hit');
    return {
      ...target,
      total: own.length,
      hits: hits.length,
      wrong: own.filter((t) => t.result === 'wrong').length,
      missed: own.filter((t) => t.result === 'miss').length,
      avgMs: hits.length ? Math.round(hits.reduce((s, t) => s + t.ms, 0) / hits.length) : null,
    };
  }).filter((r) => r.total);
  const total = rows.reduce((s, r) => s + r.total, 0);
  const hits = rows.reduce((s, r) => s + r.hits, 0);
  return { rows, total, hits, accuracy: total ? hits / total : 0 };
}

export function toMarkdown(summary, conditions) {
  const pct = (a, b) => (b ? `${Math.round((a / b) * 100)} %` : '—');
  const lines = [
    `Умови: ${conditions}`,
    '',
    '| Жест | Успішно | Помилково | Пропущено | Точність | Сер. час |',
    '|---|---|---|---|---|---|',
    ...summary.rows.map((r) => `| ${r.name} | ${r.hits}/${r.total} | ${r.wrong} | ${r.missed} | ${pct(r.hits, r.total)} | ${r.avgMs != null ? `${(r.avgMs / 1000).toFixed(1)} с` : '—'} |`),
    `| **Разом** | **${summary.hits}/${summary.total}** | | | **${pct(summary.hits, summary.total)}** | |`,
  ];
  return lines.join('\n');
}

export function createAccuracyTest({ onStart, onStop }) {
  const els = {
    modal: $('accuracy-modal'),
    setup: $('acc-setup'),
    run: $('acc-run'),
    results: $('acc-results'),
    trials: $('acc-trials'),
    conditions: $('acc-conditions'),
    icon: $('acc-icon'),
    name: $('acc-name'),
    progress: $('acc-progress'),
    timer: $('acc-timer-bar'),
    feedback: $('acc-feedback'),
    start: $('acc-start'),
    close: $('acc-close'),
    copy: $('acc-copy'),
  };
  let queue = [];
  let trials = [];
  let current = null;
  let timer = 0;
  let markdown = '';

  const shuffle = (list) => list.map((v) => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(([, v]) => v);

  function open() {
    els.setup.hidden = false;
    els.run.hidden = true;
    els.results.hidden = true;
    els.copy.hidden = true;
    els.start.hidden = false;
    els.start.textContent = 'Почати';
    els.modal.hidden = false;
  }

  function start() {
    const n = Number(els.trials.value);
    queue = shuffle(TARGETS.flatMap((t) => Array.from({ length: n }, () => t)));
    trials = [];
    els.setup.hidden = true;
    els.results.hidden = true;
    els.copy.hidden = true;
    els.start.hidden = true;
    els.run.hidden = false;
    onStart();
    next();
  }

  function next() {
    clearTimeout(timer);
    current = null;
    if (!queue.length) return finish();
    const target = queue.shift();
    els.icon.textContent = target.icon;
    els.name.textContent = target.name;
    els.progress.textContent = `Спроба ${trials.length + 1} з ${trials.length + queue.length + 1}`;
    els.feedback.textContent = 'Опустіть руку… приготуйтесь';
    els.feedback.dataset.result = '';
    els.timer.style.transition = 'none';
    els.timer.style.width = '100%';
    // Коротка пауза між спробами, щоб попередній рух не зарахувався в наступну.
    timer = setTimeout(() => {
      current = { target: target.id, since: performance.now() };
      els.feedback.textContent = 'Покажіть жест!';
      void els.timer.offsetWidth;
      els.timer.style.transition = `width ${TRIAL_MS}ms linear`;
      els.timer.style.width = '0%';
      timer = setTimeout(() => record(null), TRIAL_MS);
    }, PAUSE_MS);
  }

  // Подія від рушія жестів: назва команди або 'click' / 'confirm' / 'cancel'.
  function record(detected) {
    if (!current) return;
    const ms = Math.round(performance.now() - current.since);
    const result = detected === null ? 'miss' : detected === current.target ? 'hit' : 'wrong';
    trials.push({ target: current.target, detected, result, ms });
    const label = TARGETS.find((t) => t.id === detected)?.name;
    els.feedback.textContent = { hit: `Розпізнано за ${(ms / 1000).toFixed(1)} с`, wrong: `Помилка: розпізнано інший жест — ${label}`, miss: 'Жест не розпізнано' }[result];
    els.feedback.dataset.result = result;
    current = null;
    clearTimeout(timer);
    timer = setTimeout(next, 900);
  }

  function finish() {
    onStop();
    const summary = summarize(trials);
    markdown = toMarkdown(summary, els.conditions.value.trim() || '—');
    els.run.hidden = true;
    els.results.hidden = false;
    els.copy.hidden = false;
    els.start.hidden = false;
    els.start.textContent = 'Ще раз';
    els.setup.hidden = false;

    const table = document.createElement('table');
    table.innerHTML = '<thead><tr><th>Жест</th><th class="num">Успішно</th><th class="num">Помилково</th><th class="num">Пропущено</th><th class="num">Сер. час</th></tr></thead>';
    const body = document.createElement('tbody');
    for (const r of summary.rows) {
      const tr = document.createElement('tr');
      for (const [text, cls] of [[`${r.icon}  ${r.name}`], [`${r.hits}/${r.total}`, 'num'], [r.wrong, 'num'], [r.missed, 'num'], [r.avgMs != null ? `${(r.avgMs / 1000).toFixed(1)} с` : '—', 'num']]) {
        const td = document.createElement('td');
        td.textContent = text;
        if (cls) td.className = cls;
        tr.append(td);
      }
      body.append(tr);
    }
    table.append(body);
    const total = document.createElement('p');
    total.className = 'acc-total';
    total.textContent = `Загальна точність: ${Math.round(summary.accuracy * 100)} % (${summary.hits} з ${summary.total})`;
    els.results.replaceChildren(total, table);
  }

  function stop() {
    clearTimeout(timer);
    const wasRunning = !els.run.hidden;
    current = null;
    queue = [];
    els.modal.hidden = true;
    if (wasRunning) onStop();
  }

  els.start.addEventListener('click', start);
  els.close.addEventListener('click', stop);
  els.copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      els.copy.textContent = 'Скопійовано';
    } catch {
      els.copy.textContent = 'Не вдалося скопіювати';
    }
    setTimeout(() => (els.copy.textContent = 'Копіювати таблицю'), 1500);
  });

  return { open, stop, record, isOpen: () => !els.modal.hidden, isRunning: () => !els.run.hidden };
}
