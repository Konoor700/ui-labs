// Розбір голосових команд для меню (українською). Чиста функція — легко тестувати.

const NUMBERS = {
  'один': 1, 'одна': 1, 'перший': 1, 'два': 2, 'дві': 2, 'другий': 2, 'три': 3, 'третій': 3, 'чотири': 4,
  "п'ять": 5, 'шість': 6, 'сім': 7, 'вісім': 8, "дев'ять": 9,
};

const CATEGORY_WORDS = [
  [/піц/, 'pizza'], [/бургер/, 'burgers'], [/салат/, 'salads'], [/суп/, 'soups'],
  [/десерт|солодк/, 'desserts'], [/напо|напій|пити|попити/, 'drinks'],
];

export function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[’ʼ`]/g, "'")
    .replace(/[.,!?;:«»"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const is = (re, t) => re.test(t);

/**
 * @param text розпізнаний текст
 * @param dishes [{ id, name }] — щоб розпізнати назви страв
 * @returns { type, ... } або { type: 'unknown' }
 */
export function parseVoice(text, dishes = []) {
  const t = normalize(text);
  if (!t) return { type: 'unknown', text: t };

  // Короткі відповіді на підтвердження.
  if (is(/^(так|так оформити|підтверджую|звісно|згоден|згодна|ок|окей)$/, t)) return { type: 'yes' };
  if (is(/^(ні|ні не треба|не треба|скасуй|скасувати|відміна)$/, t)) return { type: 'no' };

  // Число — для режиму перевірки точності («п'ять», «5»).
  const digit = t.match(/^(?:номер |пункт )?(\d)$/);
  if (digit) return { type: 'number', n: Number(digit[1]) };
  const word = t.replace(/^(номер|пункт) /, '');
  if (NUMBERS[word]) return { type: 'number', n: NUMBERS[word] };

  if (is(/^(відкрий |відкрити |покажи |показати )?(меню)$/, t)) return { type: 'open' };
  if (is(/^(закрий|закрити|сховай|сховати)( меню)?$/, t)) return { type: 'close' };
  if (is(/^(назад|повернись|повернутися|поверни)$/, t)) return { type: 'back' };
  if (is(/^(на )?(головн[аеу]|категорії|початок)( сторінк[аиу])?$/, t)) return { type: 'home' };
  if (is(/^(далі|наступн[аі]|вперед|гортай)( сторінка)?$/, t)) return { type: 'next' };
  if (is(/^(попередн[яі]|раніше)( сторінка)?$/, t)) return { type: 'prev' };
  if (is(/^(плюс|більше|ще одн[уа]|ще)$/, t)) return { type: 'plus' };
  if (is(/^(мінус|менше)$/, t)) return { type: 'minus' };
  if (is(/^(налаштування|параметри)$/, t)) return { type: 'settings' };
  if (is(/^(оформ(и|ити)|замовити|підтвердити)( замовлення)?$/, t)) return { type: 'checkout' };
  if (is(/^(додай|додати|беру|візьму)( (це|його|її))?( (в|до|у) (замовлення|кошик))?$/, t)) return { type: 'add' };
  if (is(/^(очисти|очистити)( замовлення| кошик)?$/, t)) return { type: 'clear' };
  if (is(/^((моє|мій|покажи|відкрий) )?(замовлення|кошик)$/, t)) return { type: 'order' };

  // Назва страви (найдовший збіг: «курячий бульйон» важливіший за «курячий»).
  const dish = dishes
    .map((d) => ({ d, name: normalize(d.name) }))
    .filter(({ name }) => t.includes(name))
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (dish) return { type: 'dish', id: dish.d.id };

  for (const [re, id] of CATEGORY_WORDS) if (re.test(t)) return { type: 'category', id };

  return { type: 'unknown', text: t };
}
