// Перетворення розпізнаного тексту на структуровану команду.
// Етапи: нормалізація -> заміна числівників цифрами -> зіставлення з шаблонами (regex).

const UNITS = {
  'нуль': 0, 'один': 1, 'одна': 1, 'одне': 1, 'одного': 1, 'два': 2, 'дві': 2, 'двох': 2,
  'три': 3, 'трьох': 3, 'чотири': 4, 'чотирьох': 4, "п'ять": 5, "п'яти": 5, 'шість': 6, 'шести': 6,
  'сім': 7, 'семи': 7, 'вісім': 8, 'восьми': 8, "дев'ять": 9, "дев'яти": 9, 'десять': 10, 'десяти': 10,
  'одинадцять': 11, 'дванадцять': 12, 'тринадцять': 13, 'чотирнадцять': 14, "п'ятнадцять": 15,
  'шістнадцять': 16, 'сімнадцять': 17, 'вісімнадцять': 18, "дев'ятнадцять": 19,
  'двадцять': 20, 'тридцять': 30, 'сорок': 40, "п'ятдесят": 50, 'шістдесят': 60, 'сімдесят': 70,
  'вісімдесят': 80, "дев'яносто": 90, 'сто': 100, 'двісті': 200, 'триста': 300, 'чотириста': 400,
  "п'ятсот": 500, 'шістсот': 600, 'сімсот': 700, 'вісімсот': 800, "дев'ятсот": 900,
};
const THOUSAND = new Set(['тисяча', 'тисячі', 'тисяч']);

// «двадцять п'ять тисяч» -> «25000», «30 тисяч» -> «30000».
export function wordsToNumbers(text) {
  const out = [];
  let total = null;
  let current = 0;
  const flush = () => {
    if (total !== null) out.push(String(total + current));
    total = null;
    current = 0;
  };
  for (const token of text.split(' ')) {
    if (/^\d+$/.test(token)) {
      flush();
      total = 0;
      current = Number(token);
    } else if (token in UNITS) {
      if (total === null) total = 0;
      current += UNITS[token];
    } else if (THOUSAND.has(token)) {
      if (total === null) total = 0;
      total += (current || 1) * 1000;
      current = 0;
    } else {
      flush();
      out.push(token);
    }
  }
  flush();
  return out.join(' ');
}

export function normalize(raw) {
  const text = String(raw ?? '')
    .toLowerCase()
    .replace(/[’ʼʹ`´‘]/g, "'")
    .replace(/(\d)[\s ](?=\d{3}(?!\d))/g, '$1') // «20 000» -> «20000»
    .replace(/[^\p{L}\p{N}'\s-]/gu, ' ')
    .replace(/(^|\s)[-']+|[-']+(?=\s|$)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? wordsToNumbers(text) : '';
}

// Будує регулярний вираз з підтримкою Unicode (кирилиця у \p{L}).
const re = (source) => new RegExp(source, 'u');

const EMP = '(?:працівни[кц]|співробітни[кц]|робітни[кц])\\p{L}*'; // працівник / працівниця
const ALL = '(?:всіх|усіх|всі|усі)';
const SEL = '(?:вибери|виберіть|вибрати|покажи|покажіть|показати|виведи|виведіть|вивести|знайди|знайдіть|знайти|відобрази|відобразіть|дай|дайте|список|перелік)';
const INS = '(?:додай|додайте|додати|створи|створіть|створити|добав|запиши|запишіть|внеси|внесіть)';
const UPD = '(?:онови|оновіть|оновити|зміни|змініть|змінити|встанови|встановіть|постав|поставте|зроби|зробіть)';
const DEL = '(?:видали|видаліть|видалити|вилучи|вилучіть|прибери|приберіть|звільни|звільніть|зітри|зітріть)';
// Поле для оновлення в будь-якій формі: «прізвище», «прізвища», «ім'я», «імені», «імя» (без апострофа) тощо.
const FIELD = "((?:ім'я|імя)\\s+(?:та|і|й)\\s+прізвищ\\p{L}*|повне\\s+(?:ім'я|імя)|піб|посад\\p{L}*|зарплат\\p{L}*|заробітн\\p{L}*\\s+плат\\p{L}*|оклад\\p{L}*|прізвищ\\p{L}*|ім'я|імя|імені|ім'ям|іменем)";
const CURRENCY = '(?:\\s+(?:гривень|гривні|гривня|грн))?';

const ID_TARGET = re("^(?:(?:з|із|зі|під|за)\\s+)?(?:ідентифікатор\\p{L}*|айді|id|номер\\p{L}*|код\\p{L}*)?\\s*(\\d+)$");
const NAME_PREFIX = re("^(?:на\\s+ім'я|з\\s+ім'ям|на\\s+прізвище|з\\s+прізвищем|на\\s+прізвище|якого\\s+звати|яку\\s+звати|ім'я|прізвище)\\s+");
const LETTERS_ONLY = re("^[\\p{L}' -]+$");

// name — повне ім'я, firstName / lastName — лише ім'я або лише прізвище.
function fieldOf(word) {
  if (word.startsWith('посад')) return 'position';
  if (/^(зарплат|оклад|заробітн)/.test(word)) return 'salary';
  if (/\s/.test(word) || word === 'піб') return 'name';
  if (word.startsWith('прізвищ')) return 'lastName';
  return 'firstName';
}

// «з ідентифікатором 5» -> { id: 5 }, «іван іванов» -> { name: 'іван іванов' }.
function parseTarget(text) {
  const s = text.trim();
  const idMatch = s.match(ID_TARGET);
  if (idMatch) return { id: Number(idMatch[1]) };
  const name = s.replace(NAME_PREFIX, '').trim();
  return name && LETTERS_ONLY.test(name) ? { name } : null;
}

const capitalize = (w) => (w ? w[0].toUpperCase() + w.slice(1) : w);
export const titleCase = (s) => s.split(' ').map((w) => w.split('-').map(capitalize).join('-')).join(' ');

function parseValue(field, raw) {
  const value = raw.trim();
  if (field === 'salary') {
    const m = value.match(re(`^(\\d+)${CURRENCY}$`));
    return m ? Number(m[1]) : null;
  }
  if (!value || !LETTERS_ONLY.test(value)) return null;
  return field === 'position' ? capitalize(value) : titleCase(value);
}

const SALARY_OPS = {
  'більше': 'gt', 'більш': 'gt', 'більша': 'gt', 'більшою': 'gt', 'вище': 'gt', 'вища': 'gt', 'вищою': 'gt', 'понад': 'gt',
  'від': 'gte', 'щонайменше': 'gte', 'не менше': 'gte', 'не нижче': 'gte',
  'менше': 'lt', 'менш': 'lt', 'менша': 'lt', 'меншою': 'lt', 'нижче': 'lt', 'нижча': 'lt', 'нижчою': 'lt',
  'до': 'lte', 'не більше': 'lte', 'не вище': 'lte',
  'рівно': 'eq', 'рівна': 'eq', 'рівною': 'eq', 'дорівнює': 'eq',
};

// Умова за зарплатою в різних формулюваннях:
// «з зарплатою більше 40000», «і зарплатою більше 40000» (так розпізнавач часто чує «із»),
// «зарплати яких більше 40000», «у яких зарплата понад 40 тисяч», «з зарплатою 30000».
const SALARY_FILTER = re(
  '^(?:(?:у|в)\\s+(?:яких|кого)\\s+|(?:які|що|котрі)\\s+мають\\s+)?' +
  '(?:(?:з|із|зі|і|й|с)\\s+)?' +
  '(?:(?:зарплат|оклад)\\p{L}*|заробітн\\p{L}*\\s+плат\\p{L}*)' +
  '(?:\\s+(?:яких|якого|якої|котрих))?' +
  '(?:\\s+(?:є|складає|становить))?' +
  '(?:\\s+((?:не\\s+)?\\p{L}+))?' +
  '(?:\\s+(?:ніж|за))?' +
  `\\s+(\\d+)${CURRENCY}$`,
);
// «які отримують більше 40000», «що заробляють менше 30000».
const EARN_FILTER = re(`^(?:які|що|котрі)\\s+(?:отримують|заробляють)\\s+((?:не\\s+)?\\p{L}+)\\s+(?:(?:ніж|за)\\s+)?(\\d+)${CURRENCY}$`);
const POSITION_FILTER = re(
  '^(?:(?:з|із|зі|і|й|с)\\s+посадою|на\\s+посаді|посада|(?:у|в)\\s+яких\\s+посада|посада\\s+яких|які\\s+працюють\\s+(?:як|на\\s+посаді))\\s+(.+)$',
);

export function parseCommand(raw) {
  const text = normalize(raw);
  const invalid = (reason) => ({ intent: 'invalid', text, reason });
  let m;

  if (!text) return { intent: 'unknown', text };

  if (re("^(?:допомога|довідка|допоможи|help|що\\s+(?:ти\\s+)?вмієш|які\\s+(?:є\\s+)?команди)").test(text)) {
    return { intent: 'help', text };
  }

  if (re(`^(?:скільки|порахуй|підрахуй)\\s+(?:(?:всього|усього|є|у нас)\\s+)*${EMP}`).test(text)) {
    return { intent: 'count', text };
  }

  // ВИДАЛЕННЯ
  if ((m = text.match(re(`^${DEL}(?:\\s+(.*))?$`)))) {
    const rest = m[1] ?? '';
    if (re(`^${ALL}(?:\\s+${EMP})?$`).test(rest)) {
      return invalid('Масове видалення голосом заборонене з міркувань безпеки. Видаляйте працівників по одному.');
    }
    const target = parseTarget(rest.replace(re(`^${EMP}\\s*`), ''));
    if (!target) return invalid('Не зрозумів, кого видалити. Скажіть, наприклад: «Видали працівника з ідентифікатором 5».');
    return { intent: 'delete', text, target };
  }

  // ОНОВЛЕННЯ: «онови посаду працівника Іван Іванов на менеджер»
  //           або «онови працівника 3 посаду на менеджер».
  // Без нового значення («зміни прізвище працівника 1») — value: null, система його перепитає.
  if (re(`^${UPD}(?:\\s|$)`).test(text)) {
    let field, targetText, valueText;
    if ((m = text.match(re(`^${UPD}\\s+${FIELD}\\s+(?:${EMP}\\s+)?(.+?)\\s+на\\s+(.+)$`)))) {
      [, field, targetText, valueText] = m;
    } else if ((m = text.match(re(`^${UPD}\\s+(?:${EMP}\\s+)?(.+?)\\s+${FIELD}\\s+(?:на\\s+)?(.+)$`)))) {
      [, targetText, field, valueText] = m;
    } else if ((m = text.match(re(`^${UPD}\\s+${FIELD}\\s+(?:${EMP}\\s+)?(.+)$`)))) {
      [, field, targetText] = m;
    } else if ((m = text.match(re(`^${UPD}\\s+(?:${EMP}\\s+)?(.+?)\\s+${FIELD}$`)))) {
      [, targetText, field] = m;
    } else {
      return invalid('Не зрозумів команду оновлення. Скажіть, наприклад: «Онови посаду працівника Іван Іванов на менеджер».');
    }
    field = fieldOf(field);
    const target = parseTarget(targetText);
    if (!target) return invalid('Не зрозумів, якого працівника оновити.');
    if (valueText === undefined) return { intent: 'update', text, target, field, value: null };
    const value = parseValue(field, valueText);
    if (value === null) {
      return invalid(field === 'salary' ? 'Зарплата має бути числом.' : 'Нове значення містить недозволені символи.');
    }
    return { intent: 'update', text, target, field, value };
  }

  // ДОДАВАННЯ: «додай працівника Іван Іванов на посаду менеджер із зарплатою 30000»
  if ((m = text.match(re(`^${INS}\\s+(?:нов\\p{L}*\\s+)?${EMP}\\s*(.*)$`)))) {
    let rest = ` ${m[1]} `;
    let salary = null;
    let position = null;
    const salaryMatch = rest.match(re(`\\s(?:(?:з|із|зі)\\s+)?(?:зарплатою|зарплата|окладом|оклад)\\s+(\\d+)${CURRENCY}\\s`));
    if (salaryMatch) {
      salary = Number(salaryMatch[1]);
      rest = rest.replace(salaryMatch[0], ' ');
    }
    const positionMatch = rest.match(re('\\s(?:на\\s+посаду|на\\s+посаді|з\\s+посадою|посадою|посада|як|у\\s+ролі|в\\s+ролі)\\s+(.+)$'));
    if (positionMatch) {
      position = parseValue('position', positionMatch[1]);
      rest = rest.slice(0, positionMatch.index);
      if (!position) return invalid('Назва посади містить недозволені символи.');
    }
    const name = rest.trim();
    if (!name) return invalid("Не почув ім'я нового працівника. Скажіть, наприклад: «Додай працівника Іван Іванов».");
    if (!LETTERS_ONLY.test(name)) return invalid("Ім'я може містити лише літери, пробіли, дефіс та апостроф.");
    return { intent: 'insert', text, name: titleCase(name), position, salary };
  }

  // ВИБІРКА
  if (re(`^(?:${ALL}\\s+)?${EMP}$`).test(text)) return { intent: 'select_all', text };

  if ((m = text.match(re(`^${SEL}\\s+(?:мені\\s+)?(?:(?:список|перелік)\\s+)?(?:${ALL}\\s+)?${EMP}(?:\\s+(.+))?$`)))) {
    const rest = m[1]?.trim();
    if (!rest) return { intent: 'select_all', text };

    let f;
    if ((f = rest.match(POSITION_FILTER))) {
      return { intent: 'select', text, filter: { position: f[1] } };
    }
    if ((f = rest.match(SALARY_FILTER) ?? rest.match(EARN_FILTER))) {
      const op = f[1] ? SALARY_OPS[f[1]] : 'eq';
      if (!op) return invalid('Не зрозумів умову для зарплати. Скажіть «більше» або «менше».');
      return { intent: 'select', text, filter: { salary: { op, value: Number(f[2]) } } };
    }
    const target = parseTarget(rest);
    if (!target) return invalid('Не зрозумів умову пошуку.');
    return { intent: 'select', text, filter: target };
  }

  // «Покажи всіх менеджерів» — вибірка за посадою у множині.
  if ((m = text.match(re(`^${SEL}\\s+(?:мені\\s+)?${ALL}\\s+(\\p{L}[\\p{L}-]*)$`)))) {
    return { intent: 'select', text, filter: { position: m[1] } };
  }

  return { intent: 'unknown', text };
}
