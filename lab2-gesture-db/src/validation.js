// Перевірка даних працівника перед записом у БД.

const TEXT = /^[\p{L}' -]+$/u;
export const MAX_SALARY = 10_000_000;

const clean = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');

export function validateEmployee(input) {
  const errors = {};
  const name = clean(input?.name);
  const position = clean(input?.position);
  const salary = Number(input?.salary);

  if (name.length < 2 || name.length > 80) errors.name = "Ім'я має містити від 2 до 80 символів.";
  else if (!TEXT.test(name)) errors.name = "Ім'я може містити лише літери, пробіл, дефіс та апостроф.";
  else if (name.split(' ').length < 2) errors.name = "Вкажіть ім'я та прізвище.";

  if (position.length < 2 || position.length > 60) errors.position = 'Посада має містити від 2 до 60 символів.';
  else if (!TEXT.test(position)) errors.position = 'Посада може містити лише літери, пробіл, дефіс та апостроф.';

  if (!Number.isInteger(salary) || salary < 0 || salary > MAX_SALARY) {
    errors.salary = `Зарплата — ціле число від 0 до ${MAX_SALARY}.`;
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { name, position, salary } };
}

export function parseId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}
