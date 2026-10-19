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

export function openDatabase(file) {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);

  db.exec(`
    CREATE TABLE IF NOT EXISTS employees (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      position   TEXT    NOT NULL,
      salary     INTEGER NOT NULL,
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
    positions: db.prepare('SELECT DISTINCT position FROM employees ORDER BY position'),
    insert: db.prepare('INSERT INTO employees (name, position, salary) VALUES (?, ?, ?)'),
    update: db.prepare('UPDATE employees SET name = ?, position = ?, salary = ? WHERE id = ?'),
    remove: db.prepare('DELETE FROM employees WHERE id = ?'),
  };
  const plain = (row) => (row ? { ...row } : null);

  return {
    all: () => q.all.all().map(plain),
    byId: (id) => plain(q.byId.get(id)),
    positions: () => q.positions.all().map((r) => r.position),

    insert({ name, position, salary }) {
      const { lastInsertRowid } = q.insert.run(name, position, salary);
      return plain(q.byId.get(lastInsertRowid));
    },

    update(id, { name, position, salary }) {
      const { changes } = q.update.run(name, position, salary, id);
      return changes ? plain(q.byId.get(id)) : null;
    },

    remove: (id) => q.remove.run(id).changes > 0,
  };
}
