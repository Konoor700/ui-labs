// Виконання розібраної команди над базою даних + формування відповіді для екрана та озвучення.
import { parseCommand } from './parser.js';

const MAX_SALARY = 10_000_000;
const FIELD_LABELS = {
  name: "ім'я та прізвище", firstName: "ім'я", lastName: 'прізвище', position: 'посаду', salary: 'зарплату',
};
const VALUE_QUESTIONS = {
  name: "Яке нове ім'я та прізвище", firstName: "Яке нове ім'я", lastName: 'Яке нове прізвище',
  position: 'Яка нова посада', salary: 'Яка нова зарплата',
};

// Замінює в повному імені лише ім'я (перше слово) або лише прізвище (останнє слово).
function replaceNamePart(fullName, part, value) {
  if (part === 'firstName' && value.includes(' ')) return value; // «зміни ім'я на Петро Петренко» — повне ім'я
  const words = fullName.split(' ');
  if (part === 'firstName') words[0] = value;
  else if (words.length > 1) words[words.length - 1] = value;
  else words.push(value);
  return words.join(' ');
}

export function plural(n, [one, few, many]) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

const employeesWord = (n) => `${n} ${plural(n, ['працівник', 'працівники', 'працівників'])}`;
const describe = (r) => `${r.name}, посада ${r.position.toLowerCase()}${r.salary != null ? `, зарплата ${r.salary} гривень` : ''}`;

export const HELP_TEXT =
  'Я розумію такі команди: «Покажи всіх працівників», «Знайди працівника Андрій Шевченко», ' +
  '«Покажи працівників із зарплатою більше 30000», «Додай працівника Іван Іванов на посаду менеджер», ' +
  '«Онови посаду працівника Іван Іванов на менеджер», «Зміни прізвище працівника 1 на Петренко», «Видали працівника з ідентифікатором 5», «Скільки працівників».';

// Знаходить рівно одного працівника за id або ім'ям.
function resolveOne(repo, target) {
  if (target.id != null) {
    const row = repo.byId(target.id);
    return row ? { row } : { error: `Працівника з ідентифікатором ${target.id} не знайдено.` };
  }
  const rows = repo.byName(target.name);
  if (rows.length === 0) return { error: `Працівника на ім'я «${target.name}» не знайдено.` };
  if (rows.length > 1) {
    const ids = rows.map((r) => r.id).join(', ');
    return { error: `Знайдено кілька працівників з таким ім'ям (ідентифікатори ${ids}). Уточніть ідентифікатор.`, rows };
  }
  return { row: rows[0] };
}

function validate(field, value) {
  if (field === 'salary') return Number.isInteger(value) && value >= 0 && value <= MAX_SALARY;
  return typeof value === 'string' && value.length >= 2 && value.length <= 80;
}

function execute(repo, cmd, confirmed) {
  const fail = (message, extra = {}) => ({ ok: false, message, ...extra });

  switch (cmd.intent) {
    case 'help':
      return { ok: true, message: HELP_TEXT };

    case 'count': {
      const n = repo.count();
      return { ok: true, message: `У базі ${employeesWord(n)}.` };
    }

    case 'select_all': {
      const rows = repo.all();
      return { ok: true, message: `Знайдено ${employeesWord(rows.length)}.`, title: 'Усі працівники', rows };
    }

    case 'select': {
      const { filter } = cmd;
      let rows;
      let title;
      if (filter.id != null) {
        const row = repo.byId(filter.id);
        rows = row ? [row] : [];
        title = `Ідентифікатор ${filter.id}`;
      } else if (filter.name) {
        rows = repo.byName(filter.name);
        title = `Пошук за ім'ям: ${filter.name}`;
      } else if (filter.position) {
        rows = repo.byPosition(filter.position);
        title = `Посада: ${filter.position}`;
      } else {
        const { op, value } = filter.salary;
        const opText = { eq: '=', gt: '>', gte: '≥', lt: '<', lte: '≤' }[op];
        rows = repo.bySalary(op, value);
        title = `Зарплата ${opText} ${value} грн`;
      }
      if (rows.length === 0) return { ok: true, message: 'Нічого не знайдено.', title, rows };
      const message = rows.length === 1 ? `Знайдено: ${describe(rows[0])}.` : `Знайдено ${employeesWord(rows.length)}.`;
      return { ok: true, message, title, rows };
    }

    case 'insert': {
      if (!validate('name', cmd.name)) return fail("Ім'я має містити від 2 до 80 символів.");
      if (cmd.position && !validate('position', cmd.position)) return fail('Назва посади має містити від 2 до 80 символів.');
      if (cmd.salary != null && !validate('salary', cmd.salary)) return fail('Некоректна зарплата.');
      const row = repo.insert(cmd);
      return {
        ok: true,
        message: `Додано працівника ${row.name} з ідентифікатором ${row.id}.`,
        title: 'Усі працівники',
        rows: repo.all(),
        highlight: [row.id],
      };
    }

    case 'update': {
      const found = resolveOne(repo, cmd.target);
      if (found.error) return fail(found.error, found.rows ? { rows: found.rows, title: 'Кілька збігів' } : {});
      const { row } = found;

      // Нове значення не назвали — питаємо його (клієнт допише відповідь як «… на <значення>»).
      if (cmd.value == null) {
        const message = `${VALUE_QUESTIONS[cmd.field]} для працівника ${row.name}?`;
        return { ok: true, needsValue: true, message, title: 'Оновлення запису', rows: [row], highlight: [row.id] };
      }

      const isNamePart = cmd.field === 'firstName' || cmd.field === 'lastName';
      const column = isNamePart ? 'name' : cmd.field;
      const value = isNamePart ? replaceNamePart(row.name, cmd.field, cmd.value) : cmd.value;
      if (!validate(column, value)) return fail('Некоректне нове значення.');
      const updated = repo.update(row.id, column, value);
      const message = column === 'name'
        ? `Змінено ${FIELD_LABELS[cmd.field]} працівника ${row.name}. Тепер: ${updated.name}.`
        : `Оновлено ${FIELD_LABELS[cmd.field]} працівника ${row.name}: ${updated[column]}.`;
      return { ok: true, message, title: 'Усі працівники', rows: repo.all(), highlight: [row.id] };
    }

    case 'delete': {
      const found = resolveOne(repo, cmd.target);
      if (found.error) return fail(found.error, found.rows ? { rows: found.rows, title: 'Кілька збігів' } : {});
      const { row } = found;
      if (!confirmed) {
        return {
          ok: true,
          needsConfirmation: true,
          message: `Видалити працівника ${row.name} з ідентифікатором ${row.id}? Скажіть «так» або «ні».`,
          // Коротка фраза для озвучення: поки вона звучить, мікрофон вимкнено, тож що коротше — то швидше можна відповісти.
          speech: `Видалити ${row.name}? Так чи ні?`,
          title: 'Підтвердження видалення',
          rows: [row],
          highlight: [row.id],
        };
      }
      repo.remove(row.id);
      return { ok: true, message: `Працівника ${row.name} видалено.`, title: 'Усі працівники', rows: repo.all() };
    }

    case 'invalid':
      return fail(cmd.reason);

    default:
      return fail(`Не вдалося розпізнати команду «${cmd.text}». Скажіть «допомога», щоб почути приклади.`);
  }
}

// candidates — основний варіант розпізнавання та альтернативи від Speech API.
// Беремо перший, що розпізнався як коректна команда.
export function handleCommand(repo, candidates, { confirmed = false } = {}) {
  const parsed = candidates.map((text) => ({ text, cmd: parseCommand(text) }));
  const best =
    parsed.find((p) => p.cmd.intent !== 'unknown' && p.cmd.intent !== 'invalid') ??
    parsed.find((p) => p.cmd.intent === 'invalid') ??
    parsed[0];
  return { recognized: best.text, intent: best.cmd.intent, ...execute(repo, best.cmd, confirmed) };
}
