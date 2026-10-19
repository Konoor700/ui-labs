// Меню ресторану та замовлення: SQLite (вбудований модуль node:sqlite).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { CATEGORIES, DISHES } from './menu-data.js';

export function openDatabase(file) {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);

  db.exec(`
    CREATE TABLE IF NOT EXISTS dishes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      category    TEXT    NOT NULL,
      name        TEXT    NOT NULL,
      description TEXT    NOT NULL,
      price       INTEGER NOT NULL,  -- грн
      kcal        INTEGER NOT NULL,
      weight      INTEGER NOT NULL,  -- г
      model       TEXT    NOT NULL,  -- тип 3D-моделі
      colors      TEXT    NOT NULL,  -- JSON
      ingredients TEXT    NOT NULL   -- JSON
    );
    CREATE TABLE IF NOT EXISTS orders (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      items      TEXT    NOT NULL,   -- JSON: [{ dishId, name, price, qty }]
      total      INTEGER NOT NULL,   -- грн, рахує сервер
      method     TEXT    NOT NULL,   -- як користувач підтвердив замовлення
      created_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
  `);

  if (db.prepare('SELECT COUNT(*) AS n FROM dishes').get().n === 0) {
    const insert = db.prepare('INSERT INTO dishes (category, name, description, price, kcal, weight, model, colors, ingredients) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const d of DISHES) {
      insert.run(d.category, d.name, d.description, d.price, d.kcal, d.weight, d.model, JSON.stringify(d.colors), JSON.stringify(d.ingredients));
    }
  }

  const q = {
    dishes: db.prepare('SELECT * FROM dishes ORDER BY id'),
    dish: db.prepare('SELECT * FROM dishes WHERE id = ?'),
    orders: db.prepare('SELECT * FROM orders ORDER BY id DESC'),
    order: db.prepare('SELECT * FROM orders WHERE id = ?'),
    insertOrder: db.prepare('INSERT INTO orders (items, total, method) VALUES (?, ?, ?)'),
  };
  const dish = (row) => (row ? { ...row, colors: JSON.parse(row.colors), ingredients: JSON.parse(row.ingredients) } : null);
  const order = (row) => (row ? { ...row, items: JSON.parse(row.items) } : null);

  return {
    categories: () => CATEGORIES,
    dishes: () => q.dishes.all().map(dish),
    dish: (id) => dish(q.dish.get(id)),
    orders: () => q.orders.all().map(order),
    insertOrder({ items, total, method }) {
      const { lastInsertRowid } = q.insertOrder.run(JSON.stringify(items), total, method);
      return order(q.order.get(lastInsertRowid));
    },
  };
}
