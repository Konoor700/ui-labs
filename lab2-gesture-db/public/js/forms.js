// Форма додавання/редагування та діалог підтвердження видалення.
// Щоб вводити дані жестами було легко: швидкий вибір імені/прізвища/посади/зарплати кнопками,
// голосове диктування і віртуальна клавіатура, що відкривається лише за потреби.

const $ = (id) => document.getElementById(id);

const KEY_ROWS = [
  ['й', 'ц', 'у', 'к', 'е', 'н', 'г', 'ш', 'щ', 'з', 'х', 'ї'],
  ['ф', 'і', 'в', 'а', 'п', 'р', 'о', 'л', 'д', 'ж', 'є'],
  ['я', 'ч', 'с', 'м', 'и', 'т', 'ь', 'б', 'ю', "'", '-'],
];
const FIRST_NAMES = ['Олександр', 'Андрій', 'Іван', 'Дмитро', 'Марія', 'Олена', 'Анна', 'Ірина'];
const LAST_NAMES = ['Коваленко', 'Шевченко', 'Бондаренко', 'Ткаченко', 'Мельник', 'Кравченко', 'Лисенко', 'Петренко'];
const DEFAULT_POSITIONS = ['Розробник', 'Менеджер', 'Бухгалтер', 'Дизайнер', 'Тестувальник', 'HR-менеджер'];
const SALARY_PRESETS = [20000, 30000, 40000, 50000];
const money = new Intl.NumberFormat('uk-UA');

const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const titleCase = (s) => s.split(' ').map((w) => w.split('-').map(capitalize).join('-')).join(' ');
const cleanSpeech = (s) => s.replace(/[.,!?;:«»"]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

export function createForms({ onSubmit, onDelete, onClose, onCancel }) {
  const els = {
    modal: $('form-modal'),
    title: $('form-title'),
    name: $('f-name'),
    position: $('f-position'),
    salary: $('f-salary'),
    keyboard: $('keyboard'),
    keyboardToggle: $('keyboard-toggle'),
    save: $('form-save'),
    cancel: $('form-cancel'),
    confirmModal: $('confirm-modal'),
    confirmText: $('confirm-text'),
    confirmYes: $('confirm-yes'),
    confirmNo: $('confirm-no'),
  };

  const state = { mode: null, row: null, salary: 30000, active: 'name', confirmRow: null };

  const button = (label, className, action) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = className;
    b.textContent = label;
    b.addEventListener('click', action);
    return b;
  };

  /* ---------- Активне поле ---------- */

  const field = () => (state.active === 'position' ? els.position : els.name);

  function setActive(name) {
    state.active = name;
    els.modal.querySelectorAll('.field').forEach((f) => f.classList.toggle('is-active', f.dataset.field === name));
  }

  els.name.addEventListener('focus', () => setActive('name'));
  els.position.addEventListener('focus', () => setActive('position'));
  els.modal.querySelectorAll('.field').forEach((f) => f.addEventListener('click', () => setActive(f.dataset.field)));
  els.name.addEventListener('input', () => clearError('name'));
  els.position.addEventListener('input', () => clearError('position'));

  /* ---------- Швидкий вибір ---------- */

  // Ім'я — перше слово, прізвище — решта.
  function setNamePart(part, value) {
    const [first = '', ...rest] = els.name.value.trim().split(/\s+/).filter(Boolean);
    const last = rest.join(' ');
    els.name.value = (part === 'first' ? [value, last] : [first, value]).filter(Boolean).join(' ');
    setActive('name');
    clearError('name');
  }

  for (const n of FIRST_NAMES) $('first-chips').append(button(n, 'chip', () => setNamePart('first', n)));
  for (const n of LAST_NAMES) $('last-chips').append(button(n, 'chip', () => setNamePart('last', n)));
  for (const v of SALARY_PRESETS) $('salary-chips').append(button(`${money.format(v)} ₴`, 'chip salary-chip', () => setSalary(v)));

  function renderPositionChips(positions) {
    const box = $('position-chips');
    box.replaceChildren();
    for (const p of [...new Set([...positions, ...DEFAULT_POSITIONS])].slice(0, 8)) {
      box.append(button(p, 'chip', () => {
        els.position.value = p;
        clearError('position');
      }));
    }
  }

  function setSalary(value) {
    state.salary = Math.min(10_000_000, Math.max(0, value));
    els.salary.textContent = `${money.format(state.salary)} ₴`;
    clearError('salary');
  }
  els.modal.querySelectorAll('[data-step]').forEach((b) =>
    b.addEventListener('click', () => setSalary(state.salary + Number(b.dataset.step))),
  );

  /* ---------- Голосове диктування (гібридний інтерфейс) ---------- */

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  els.modal.querySelectorAll('[data-dictate]').forEach((mic) => {
    if (!SpeechRecognition) {
      mic.hidden = true;
      return;
    }
    mic.addEventListener('click', () => {
      const target = mic.dataset.dictate;
      setActive(target);
      const recognition = new SpeechRecognition();
      recognition.lang = 'uk-UA';
      recognition.maxAlternatives = 1;
      mic.classList.add('is-listening');
      mic.textContent = 'Слухаю…';
      recognition.onresult = (event) => {
        const text = cleanSpeech(event.results[0][0].transcript);
        field().value = target === 'name' ? titleCase(text) : capitalize(text);
        clearError(target);
      };
      recognition.onend = () => {
        mic.classList.remove('is-listening');
        mic.textContent = 'Голос';
      };
      try {
        recognition.start();
      } catch {
        recognition.onend();
      }
    });
  });

  /* ---------- Віртуальна клавіатура ---------- */

  function edit(fn) {
    const input = field();
    input.value = fn(input.value);
    clearError(state.active);
  }

  // Автоматичні великі літери: на початку кожного слова в імені, на початку посади.
  function type(ch) {
    edit((value) => {
      if (ch === ' ' && (value === '' || value.endsWith(' '))) return value;
      const startOfWord = value === '' || (state.active === 'name' && /[\s-]$/.test(value));
      return value + (startOfWord ? ch.toUpperCase() : ch);
    });
  }

  for (const row of KEY_ROWS) {
    const line = document.createElement('div');
    line.className = 'key-row';
    for (const ch of row) {
      const key = button(ch.toUpperCase(), 'key', () => type(ch));
      key.dataset.k = ch;
      line.append(key);
    }
    els.keyboard.append(line);
  }
  const last = document.createElement('div');
  last.className = 'key-row';
  last.append(
    button('Пробіл', 'key wide', () => type(' ')),
    button('⌫', 'key action', () => edit((v) => v.slice(0, -1))),
    button('Очистити', 'key action', () => edit(() => '')),
  );
  els.keyboard.append(last);

  function showKeyboard(show) {
    els.keyboard.hidden = !show;
    els.keyboardToggle.setAttribute('aria-expanded', String(show));
    els.keyboardToggle.textContent = show ? 'Сховати клавіатуру' : 'Клавіатура';
  }
  els.keyboardToggle.addEventListener('click', () => showKeyboard(els.keyboard.hidden));

  /* ---------- Відкриття / збереження ---------- */

  function clearError(name) {
    const el = els.modal.querySelector(`[data-error="${name}"]`);
    if (el) el.textContent = '';
  }

  function showErrors(errors = {}) {
    for (const name of ['name', 'position', 'salary']) {
      els.modal.querySelector(`[data-error="${name}"]`).textContent = errors[name] ?? '';
    }
  }

  function openForm(mode, row, positions) {
    state.mode = mode;
    state.row = row ?? null;
    els.title.textContent = mode === 'add' ? 'Новий працівник' : `Редагування: ${row.name} (ID ${row.id})`;
    els.name.value = row?.name ?? '';
    els.position.value = row?.position ?? '';
    setSalary(row?.salary ?? 30000);
    showErrors();
    renderPositionChips(positions);
    showKeyboard(false);
    setActive('name');
    els.modal.hidden = false;
  }

  // Скасування користувачем (кнопка, жест «палець униз», Esc) — на відміну від закриття після збереження.
  function cancelForm() {
    if (els.modal.hidden) return;
    const mode = state.mode;
    closeForm();
    onCancel?.(mode);
  }

  function closeForm() {
    if (els.modal.hidden) return;
    els.modal.hidden = true;
    state.mode = null;
    onClose();
  }

  async function submit() {
    const employee = { name: els.name.value, position: els.position.value, salary: state.salary };
    const result = await onSubmit(state.mode, state.row, employee);
    if (result.ok) closeForm();
    else showErrors(result.errors);
  }

  els.save.addEventListener('click', submit);
  els.cancel.addEventListener('click', cancelForm);

  /* ---------- Підтвердження видалення ---------- */

  function openConfirm(row) {
    state.confirmRow = row;
    els.confirmText.textContent = `Видалити працівника ${row.name} (ID ${row.id})?`;
    els.confirmModal.hidden = false;
  }

  function closeConfirm() {
    if (els.confirmModal.hidden) return;
    els.confirmModal.hidden = true;
    state.confirmRow = null;
    onClose();
  }

  els.confirmYes.addEventListener('click', async () => {
    const row = state.confirmRow;
    closeConfirm();
    if (row) await onDelete(row);
  });
  els.confirmNo.addEventListener('click', () => {
    if (els.confirmModal.hidden) return;
    closeConfirm();
    onCancel?.('delete');
  });

  return {
    openForm,
    openConfirm,
    isFormOpen: () => !els.modal.hidden,
    isConfirmOpen: () => !els.confirmModal.hidden,
    // великий палець угору / униз — залежно від того, що відкрито
    confirm: () => (!els.confirmModal.hidden ? els.confirmYes.click() : !els.modal.hidden && submit()),
    cancel: () => (!els.confirmModal.hidden ? els.confirmNo.click() : cancelForm()),
  };
}
