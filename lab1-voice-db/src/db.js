// Шар доступу до даних: SQLite (вбудований модуль node:sqlite) + репозиторій працівників.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const SEED = [
  ['Олена Коваленко', 'HR-менеджер', 32000],
  ['Андрій Шевченко', 'Розробник', 45000],
  ['Марія Бондаренко', 'Бухгалтер', 28000],
  ['Петро Ткаченко', 'Менеджер', 30000],
  ['Наталія Кравченко', 'Дизайнер', 35000],
  ['Олег Мельник', 'Тестувальник', 27000],
  ['Ірина Лисенко', 'Розробник', 48000],
];

// Дозволені для оновлення поля -> назви колонок (білий список, щоб у SQL не потрапило нічого зайвого).
const COLUMNS = { name: 'name', position: 'position', salary: 'salary' };

// Найпоширеніші відмінкові закінчення (довші — першими).
const ENDINGS = ['ами', 'ями', 'ові', 'еві', 'єві', 'ого', 'ому', 'ою', 'ею', 'єю', 'ів', 'їв', 'ам', 'ям',
  'ах', 'ях', 'ої', 'ій', 'а', 'я', 'у', 'ю', 'і', 'ї', 'е', 'о', 'и'];

// Простий стемінг для української: відкидає закінчення, щоб «Івана Іванова» знаходило «Іван Іванов».
export function stem(word) {
  for (const ending of ENDINGS) {
    if (word.endsWith(ending) && word.length - ending.length >= 3) return word.slice(0, -ending.length);
  }
  return word;
}

const words = (s) => s.toLowerCase().split(/[\s-]+/).filter(Boolean);

export function openDatabase(file) {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);

  db.exec(`
    CREATE TABLE IF NOT EXISTS employees (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      position   TEXT    NOT NULL DEFAULT 'Не вказано',
      salary     INTEGER,
      created_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `);

  if (db.prepare('SELECT COUNT(*) AS n FROM employees').get().n === 0) {
    const insert = db.prepare('INSERT INTO employees (name, position, salary) VALUES (?, ?, ?)');
    for (const row of SEED) insert.run(...row);
  }

  const q = {
    all: db.prepare('SELECT * FROM employees ORDER BY id'),
    byId: db.prepare('SELECT * FROM employees WHERE id = ?'),
    count: db.prepare('SELECT COUNT(*) AS n FROM employees'),
    insert: db.prepare('INSERT INTO employees (name, position, salary) VALUES (?, ?, ?)'),
    remove: db.prepare('DELETE FROM employees WHERE id = ?'),
    salary: {
      eq: db.prepare('SELECT * FROM employees WHERE salary = ? ORDER BY salary'),
      gt: db.prepare('SELECT * FROM employees WHERE salary > ? ORDER BY salary'),
      gte: db.prepare('SELECT * FROM employees WHERE salary >= ? ORDER BY salary'),
      lt: db.prepare('SELECT * FROM employees WHERE salary < ? ORDER BY salary'),
      lte: db.prepare('SELECT * FROM employees WHERE salary <= ? ORDER BY salary'),
    },
  };
  const plain = (row) => (row ? { ...row } : null);

  return {
    all: () => q.all.all().map(plain),
    count: () => q.count.get().n,
    byId: (id) => plain(q.byId.get(id)),

    // Спочатку точний збіг (без урахування регістру), потім — за основами слів.
    byName(name) {
      const rows = this.all();
      const target = words(name).join(' ');
      const exact = rows.filter((r) => words(r.name).join(' ') === target);
      if (exact.length) return exact;
      const parts = words(name).map(stem);
      return rows.filter((r) => {
        const nameWords = words(r.name);
        return parts.every((p) => nameWords.some((w) => w.startsWith(p)));
      });
    },

    byPosition(position) {
      const parts = words(position).map(stem);
      return this.all().filter((r) => parts.every((p) => r.position.toLowerCase().includes(p)));
    },

    bySalary: (op, value) => q.salary[op].all(value).map(plain),

    insert({ name, position, salary }) {
      const { lastInsertRowid } = q.insert.run(name, position ?? 'Не вказано', salary ?? null);
      return plain(q.byId.get(lastInsertRowid));
    },

    update(id, field, value) {
      const column = COLUMNS[field];
      if (!column) throw new Error(`Недозволене поле: ${field}`);
      db.prepare(`UPDATE employees SET ${column} = ? WHERE id = ?`).run(value, id);
      return plain(q.byId.get(id));
    },

    remove: (id) => q.remove.run(id).changes > 0,
  };
}
