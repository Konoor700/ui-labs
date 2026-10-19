import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MenuModel, PAGE_SIZE } from '../public/js/menu-model.js';
import { DwellTracker } from '../public/js/dwell.js';
import { parseVoice } from '../public/js/voice-commands.js';
import { CATEGORIES, DISHES } from '../src/menu-data.js';

const dishes = DISHES.map((d, i) => ({ ...d, id: i + 1 }));
const model = () => new MenuModel({ categories: CATEGORIES, dishes });
const byName = (name) => dishes.find((d) => d.name === name).id;

test('навігація: категорія, сторінки, страва, назад, головна', () => {
  const m = model();
  assert.ok(m.show());
  assert.ok(m.openCategory('pizza'));
  assert.equal(m.visibleDishes().length, PAGE_SIZE);
  assert.equal(m.pageCount(), 2, '4 піци — 2 сторінки по 3');
  assert.ok(m.nextPage());
  assert.deepEqual(m.visibleDishes().map((d) => d.name), ['Овочева']);
  assert.equal(m.nextPage(), false, 'далі останньої сторінки не можна');
  assert.ok(m.openDish(byName('Овочева')));
  assert.equal(m.page, 'dish');
  assert.ok(m.back());
  assert.equal(m.page, 'category');
  assert.equal(m.pageIndex, 1, 'повертаємось на ту саму сторінку');
  m.home();
  assert.equal(m.page, 'home');
  assert.equal(m.back(), false);
  assert.equal(m.openCategory('nope'), false);
});

test('замовлення: кількість, додавання, видалення, сума', () => {
  const m = model();
  m.openDish(byName('Маргарита'));
  assert.equal(m.changeQty(-1), false, 'менше 1 не можна');
  m.changeQty(+1);
  assert.equal(m.addToCart().ok, true);
  m.openDish(byName('Капучино'));
  m.addToCart();
  m.addToCart();
  assert.equal(m.cartCount(), 4);
  assert.equal(m.cartTotal(), 2 * 189 + 2 * 59);
  assert.ok(m.removeFromCart(byName('Капучино')));
  assert.equal(m.cartTotal(), 378);
  m.openDish(byName('Маргарита'));
  m.qty = 20;
  assert.equal(m.addToCart().ok, true);
  assert.equal(m.cart.get(byName('Маргарита')), 20, 'обмеження 20 порцій');
  assert.equal(m.addToCart().ok, false);
});

test('оформлення лише через підтвердження', () => {
  const m = model();
  assert.equal(m.requestCheckout().ok, false, 'порожнє замовлення');
  m.openDish(byName('Борщ'));
  m.addToCart();
  assert.ok(m.requestCheckout().ok);
  assert.equal(m.page, 'confirm');
  assert.deepEqual(m.confirm(false), { cancelled: true });
  assert.notEqual(m.page, 'confirm');
  m.requestCheckout();
  assert.deepEqual(m.confirm(true), { items: [{ dishId: byName('Борщ'), qty: 1 }] });
  m.orderPlaced();
  assert.equal(m.cart.size, 0);
  assert.equal(m.page, 'home');
  assert.equal(m.confirm(true), null, 'без сторінки підтвердження нічого не відбувається');
});

test('налаштування з обмеженнями', () => {
  const m = model();
  m.setSetting('distance', 5);
  assert.equal(m.settings.distance, 2.2);
  m.setSetting('dwellMs', 100);
  assert.equal(m.settings.dwellMs, 500);
  assert.equal(m.setSetting('unknown', 1), false);
});

test('вибір поглядом: спрацьовує один раз після затримки', () => {
  const d = new DwellTracker(1000);
  assert.equal(d.update('a', 400).fired, false);
  assert.equal(d.update('a', 400).progress, 0.8);
  assert.equal(d.update('a', 300).fired, true);
  assert.equal(d.update('a', 2000).fired, false, 'повторно — лише після того, як відвели погляд');
  d.update(null, 16);
  assert.equal(d.update('a', 600).fired, false);
  assert.equal(d.update('b', 600).progress, 0.6, 'інший пункт — відлік спочатку');
  assert.equal(d.update('b', 500).fired, true);
});

test('голосові команди', () => {
  const p = (t) => parseVoice(t, dishes);
  assert.deepEqual(p('Відкрий меню'), { type: 'open' });
  assert.deepEqual(p('закрити меню'), { type: 'close' });
  assert.deepEqual(p('Назад!'), { type: 'back' });
  assert.deepEqual(p('на головну'), { type: 'home' });
  assert.deepEqual(p('Наступна сторінка'), { type: 'next' });
  assert.deepEqual(p('попередня'), { type: 'prev' });
  assert.deepEqual(p('Піца'), { type: 'category', id: 'pizza' });
  assert.deepEqual(p('покажи напої'), { type: 'category', id: 'drinks' });
  assert.deepEqual(p('Маргарита'), { type: 'dish', id: byName('Маргарита') });
  assert.deepEqual(p('відкрий чотири сири'), { type: 'dish', id: byName('Чотири сири') });
  assert.deepEqual(p('курячий бульйон'), { type: 'dish', id: byName('Курячий бульйон') }, 'найдовший збіг');
  assert.deepEqual(p('грибний крем-суп'), { type: 'dish', id: byName('Грибний крем-суп') }, 'страва важливіша за категорію');
  assert.deepEqual(p('Додай в замовлення'), { type: 'add' });
  assert.deepEqual(p('плюс'), { type: 'plus' });
  assert.deepEqual(p('оформити замовлення'), { type: 'checkout' });
  assert.deepEqual(p('Так'), { type: 'yes' });
  assert.deepEqual(p('ні, не треба'), { type: 'no' });
  assert.deepEqual(p('моє замовлення'), { type: 'order' });
  assert.deepEqual(p('налаштування'), { type: 'settings' });
  assert.deepEqual(p("п'ять"), { type: 'number', n: 5 });
  assert.deepEqual(p('номер 7'), { type: 'number', n: 7 });
  assert.equal(p('яка сьогодні погода').type, 'unknown');
  assert.equal(p('').type, 'unknown');
});

test('відмінки після числа: 1 страва, 3 страви, 5 страв, 11 страв, 21 страва', async () => {
  const { plural } = await import('../public/js/menu-view.js');
  const forms = ['страва', 'страви', 'страв'];
  assert.deepEqual([1, 3, 4, 5, 11, 12, 21, 22, 25].map((n) => plural(n, forms)), [
    '1 страва', '3 страви', '4 страви', '5 страв', '11 страв', '12 страв', '21 страва', '22 страви', '25 страв',
  ]);
});
