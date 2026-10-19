// Завантажує модель MediaPipe Gesture Recognizer один раз (≈8 МБ), щоб далі застосунок працював без інтернету.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/latest/gesture_recognizer.task';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const target = path.join(root, 'public', 'models', 'gesture_recognizer.task');

if (existsSync(target)) {
  console.log('Модель уже завантажено:', path.relative(root, target));
} else {
  mkdirSync(path.dirname(target), { recursive: true });
  console.log('Завантаження моделі жестів MediaPipe…');
  const response = await fetch(MODEL_URL);
  if (!response.ok) {
    console.error(`Не вдалося завантажити модель (HTTP ${response.status}). Повторіть: node scripts/download-model.js`);
    process.exit(0); // не зриваємо npm install — модель можна докачати пізніше
  }
  writeFileSync(target, Buffer.from(await response.arrayBuffer()));
  console.log('Готово:', path.relative(root, target));
}
