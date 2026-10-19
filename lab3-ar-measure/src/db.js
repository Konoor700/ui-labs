// Збережені виміри: SQLite (вбудований модуль node:sqlite).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export function openDatabase(file) {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);

  db.exec(`
    CREATE TABLE IF NOT EXISTS measurements (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      points     TEXT    NOT NULL,           -- JSON: [{ x, y, z }] у метрах
      closed     INTEGER NOT NULL DEFAULT 0, -- 1 — замкнений контур
      total_m    REAL    NOT NULL,           -- сумарна довжина, м
      area_m2    REAL,                       -- площа замкненого плоского контуру, м²
      source     TEXT    NOT NULL,           -- 'sim' — симулятор, 'webxr' — справжній AR
      created_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
    )
  `);

  const q = {
    all: db.prepare('SELECT * FROM measurements ORDER BY id DESC'),
    byId: db.prepare('SELECT * FROM measurements WHERE id = ?'),
    insert: db.prepare('INSERT INTO measurements (name, points, closed, total_m, area_m2, source) VALUES (?, ?, ?, ?, ?, ?)'),
    remove: db.prepare('DELETE FROM measurements WHERE id = ?'),
  };
  const decode = (row) => (row ? { ...row, points: JSON.parse(row.points), closed: Boolean(row.closed) } : null);

  return {
    all: () => q.all.all().map(decode),
    byId: (id) => decode(q.byId.get(id)),
    insert(m) {
      const { lastInsertRowid } = q.insert.run(m.name, JSON.stringify(m.points), m.closed ? 1 : 0, m.total, m.area, m.source);
      return decode(q.byId.get(lastInsertRowid));
    },
    remove: (id) => q.remove.run(id).changes > 0,
  };
}
