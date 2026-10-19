import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, parseCommand, wordsToNumbers } from '../src/parser.js';

test('нормалізація: регістр, пунктуація, апострофи, пробіли в числах', () => {
  assert.equal(normalize('  Видали працівника, з ID 5! '), 'видали працівника з id 5');
  assert.equal(normalize('Дар’я'), "дар'я");
  assert.equal(normalize('зарплата 20 000'), 'зарплата 20000');
});

test('числівники перетворюються на цифри', () => {
  assert.equal(wordsToNumbers("видали працівника п'ять"), 'видали працівника 5');
  assert.equal(wordsToNumbers("двадцять п'ять тисяч"), '25000');
  assert.equal(wordsToNumbers('30 тисяч'), '30000');
  assert.equal(wordsToNumbers('сто двадцять три'), '123');
});

test('приклади команд із завдання', () => {
  assert.equal(parseCommand('Вибери всіх працівників').intent, 'select_all');

  assert.deepEqual(parseCommand('Додай працівника Іван Іванов'), {
    intent: 'insert', text: 'додай працівника іван іванов', name: 'Іван Іванов', position: null, salary: null,
  });

  const upd = parseCommand('Онови посаду працівника Іван Іванов на менеджер');
  assert.equal(upd.intent, 'update');
  assert.deepEqual(upd.target, { name: 'іван іванов' });
  assert.equal(upd.field, 'position');
  assert.equal(upd.value, 'Менеджер');

  const del = parseCommand('Видали працівника з ідентифікатором 5');
  assert.equal(del.intent, 'delete');
  assert.deepEqual(del.target, { id: 5 });
});

test('варіації формулювань', () => {
  assert.equal(parseCommand('Покажи всіх співробітників').intent, 'select_all');
  assert.equal(parseCommand('Список працівників').intent, 'select_all');
  assert.equal(parseCommand('Скільки у нас працівників?').intent, 'count');
  assert.equal(parseCommand('Що ти вмієш').intent, 'help');
  assert.deepEqual(parseCommand("Видали працівника номер п'ять").target, { id: 5 });
  assert.deepEqual(parseCommand('Видалити співробітника Олег Мельник').target, { name: 'олег мельник' });

  const ins = parseCommand('Додай нового працівника Дар’я Петренко на посаду бухгалтер із зарплатою 30 тисяч гривень');
  assert.equal(ins.name, "Дар'я Петренко");
  assert.equal(ins.position, 'Бухгалтер');
  assert.equal(ins.salary, 30000);

  const upd = parseCommand('Онови працівника 3 зарплату на 41000');
  assert.deepEqual([upd.target, upd.field, upd.value], [{ id: 3 }, 'salary', 41000]);

  const rename = parseCommand("Зміни ім'я працівника з ідентифікатором 2 на Петро Петренко");
  assert.deepEqual([rename.field, rename.value], ['firstName', 'Петро Петренко']);
});

test('фільтри вибірки', () => {
  assert.deepEqual(parseCommand('Покажи працівника з ідентифікатором 3').filter, { id: 3 });
  assert.deepEqual(parseCommand('Знайди працівника Андрій Шевченко').filter, { name: 'андрій шевченко' });
  assert.deepEqual(parseCommand('Покажи працівників з посадою розробник').filter, { position: 'розробник' });
  assert.deepEqual(parseCommand('Покажи всіх менеджерів').filter, { position: 'менеджерів' });
  assert.deepEqual(parseCommand('Покажи працівників із зарплатою більше 30000').filter, {
    salary: { op: 'gt', value: 30000 },
  });
  assert.deepEqual(parseCommand('Виведи працівників з зарплатою менше ніж 28 тисяч').filter, {
    salary: { op: 'lt', value: 28000 },
  });
});

test('некоректні та небезпечні команди', () => {
  assert.equal(parseCommand('Видали всіх працівників').intent, 'invalid');
  assert.equal(parseCommand('Додай працівника').intent, 'invalid');
  assert.equal(parseCommand('Додай працівника Іван 123').intent, 'invalid');
  assert.equal(parseCommand('Зміни зарплату працівника 3 на багато').intent, 'invalid');
  assert.equal(parseCommand('Яка сьогодні погода').intent, 'unknown');
  assert.equal(parseCommand('').intent, 'unknown');
});

test('зміна імені / прізвища: різні форми слова та команда без значення', () => {
  // так це почув розпізнавач — «прізвища» замість «прізвище», без нового значення
  assert.deepEqual(parseCommand('Зміни прізвища працівника з ідентифікатором 1'), {
    intent: 'update', text: 'зміни прізвища працівника з ідентифікатором 1', target: { id: 1 }, field: 'lastName', value: null,
  });
  const surname = parseCommand('Зміни прізвище працівника з ідентифікатором 1 на Петренко');
  assert.deepEqual([surname.field, surname.value], ['lastName', 'Петренко']);
  const first = parseCommand('Зміни імя працівниці 1 на Ольга');
  assert.deepEqual([first.target, first.field, first.value], [{ id: 1 }, 'firstName', 'Ольга']);
  const full = parseCommand('Онови ім’я та прізвище працівника 3 на Марія Іваненко');
  assert.deepEqual([full.field, full.value], ['name', 'Марія Іваненко']);
  assert.equal(parseCommand('Зміни працівника 2 посаду').value, null);
});

test('фільтр за зарплатою: різні формулювання', () => {
  const gt40 = { salary: { op: 'gt', value: 40000 } };
  for (const phrase of [
    'Покажи працівників і зарплатою більше 40 000', // «і» замість «із» — так часто чує розпізнавач
    'Покажи всіх працівників зарплати яких більше 40 000',
    'Покажи працівників зарплата яких більше 40000',
    'Покажи працівників у яких зарплата більше 40000',
    'Покажи працівників в яких зарплата понад сорок тисяч',
    'Покажи працівників які отримують більше 40000',
    'Виведи працівників із зарплатою більш ніж 40000 гривень',
  ]) {
    assert.deepEqual(parseCommand(phrase).filter, gt40, phrase);
  }
  assert.deepEqual(parseCommand('Покажи працівників з зарплатою не менше 30000').filter, { salary: { op: 'gte', value: 30000 } });
  assert.deepEqual(parseCommand('Покажи працівників зарплата яких менша 30000').filter, { salary: { op: 'lt', value: 30000 } });
  assert.deepEqual(parseCommand('Покажи працівників із зарплатою 30000').filter, { salary: { op: 'eq', value: 30000 } });
  assert.deepEqual(parseCommand('Покажи працівників і посадою розробник').filter, { position: 'розробник' });
});
