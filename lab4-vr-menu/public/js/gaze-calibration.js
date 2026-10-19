// Калібрування погляду: регресія (гребенева, з квадратичними членами) з ознак очей у точку екрана,
// а також фільтр One Euro для згладжування тремтіння. Чистий модуль — покривається тестами.

// Точки калібрування (частки екрана) і контрольні точки для оцінки похибки.
export const CALIBRATION_POINTS = [
  [0.1, 0.1], [0.5, 0.1], [0.9, 0.1],
  [0.1, 0.5], [0.5, 0.5], [0.9, 0.5],
  [0.1, 0.9], [0.5, 0.9], [0.9, 0.9],
];
export const VALIDATION_POINTS = [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]];

// Розширені ознаки: 1, лінійні члени, квадрати й добуток положення зіниць.
function expand(z) {
  const [h, v] = z;
  return [1, ...z, h * h, v * v, h * v];
}

// Розв'язок системи A·w = b методом Гаусса з вибором головного елемента.
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[pivot][c])) pivot = r;
    [M[c], M[pivot]] = [M[pivot], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / (row[i] || 1e-12));
}

/**
 * samples: [{ f: number[], x, y }] — ознаки та точка екрана (0…1), на яку дивилися.
 * Повертає модель для predict(). lambda — регуляризація (стійкість до шуму).
 * minStd — найменший масштаб кожної ознаки: якщо голова під час калібрування нерухома, поворот голови
 * майже не змінюється, і без цього обмеження мала зміна пози потім давала б величезні стрибки.
 */
export const MIN_STD = [0.005, 0.003, 0.01, 0.05, 0.05];
export function fit(samples, { lambda = 0.01, minStd = MIN_STD } = {}) {
  if (samples.length < 6) throw new Error('Замало даних для калібрування');
  const dim = samples[0].f.length;
  const mean = Array.from({ length: dim }, (_, i) => samples.reduce((s, p) => s + p.f[i], 0) / samples.length);
  const std = Array.from({ length: dim }, (_, i) => Math.max(Math.sqrt(samples.reduce((s, p) => s + (p.f[i] - mean[i]) ** 2, 0) / samples.length) || 0, minStd[i] ?? 1e-6) || 1);
  const X = samples.map((p) => expand(p.f.map((v, i) => (v - mean[i]) / std[i])));
  const k = X[0].length;
  const XtX = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => X.reduce((s, row) => s + row[i] * row[j], 0) + (i === j && i > 0 ? lambda * samples.length : 0)));
  const weights = (target) => solve(XtX, Array.from({ length: k }, (_, i) => X.reduce((s, row, n) => s + row[i] * target[n], 0)));
  return { mean, std, wx: weights(samples.map((p) => p.x)), wy: weights(samples.map((p) => p.y)) };
}

export function predict(model, f) {
  const z = expand(f.map((v, i) => (v - model.mean[i]) / model.std[i]));
  const dotw = (w) => w.reduce((s, wi, i) => s + wi * z[i], 0);
  return { x: dotw(model.wx), y: dotw(model.wy) };
}

// Відкинути кадри-викиди однієї точки (кліпання, відблиск, погляд убік): лишаємо ті, де положення
// зіниць близьке до медіани (у межах k «робастних сигм»). Якщо відкинуто б більше половини — нічого не чіпаємо.
export function dropOutliers(features, k = 2.5) {
  if (features.length < 5) return features;
  const median = (a) => {
    const s = [...a].sort((x, y) => x - y);
    return s[Math.floor(s.length / 2)];
  };
  const scale = [0, 1].map((i) => {
    const m = median(features.map((f) => f[i]));
    const mad = median(features.map((f) => Math.abs(f[i] - m)));
    return { m, s: mad * 1.4826 + 1e-4 };
  });
  const kept = features.filter((f) => Math.hypot(...scale.map(({ m, s }, i) => (f[i] - m) / s)) <= k);
  return kept.length >= features.length / 2 ? kept : features;
}

// Середня похибка в частках екрана та в пікселях.
export function evaluate(model, samples, { width = 1, height = 1 } = {}) {
  const errors = samples.map((s) => {
    const p = predict(model, s.f);
    return Math.hypot((p.x - s.x) * width, (p.y - s.y) * height);
  });
  return { mean: errors.reduce((a, b) => a + b, 0) / errors.length, max: Math.max(...errors) };
}

// Пікселі екрана → кутова похибка (за типових умов: 96 пікс./дюйм, відстань до екрана 60 см).
export function pixelsToDegrees(px, { dpi = 96, distanceCm = 60 } = {}) {
  const cm = (px / dpi) * 2.54;
  return (Math.atan(cm / distanceCm) * 180) / Math.PI;
}

// Медіана останніх n значень: поодинокі «викиди» (напівзакрите око, відблиск) відкидаються повністю.
export class MedianFilter {
  constructor(n = 5) {
    this.n = n;
    this.values = [];
  }

  reset() {
    this.values = [];
  }

  filter(value) {
    this.values.push(value);
    if (this.values.length > this.n) this.values.shift();
    const sorted = [...this.values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }
}

// Фільтр One Euro: сильно згладжує повільне тремтіння, але майже не запізнюється на швидких рухах.
export class OneEuroFilter {
  constructor({ minCutoff = 0.8, beta = 4, dCutoff = 1 } = {}) {
    Object.assign(this, { minCutoff, beta, dCutoff });
    this.reset();
  }

  reset() {
    this.x = null;
    this.dx = 0;
    this.t = null;
  }

  static alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(value, t) {
    if (this.x === null) {
      this.x = value;
      this.t = t;
      return value;
    }
    const dt = Math.max(1e-3, (t - this.t) / 1000);
    this.t = t;
    const dx = (value - this.x) / dt;
    this.dx += OneEuroFilter.alpha(this.dCutoff, dt) * (dx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += OneEuroFilter.alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }
}
