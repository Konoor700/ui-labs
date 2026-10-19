// Початкові дані меню ресторану. Ціни — грн, вага — г.
// model — тип процедурної 3D-моделі страви; colors — кольори для неї.

export const CATEGORIES = [
  { id: 'pizza', name: 'Піца' },
  { id: 'burgers', name: 'Бургери' },
  { id: 'salads', name: 'Салати' },
  { id: 'soups', name: 'Супи' },
  { id: 'desserts', name: 'Десерти' },
  { id: 'drinks', name: 'Напої' },
];

export const DISHES = [
  { category: 'pizza', name: 'Маргарита', price: 189, kcal: 820, weight: 450, model: 'pizza', colors: { topping: '#2f8f3a' }, description: 'Класична неаполітанська піца з базиліком', ingredients: ['тісто', 'томатний соус', 'моцарела', 'базилік'] },
  { category: 'pizza', name: 'Пепероні', price: 229, kcal: 980, weight: 480, model: 'pizza', colors: { topping: '#b3261e' }, description: 'Гостра ковбаска пепероні та моцарела', ingredients: ['тісто', 'томатний соус', 'моцарела', 'пепероні'] },
  { category: 'pizza', name: 'Чотири сири', price: 249, kcal: 1050, weight: 470, model: 'pizza', colors: { topping: '#f2d16b' }, description: 'Моцарела, пармезан, горгонзола, дор-блю', ingredients: ['тісто', 'вершковий соус', 'моцарела', 'пармезан', 'горгонзола', 'дор-блю'] },
  { category: 'pizza', name: 'Овочева', price: 209, kcal: 760, weight: 460, model: 'pizza', colors: { topping: '#e07b24' }, description: 'Печені овочі та оливки', ingredients: ['тісто', 'томатний соус', 'перець', 'гриби', 'оливки', 'цибуля'] },
  { category: 'burgers', name: 'Класичний', price: 199, kcal: 690, weight: 320, model: 'burger', colors: { patty: '#5b3220' }, description: 'Яловича котлета, свіжі овочі, фірмовий соус', ingredients: ['булка', 'яловича котлета', 'салат', 'томат', 'цибуля', 'соус'] },
  { category: 'burgers', name: 'Чизбургер', price: 219, kcal: 760, weight: 340, model: 'burger', colors: { patty: '#4e2a1a', cheese: '#f3b23a' }, description: 'Подвійний чедер і маринований огірок', ingredients: ['булка', 'яловича котлета', 'сир чедер', 'огірок', 'соус'] },
  { category: 'burgers', name: 'Курячий', price: 189, kcal: 610, weight: 310, model: 'burger', colors: { patty: '#c98a3a' }, description: 'Хрустке куряче філе та капуста коул-слоу', ingredients: ['булка', 'куряче філе', 'капуста', 'соус часниковий'] },
  { category: 'salads', name: 'Цезар', price: 179, kcal: 420, weight: 280, model: 'salad', colors: { accent: '#e8c27a' }, description: 'Романо, курка, пармезан, грінки', ingredients: ['салат романо', 'курка', 'пармезан', 'грінки', 'соус цезар'] },
  { category: 'salads', name: 'Грецький', price: 159, kcal: 310, weight: 300, model: 'salad', colors: { accent: '#d63c2f' }, description: 'Томати, огірок, перець, фета, оливки', ingredients: ['томати', 'огірок', 'перець', 'фета', 'оливки'] },
  { category: 'salads', name: 'Овочевий', price: 129, kcal: 180, weight: 260, model: 'salad', colors: { accent: '#f0a030' }, description: 'Сезонні овочі з олією', ingredients: ['томати', 'огірок', 'редиска', 'зелень', 'олія'] },
  { category: 'soups', name: 'Борщ', price: 119, kcal: 260, weight: 350, model: 'soup', colors: { soup: '#a3202a' }, description: 'Український борщ зі сметаною', ingredients: ['буряк', 'капуста', 'картопля', 'морква', 'сметана'] },
  { category: 'soups', name: 'Грибний крем-суп', price: 139, kcal: 290, weight: 300, model: 'soup', colors: { soup: '#c9a77a' }, description: 'Печериці, вершки, грінки', ingredients: ['печериці', 'вершки', 'цибуля', 'грінки'] },
  { category: 'soups', name: 'Курячий бульйон', price: 99, kcal: 160, weight: 350, model: 'soup', colors: { soup: '#e8c24a' }, description: 'Домашній бульйон з локшиною', ingredients: ['курка', 'локшина', 'морква', 'зелень'] },
  { category: 'desserts', name: 'Чізкейк', price: 129, kcal: 450, weight: 150, model: 'cake', colors: { cream: '#f6ecd2', top: '#c2273a' }, description: 'Нью-Йорк з ягідним соусом', ingredients: ['вершковий сир', 'печиво', 'вершки', 'ягоди'] },
  { category: 'desserts', name: 'Тірамісу', price: 139, kcal: 480, weight: 160, model: 'cake', colors: { cream: '#efe1c6', top: '#5a3a24' }, description: 'Маскарпоне, савоярді, кава', ingredients: ['маскарпоне', 'савоярді', 'кава', 'какао'] },
  { category: 'desserts', name: 'Шоколадний торт', price: 149, kcal: 520, weight: 170, model: 'cake', colors: { cream: '#5a3020', top: '#3a1e12' }, description: 'Бельгійський шоколад', ingredients: ['шоколад', 'вершки', 'борошно', 'яйця'] },
  { category: 'drinks', name: 'Лимонад', price: 69, kcal: 120, weight: 400, model: 'drink', colors: { liquid: '#f2e36b' }, description: 'Домашній, з м’ятою', ingredients: ['лимон', 'м’ята', 'вода', 'цукор'] },
  { category: 'drinks', name: 'Капучино', price: 59, kcal: 110, weight: 250, model: 'drink', colors: { liquid: '#a8754b' }, description: 'Еспресо з молочною пінкою', ingredients: ['еспресо', 'молоко'] },
  { category: 'drinks', name: 'Узвар', price: 49, kcal: 90, weight: 300, model: 'drink', colors: { liquid: '#9b4a2a' }, description: 'Сухофрукти, мед', ingredients: ['сухофрукти', 'мед', 'вода'] },
  { category: 'drinks', name: 'Апельсиновий сік', price: 79, kcal: 140, weight: 300, model: 'drink', colors: { liquid: '#f39a1e' }, description: 'Свіжовичавлений', ingredients: ['апельсини'] },
];
