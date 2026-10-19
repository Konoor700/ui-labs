import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './src/db.js';
import { handleCommand } from './src/executor.js';
import { synthesize } from './src/tts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const MAX_TEXT = 300;
const MAX_TTS_TEXT = 1000;

const repo = openDatabase(process.env.DB_FILE || path.join(__dirname, 'data', 'employees.db'));
const app = express();

app.use(express.json({ limit: '4kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/employees', (req, res) => {
  res.json({ rows: repo.all() });
});

// Озвучення відповіді українською (MP3) для браузерів без українського голосу.
app.get('/api/tts', async (req, res) => {
  const text = String(req.query.text ?? '').trim().slice(0, MAX_TTS_TEXT);
  if (!text) return res.status(400).end();
  try {
    const audio = await synthesize(text);
    res.set({ 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=86400' }).send(audio);
  } catch (err) {
    console.error('TTS:', err.message);
    res.status(502).end();
  }
});

// Приймає розпізнаний текст (і альтернативи), повертає результат виконання команди.
app.post('/api/command', (req, res) => {
  const { text, alternatives = [], confirmed = false } = req.body ?? {};
  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ ok: false, message: 'Порожня команда.' });
  }
  const candidates = [text, ...(Array.isArray(alternatives) ? alternatives : [])]
    .filter((s) => typeof s === 'string' && s.trim())
    .slice(0, 5)
    .map((s) => s.slice(0, MAX_TEXT));

  try {
    res.json(handleCommand(repo, candidates, { confirmed: confirmed === true }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, message: 'Помилка сервера під час виконання команди.' });
  }
});

app.listen(PORT, () => {
  console.log(`Голосовий інтерфейс БД запущено: http://localhost:${PORT}`);
});
