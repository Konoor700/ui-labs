import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitText } from '../src/tts.js';
import { HELP_TEXT } from '../src/executor.js';

test('довгий текст ділиться на шматки до 180 символів без втрати слів', () => {
  const chunks = splitText(HELP_TEXT);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((c) => c.length <= 180));
  assert.equal(chunks.join(' '), HELP_TEXT.split(/\s+/).join(' '));
});

test('короткий текст лишається одним шматком', () => {
  assert.deepEqual(splitText('Знайдено 7 працівників.'), ['Знайдено 7 працівників.']);
});
