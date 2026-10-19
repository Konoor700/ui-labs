// Перевірка замовлення. Ціни й суму бере сервер з бази — клієнт надсилає лише id страв і кількість.

export const MAX_ITEMS = 20;
export const MAX_QTY = 20;
export const METHODS = new Set(['gaze', 'eyes', 'pointer', 'hand', 'voice', 'controller', 'mouse']);

export function validateOrder(input, findDish) {
  const items = Array.isArray(input?.items) ? input.items : null;
  if (!items || items.length < 1 || items.length > MAX_ITEMS) {
    return { ok: false, message: `Замовлення має містити від 1 до ${MAX_ITEMS} позицій.` };
  }
  const merged = new Map();
  for (const item of items) {
    const dishId = Number(item?.dishId);
    const qty = Number(item?.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) return { ok: false, message: `Кількість — ціле число від 1 до ${MAX_QTY}.` };
    const dish = Number.isInteger(dishId) ? findDish(dishId) : null;
    if (!dish) return { ok: false, message: 'Такої страви немає в меню.' };
    const prev = merged.get(dish.id);
    merged.set(dish.id, { dishId: dish.id, name: dish.name, price: dish.price, qty: (prev?.qty ?? 0) + qty });
  }
  const clean = [...merged.values()];
  if (clean.some((i) => i.qty > MAX_QTY)) return { ok: false, message: `Не більше ${MAX_QTY} порцій однієї страви.` };
  const method = METHODS.has(input?.method) ? input.method : 'pointer';
  return { ok: true, value: { items: clean, total: clean.reduce((s, i) => s + i.price * i.qty, 0), method } };
}
