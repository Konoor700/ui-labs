// HTTP-застосунок: REST API для збережених вимірів + статичні файли та локальна копія three.js.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateMeasurement, parseId } from './validation.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function createApp(repo) {
  const app = express();
  app.use(express.json({ limit: '32kb' }));
  app.use(express.static(path.join(root, 'public')));
  // three.js роздається з node_modules — без звернень до CDN.
  app.use('/vendor/three', express.static(path.join(root, 'node_modules', 'three')));

  app.get('/api/measurements', (req, res) => res.json({ rows: repo.all() }));

  app.get('/api/measurements/:id', (req, res) => {
    const id = parseId(req.params.id);
    const row = id && repo.byId(id);
    if (!row) return res.status(404).json({ message: 'Вимір не знайдено.' });
    res.json({ row });
  });

  app.post('/api/measurements', (req, res) => {
    const check = validateMeasurement(req.body);
    if (!check.ok) return res.status(400).json({ message: 'Некоректні дані виміру.', errors: check.errors });
    const row = repo.insert(check.value);
    res.status(201).json({ row, message: `Вимір «${row.name}» збережено.` });
  });

  app.delete('/api/measurements/:id', (req, res) => {
    const id = parseId(req.params.id);
    const row = id && repo.byId(id);
    if (!row || !repo.remove(id)) return res.status(404).json({ message: 'Вимір не знайдено.' });
    res.json({ message: `Вимір «${row.name}» видалено.` });
  });

  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ message: 'Некоректний JSON.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ message: 'Завеликий запит.' });
    console.error(err);
    res.status(500).json({ message: 'Помилка сервера.' });
  });

  return app;
}
