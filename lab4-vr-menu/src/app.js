// HTTP-застосунок: меню, замовлення, статичні файли та локальні копії three.js і MediaPipe.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateOrder } from './validation.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function createApp(repo) {
  const app = express();
  app.use(express.json({ limit: '8kb' }));
  app.use(express.static(path.join(root, 'public')));
  app.use('/vendor/three', express.static(path.join(root, 'node_modules', 'three')));
  app.use('/vendor/mediapipe', express.static(path.join(root, 'node_modules', '@mediapipe', 'tasks-vision')));

  app.get('/api/menu', (req, res) => res.json({ categories: repo.categories(), dishes: repo.dishes() }));
  app.get('/api/orders', (req, res) => res.json({ rows: repo.orders() }));

  app.post('/api/orders', (req, res) => {
    const check = validateOrder(req.body, (id) => repo.dish(id));
    if (!check.ok) return res.status(400).json({ message: check.message });
    const row = repo.insertOrder(check.value);
    res.status(201).json({ row, message: `Замовлення №${row.id} прийнято: ${row.total} грн.` });
  });

  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ message: 'Некоректний JSON.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ message: 'Завеликий запит.' });
    console.error(err);
    res.status(500).json({ message: 'Помилка сервера.' });
  });

  return app;
}
