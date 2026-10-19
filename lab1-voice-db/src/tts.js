// Синтез українського мовлення на сервері — для браузерів без українського голосу
// (наприклад, Chrome на Windows, де є лише російський та англійський голоси).
// Використовується голосовий движок Google Translate; він приймає до ~200 символів за запит.

const TTS_URL = 'https://translate.google.com/translate_tts';
const MAX_CHUNK = 180;

// Ділить текст на шматки до MAX_CHUNK символів по межах слів (по можливості — по кінцях речень).
export function splitText(text, max = MAX_CHUNK) {
  const chunks = [];
  let current = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (current && current.length + 1 + word.length > max) {
      chunks.push(current);
      current = '';
    }
    current = current ? `${current} ${word}` : word.slice(0, max);
    if (/[.!?…]$/.test(word) && current.length > max / 2) {
      chunks.push(current);
      current = '';
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function fetchChunk(chunk) {
  const url = `${TTS_URL}?ie=UTF-8&tl=uk&client=tw-ob&q=${encodeURIComponent(chunk)}`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`TTS HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

const cache = new Map();
const CACHE_SIZE = 100;

// Повертає MP3 з озвученим текстом (MP3-фрагменти можна просто склеїти).
// Часті фрази («Так чи ні?», «Видалення скасовано.») кешуються, щоб відповідь звучала без затримки.
export async function synthesize(text) {
  if (cache.has(text)) return cache.get(text);
  const parts = await Promise.all(splitText(text).map(fetchChunk));
  const audio = Buffer.concat(parts);
  cache.set(text, audio);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value);
  return audio;
}
