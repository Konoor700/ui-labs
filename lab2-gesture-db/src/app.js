// HTTP-застосунок: REST API для працівників + статичні файли та локальна копія MediaPipe.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateEmployee, parseId } from './validation.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function createApp(repo) {
  const app = express();
  app.use(express.json({ limit: '4kb' }));
  app.use(express.static(path.join(root, 'public')));
  // Бібліотека MediaPipe (JS + WebAssembly) роздається з node_modules — без звернень до CDN.
  app.use('/vendor/mediapipe', express.static(path.join(root, 'node_modules', '@mediapipe', 'tasks-vision')));

  app.get('/api/employees', (req, res) => {
    res.json({ rows: repo.all(), positions: repo.positions() });
  });

  app.post('/api/employees', (req, res) => {
    const check = validateEmployee(req.body);
    if (!check.ok) return res.status(400).json({ message: 'Некоректні дані.', errors: check.errors });
    const row = repo.insert(check.value);
    res.status(201).json({ row, message: `Додано працівника ${row.name} (ID ${row.id}).` });
  });

  app.put('/api/employees/:id', (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: 'Некоректний ідентифікатор.' });
    const check = validateEmployee(req.body);
    if (!check.ok) return res.status(400).json({ message: 'Некоректні дані.', errors: check.errors });
    const row = repo.update(id, check.value);
    if (!row) return res.status(404).json({ message: `Працівника з ID ${id} не знайдено.` });
    res.json({ row, message: `Оновлено дані працівника ${row.name}.` });
  });

  app.delete('/api/employees/:id', (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ message: 'Некоректний ідентифікатор.' });
    const row = repo.byId(id);
    if (!row || !repo.remove(id)) return res.status(404).json({ message: `Працівника з ID ${id} не знайдено.` });
    res.json({ message: `Працівника ${row.name} видалено.` });
  });

  // Некоректний JSON та інші помилки — зрозуміла відповідь замість стеку.
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ message: 'Некоректний JSON.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ message: 'Завеликий запит.' });
    console.error(err);
    res.status(500).json({ message: 'Помилка сервера.' });
  });

  return app;
}
