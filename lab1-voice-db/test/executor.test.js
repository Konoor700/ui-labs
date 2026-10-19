import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db.js';
import { handleCommand, plural } from '../src/executor.js';

let repo;
const run = (text, opts) => handleCommand(repo, [text], opts);

beforeEach(() => {
  repo = openDatabase(':memory:'); // свіжа БД із початковими даними для кожного тесту
});

test('вибірка всіх і підрахунок', () => {
  assert.equal(run('Вибери всіх працівників').rows.length, 7);
  assert.equal(run('Скільки працівників').message, 'У базі 7 працівників.');
});

test('повний цикл: додати, оновити, видалити з підтвердженням', () => {
  const added = run('Додай працівника Іван Іванов');
  assert.equal(added.ok, true);
  const [id] = added.highlight;
  assert.equal(repo.byId(id).name, 'Іван Іванов');

  const updated = run('Онови посаду працівника Іван Іванов на менеджер');
  assert.equal(updated.ok, true);
  assert.equal(repo.byId(id).position, 'Менеджер');

  const ask = run(`Видали працівника з ідентифікатором ${id}`);
  assert.equal(ask.needsConfirmation, true);
  assert.ok(repo.byId(id), 'без підтвердження запис не видаляється');

  const done = run(`Видали працівника з ідентифікатором ${id}`, { confirmed: true });
  assert.equal(done.ok, true);
  assert.equal(repo.byId(id), null);
});

test("пошук за ім'ям у непрямому відмінку", () => {
  run('Додай працівника Іван Іванов');
  const res = run('Зміни зарплату працівника Івана Іванова на 33000');
  assert.equal(res.ok, true);
  assert.equal(repo.byName('Іван Іванов')[0].salary, 33000);
});

test('фільтри за посадою та зарплатою', () => {
  assert.deepEqual(run('Покажи всіх розробників').rows.map((r) => r.name), ['Андрій Шевченко', 'Ірина Лисенко']);
  assert.ok(run('Покажи працівників із зарплатою більше 40000').rows.every((r) => r.salary > 40000));
});

test('помилки: неіснуючий запис, неоднозначне ім’я, невідома команда', () => {
  assert.equal(run('Видали працівника 999').ok, false);

  run('Додай працівника Олег Мельник');
  const ambiguous = run('Видали працівника Олег Мельник');
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.rows.length, 2);

  assert.equal(run('Заспівай пісню').ok, false);
});

test('обирається альтернатива розпізнавання, що є коректною командою', () => {
  const res = handleCommand(repo, ['покаже всіх працівників', 'покажи всіх працівників']);
  assert.equal(res.recognized, 'покажи всіх працівників');
  assert.equal(res.intent, 'select_all');
});

test('відмінювання слова «працівник»', () => {
  const forms = ['працівник', 'працівники', 'працівників'];
  assert.deepEqual([1, 2, 5, 11, 21, 22, 25].map((n) => plural(n, forms)), [
    'працівник', 'працівники', 'працівників', 'працівників', 'працівник', 'працівники', 'працівників',
  ]);
});

test('спроба SQL-ін’єкції не шкодить базі (параметризовані запити)', () => {
  run("Додай працівника Robert'); DROP TABLE employees;--");
  assert.equal(repo.count(), 8);
});

test('зміна лише прізвища або лише імені', () => {
  const res = run('Зміни прізвище працівника з ідентифікатором 1 на Петренко');
  assert.equal(res.ok, true);
  assert.equal(repo.byId(1).name, 'Олена Петренко');
  run("Зміни ім'я працівника 1 на Ольга");
  assert.equal(repo.byId(1).name, 'Ольга Петренко');
  run("Зміни ім'я працівника 1 на Ірина Коваль");
  assert.equal(repo.byId(1).name, 'Ірина Коваль');
});

test('без нового значення система перепитує, а потім застосовує відповідь', () => {
  const ask = run('Зміни прізвища працівника з ідентифікатором 1');
  assert.equal(ask.needsValue, true);
  assert.equal(ask.message, 'Яке нове прізвище для працівника Олена Коваленко?');
  assert.equal(repo.byId(1).name, 'Олена Коваленко');
  // клієнт дописує відповідь користувача як «… на <значення>»
  run(`${ask.recognized} на Петренко`);
  assert.equal(repo.byId(1).name, 'Олена Петренко');
});
