// Перевірка виміру перед збереженням. Довжину й площу сервер рахує сам — тими самими функціями, що й клієнт.
import { isValidPoint, summarize } from '../public/js/geometry.js';
import { MAX_POINTS } from '../public/js/measurement.js';

const SOURCES = new Set(['sim', 'webxr']);

export function validateMeasurement(input) {
  const errors = {};
  const name = typeof input?.name === 'string' ? input.name.replace(/\s+/g, ' ').trim() : '';
  const points = Array.isArray(input?.points) ? input.points : null;
  const closed = input?.closed === true;
  const source = SOURCES.has(input?.source) ? input.source : null;

  if (name.length < 1 || name.length > 60) errors.name = 'Назва — від 1 до 60 символів.';
  if (!points || points.length < 2 || points.length > MAX_POINTS) errors.points = `Потрібно від 2 до ${MAX_POINTS} точок.`;
  else if (!points.every(isValidPoint)) errors.points = 'Некоректні координати точок.';
  if (closed && points && points.length < 3) errors.closed = 'Замкнений контур — щонайменше 3 точки.';
  if (!source) errors.source = 'Невідоме джерело виміру.';

  if (Object.keys(errors).length) return { ok: false, errors };
  const clean = points.map(({ x, y, z }) => ({ x, y, z }));
  const { total, area } = summarize(clean, closed);
  return { ok: true, value: { name, points: clean, closed, total, area, source } };
}

export function parseId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}
