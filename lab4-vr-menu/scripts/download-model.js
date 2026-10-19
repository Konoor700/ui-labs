// Завантажує моделі MediaPipe один раз (жести ~8 МБ, обличчя з зіницями ~4 МБ),
// щоб далі застосунок працював без інтернету.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODELS = {
  'gesture_recognizer.task': 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/latest/gesture_recognizer.task',
  'face_landmarker.task': 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task',
};
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dir = path.join(root, 'public', 'models');
mkdirSync(dir, { recursive: true });

for (const [name, url] of Object.entries(MODELS)) {
  const target = path.join(dir, name);
  if (existsSync(target)) {
    console.log('Модель уже завантажено:', name);
    continue;
  }
  console.log('Завантаження моделі MediaPipe:', name);
  const response = await fetch(url);
  if (!response.ok) {
    console.error(`Не вдалося завантажити ${name} (HTTP ${response.status}). Повторіть: node scripts/download-model.js`);
    continue; // не зриваємо npm install — модель можна докачати пізніше
  }
  writeFileSync(target, Buffer.from(await response.arrayBuffer()));
  console.log('Готово:', name);
}
