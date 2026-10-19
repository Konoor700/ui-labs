// Модель «трекінгу» симулятора — як поводиться ARCore у реальних умовах:
// поверхня знаходиться не миттєво, а поки на неї дивишся; у темряві — не знаходиться зовсім;
// точка, поставлена на поверхню, має похибку, що росте з відстанню та при поганому світлі.

export const LIGHTING = {
  normal: { label: 'Нормальне', rate: 1 / 1.2, growth: 0.9, noise: 0.002 },
  dim: { label: 'Тьмяне', rate: 1 / 3.5, growth: 0.35, noise: 0.006 },
  dark: { label: 'Темно', rate: 0, growth: 0, noise: 0.02 },
};

export const MAX_DETECTION_DISTANCE = 5; // м
export const MIN_VIEW_COS = 0.25; // під кутом, гострішим за ~75° до площини, поверхня не знаходиться

// Швидкість накопичення «впевненості» в поверхні, 1/с (1 — поверхню знайдено).
export function detectionRate(lighting, distance, viewCos) {
  const l = LIGHTING[lighting];
  if (!l || l.rate === 0) return 0;
  if (distance > MAX_DETECTION_DISTANCE || viewCos < MIN_VIEW_COS) return 0;
  const distanceFactor = Math.min(1, Math.max(0.2, 1.4 - distance / 3)); // далі — повільніше
  const angleFactor = Math.min(1, (viewCos - MIN_VIEW_COS) / 0.5 + 0.3); // під кутом — повільніше
  return l.rate * distanceFactor * angleFactor;
}

// Середньоквадратична похибка координати точки (м).
export function noiseSigma(lighting, distance) {
  const l = LIGHTING[lighting] ?? LIGHTING.normal;
  return l.noise * (1 + distance / 2);
}

// Детермінований генератор випадкових чисел (для відтворюваних тестів).
export function createRandom(seed = 1) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // Нормальний розподіл (перетворення Бокса — Мюллера).
  next.gaussian = () => {
    const u = Math.max(next(), 1e-12);
    const v = next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return next;
}

// Еталонні розміри об'єктів віртуальної кімнати — для перевірки точності вимірювань.
export const REFERENCES = [
  { id: 'door-h', label: 'Висота дверей', meters: 2.1 },
  { id: 'door-w', label: 'Ширина дверей', meters: 0.9 },
  { id: 'window-h', label: 'Висота вікна', meters: 1.4 },
  { id: 'window-w', label: 'Ширина вікна', meters: 1.2 },
  { id: 'table-l', label: 'Довжина стільниці', meters: 1.2 },
  { id: 'table-w', label: 'Ширина стільниці', meters: 0.7 },
  { id: 'table-h', label: 'Висота столу', meters: 0.75 },
  { id: 'room-h', label: 'Висота стелі', meters: 2.7 },
  { id: 'room-w', label: 'Ширина кімнати', meters: 5.0 },
];
