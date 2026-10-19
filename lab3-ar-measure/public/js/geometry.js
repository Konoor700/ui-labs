// Геометрія вимірювань у 3D. Координати — метри (як у ARCore / WebXR).
// Модуль чистий (без DOM і three.js): ним користуються браузер і сервер, його покривають тести.

export const MIN_POINT_GAP = 0.005; // точки ближче 5 мм — повтор (подвійний дотик)
export const MAX_COORD = 100; // ±100 м — далі вже помилка трекінгу
export const COPLANAR_TOLERANCE = 0.02; // 2 см — допуск, щоб рахувати площу контуру

export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const length = (v) => Math.hypot(v.x, v.y, v.z);
export const distance = (a, b) => length(sub(a, b));

export const SNAP_RADIUS = 0.06; // 6 см: ближче — нова точка «прилипає» до наявної

// Найближча точка в радіусі прилипання: { point, index } або null.
export function findSnap(points, p, radius = SNAP_RADIUS) {
  let best = null;
  points.forEach((q, index) => {
    const d = distance(q, p);
    if (d <= radius && (!best || d < best.distance)) best = { point: q, index, distance: d };
  });
  return best;
}

export function isValidPoint(p) {
  return Boolean(p) && ['x', 'y', 'z'].every((k) => Number.isFinite(p[k]) && Math.abs(p[k]) <= MAX_COORD);
}

// Довжини відрізків ламаної (для замкненого контуру — плюс останній → перший).
export function segmentLengths(points, closed = false) {
  const out = [];
  for (let i = 1; i < points.length; i++) out.push(distance(points[i - 1], points[i]));
  if (closed && points.length >= 3) out.push(distance(points[points.length - 1], points[0]));
  return out;
}

export const totalLength = (points, closed = false) => segmentLengths(points, closed).reduce((s, d) => s + d, 0);

// Нормаль багатокутника методом Ньюела (працює і для неопуклих контурів).
export function newellNormal(points) {
  const n = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    n.x += (a.y - b.y) * (a.z + b.z);
    n.y += (a.z - b.z) * (a.x + b.x);
    n.z += (a.x - b.x) * (a.y + b.y);
  }
  return n;
}

// Найбільше відхилення точок від площини контуру (м).
export function planarityError(points) {
  if (points.length < 4) return 0;
  const n = newellNormal(points);
  const len = length(n);
  if (len < 1e-12) return Infinity;
  const unit = { x: n.x / len, y: n.y / len, z: n.z / len };
  const c = points.reduce((s, p) => ({ x: s.x + p.x / points.length, y: s.y + p.y / points.length, z: s.z + p.z / points.length }), { x: 0, y: 0, z: 0 });
  return Math.max(...points.map((p) => Math.abs((p.x - c.x) * unit.x + (p.y - c.y) * unit.y + (p.z - c.z) * unit.z)));
}

// Площа замкненого плоского контуру (м²); null, якщо точки не лежать в одній площині.
export function polygonArea(points) {
  if (points.length < 3 || planarityError(points) > COPLANAR_TOLERANCE) return null;
  return length(newellNormal(points)) / 2;
}

export function summarize(points, closed = false) {
  const segments = segmentLengths(points, closed);
  return {
    segments,
    total: segments.reduce((s, d) => s + d, 0),
    area: closed ? polygonArea(points) : null,
  };
}

/* ---------- Форматування ---------- */

const NUMBER = {
  cm: new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
  m: new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
};

export function formatLength(meters, unit = 'cm') {
  return unit === 'm' ? `${NUMBER.m.format(meters)} м` : `${NUMBER.cm.format(meters * 100)} см`;
}

const bare = (meters, unit) => (unit === 'm' ? NUMBER.m.format(meters) : NUMBER.cm.format(meters * 100));

// Рядок результату, як в AR-рулетках: «113,0 + 77,8 + 126,5 = 317,3 см».
export function resultLine({ segments, total }, unit = 'cm') {
  if (!segments.length) return '';
  const suffix = unit === 'm' ? ' м' : ' см';
  if (segments.length === 1) return bare(total, unit) + suffix;
  return `${segments.map((s) => bare(s, unit)).join(' + ')} = ${bare(total, unit)}${suffix}`;
}

export function formatArea(m2) {
  return `${new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(m2)} м²`;
}

// Точність виміру відносно еталона, %: 100 − відносна похибка.
export function accuracyPercent(measured, reference) {
  if (!(reference > 0)) return null;
  return Math.max(0, 100 - (Math.abs(measured - reference) / reference) * 100);
}
