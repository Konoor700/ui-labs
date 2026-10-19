// Стан віртуального меню: сторінки, навігація, кількість, замовлення, підтвердження.
// Модуль не залежить від three.js і DOM — його однаково викликають погляд, промінь, жести й голос.

export const PAGE_SIZE = 3; // страв на сторінці категорії
export const MAX_QTY = 20;

export const SETTINGS_DEFAULTS = {
  distance: 1.0, // м від користувача
  follow: true, // меню слідує за поглядом
  brightness: 1, // 0,4…1,6
  dwellMs: 1000, // вибір поглядом
  gaze: true, // вибір поглядом увімкнено
};

export class MenuModel {
  constructor({ categories = [], dishes = [] } = {}) {
    this.categories = categories;
    this.dishes = dishes;
    this.open = false;
    this.page = 'home';
    this.categoryId = null;
    this.dishId = null;
    this.pageIndex = 0;
    this.qty = 1;
    this.history = [];
    this.cart = new Map(); // dishId → кількість
    this.settings = { ...SETTINGS_DEFAULTS };
    this.listeners = new Set();
  }

  onChange(fn) {
    this.listeners.add(fn);
  }

  emit(event = {}) {
    for (const fn of this.listeners) fn(this, event);
  }

  setData({ categories, dishes }) {
    this.categories = categories;
    this.dishes = dishes;
    this.emit();
  }

  /* ---------- Відкриття та навігація ---------- */

  show() {
    if (this.open) return false;
    this.open = true;
    this.emit({ type: 'open' });
    return true;
  }

  hide() {
    if (!this.open) return false;
    this.open = false;
    this.emit({ type: 'close' });
    return true;
  }

  toggle() {
    return this.open ? this.hide() : this.show();
  }

  snapshot() {
    return { page: this.page, categoryId: this.categoryId, dishId: this.dishId, pageIndex: this.pageIndex };
  }

  go(page, params = {}) {
    this.history.push(this.snapshot());
    if (this.history.length > 30) this.history.shift();
    Object.assign(this, { page, ...params });
    this.open = true;
    this.emit({ type: 'navigate', page });
  }

  back() {
    const previous = this.history.pop();
    if (!previous) return this.page === 'home' ? false : (this.home(), true);
    Object.assign(this, previous);
    this.emit({ type: 'navigate', page: this.page });
    return true;
  }

  home() {
    this.history = [];
    Object.assign(this, { page: 'home', categoryId: null, dishId: null, pageIndex: 0 });
    this.open = true;
    this.emit({ type: 'navigate', page: 'home' });
  }

  category(id = this.categoryId) {
    return this.categories.find((c) => c.id === id) ?? null;
  }

  dish(id = this.dishId) {
    return this.dishes.find((d) => d.id === id) ?? null;
  }

  dishesIn(categoryId) {
    return this.dishes.filter((d) => d.category === categoryId);
  }

  openCategory(id) {
    if (!this.category(id)) return false;
    this.go('category', { categoryId: id, pageIndex: 0 });
    return true;
  }

  pageCount() {
    const count = this.page === 'order' ? this.cart.size : this.dishesIn(this.categoryId).length;
    return Math.max(1, Math.ceil(count / PAGE_SIZE));
  }

  // Страви на поточній сторінці категорії.
  visibleDishes() {
    const all = this.dishesIn(this.categoryId);
    return all.slice(this.pageIndex * PAGE_SIZE, (this.pageIndex + 1) * PAGE_SIZE);
  }

  nextPage() {
    if (this.page !== 'category' || this.pageIndex >= this.pageCount() - 1) return false;
    this.pageIndex++;
    this.emit({ type: 'page' });
    return true;
  }

  prevPage() {
    if (this.page !== 'category' || this.pageIndex === 0) return false;
    this.pageIndex--;
    this.emit({ type: 'page' });
    return true;
  }

  openDish(id) {
    const dish = this.dish(id);
    if (!dish) return false;
    this.go('dish', { dishId: id, categoryId: dish.category });
    this.qty = 1;
    this.emit({ type: 'dish' });
    return true;
  }

  /* ---------- Кількість і замовлення ---------- */

  changeQty(delta) {
    const next = Math.min(MAX_QTY, Math.max(1, this.qty + delta));
    if (next === this.qty) return false;
    this.qty = next;
    this.emit({ type: 'qty' });
    return true;
  }

  addToCart() {
    const dish = this.dish();
    if (!dish) return { ok: false, message: 'Спочатку оберіть страву.' };
    const current = this.cart.get(dish.id) ?? 0;
    const qty = Math.min(MAX_QTY, current + this.qty);
    if (qty === current) return { ok: false, message: `Не більше ${MAX_QTY} порцій однієї страви.` };
    this.cart.set(dish.id, qty);
    this.emit({ type: 'cart' });
    return { ok: true, message: `Додано: ${dish.name} × ${qty - current}` };
  }

  removeFromCart(dishId) {
    if (!this.cart.delete(dishId)) return false;
    this.emit({ type: 'cart' });
    return true;
  }

  clearCart() {
    if (!this.cart.size) return false;
    this.cart.clear();
    this.emit({ type: 'cart' });
    return true;
  }

  cartItems() {
    return [...this.cart].map(([id, qty]) => {
      const dish = this.dish(id);
      return { dish, qty, sum: dish.price * qty };
    }).filter((i) => i.dish);
  }

  cartCount() {
    return [...this.cart.values()].reduce((s, q) => s + q, 0);
  }

  cartTotal() {
    return this.cartItems().reduce((s, i) => s + i.sum, 0);
  }

  // Оформлення — лише через підтвердження (захист від випадкового вибору).
  requestCheckout() {
    if (!this.cart.size) return { ok: false, message: 'Замовлення порожнє.' };
    this.go('confirm');
    return { ok: true };
  }

  // Повертає позиції для відправки на сервер, якщо підтверджено.
  confirm(yes) {
    if (this.page !== 'confirm') return null;
    if (!yes) {
      this.back();
      return { cancelled: true };
    }
    const items = [...this.cart].map(([dishId, qty]) => ({ dishId, qty }));
    return { items };
  }

  orderPlaced() {
    this.cart.clear();
    this.history = [];
    Object.assign(this, { page: 'home', categoryId: null, dishId: null, pageIndex: 0 });
    this.emit({ type: 'placed' });
  }

  /* ---------- Налаштування ---------- */

  setSetting(key, value) {
    if (!(key in this.settings)) return false;
    const limits = { distance: [0.8, 2.2], brightness: [0.4, 1.6], dwellMs: [500, 2500] };
    if (limits[key]) value = Math.min(limits[key][1], Math.max(limits[key][0], value));
    this.settings[key] = value;
    this.emit({ type: 'settings', key });
    return true;
  }
}
