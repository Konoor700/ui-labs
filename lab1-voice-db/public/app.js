// Клієнтська частина: розпізнавання мовлення (Web Speech API), індикатор рівня звуку (Web Audio API),
// озвучення відповідей (SpeechSynthesis) та відображення даних.

const $ = (id) => document.getElementById(id);
const els = {
  mic: $('mic'),
  micHint: $('mic-hint'),
  level: $('level'),
  transcript: $('transcript'),
  response: $('response'),
  responseText: $('response-text'),
  confirm: $('confirm'),
  confirmYes: $('confirm-yes'),
  confirmNo: $('confirm-no'),
  textForm: $('text-form'),
  textInput: $('text-input'),
  examples: $('examples'),
  rows: $('rows'),
  tableTitle: $('table-title'),
  tableCount: $('table-count'),
  showAll: $('show-all'),
  log: $('log'),
  logEmpty: $('log-empty'),
  clearLog: $('clear-log'),
  continuous: $('opt-continuous'),
  tts: $('opt-tts'),
  pause: $('opt-pause'),
  pauseBar: $('pause-bar'),
  warning: $('support-warning'),
};

const EXAMPLES = [
  'Вибери всіх працівників',
  'Додай працівника Іван Іванов',
  'Онови посаду працівника Іван Іванов на менеджер',
  'Видали працівника з ідентифікатором 5',
  'Покажи працівників із зарплатою більше 30000',
  'Покажи всіх розробників',
  'Зміни зарплату працівника 2 на 50000',
  'Зміни прізвище працівника 1 на Петренко',
  'Скільки працівників',
  'Допомога',
];

// Відповіді на підтвердження. «Да»/«нет» — бо розпізнавач іноді так чує «так»/«ні».
const YES = /^(так|та|да|звісно|звичайно|авжеж|підтверджую|згоден|згодна|видаляй|видаляйте|ок|окей|угу|ага|yes)(\s.*)?$/;
const NO = /^(ні|нє|нет|не|скасуй|скасуйте|скасувати|відміна|відмінити|стоп|no)(\s.*)?$/;
const CANCEL = /^(скасуй|скасуйте|скасувати|відміна|відмінити|стоп|не треба|нічого)(\s.*)?$/;
// Якщо замість нового значення сказали нову команду — виконуємо її.
const COMMAND_START = /^(вибери|виберіть|покажи|покажіть|виведи|знайди|додай|створи|онови|зміни|видали|скільки|допомога|список)(\s|$)/;
const MAX_CONFIRM_RETRIES = 2;
const simplify = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').replace(/\s+/g, ' ').trim();

const state = {
  listening: false,
  wantListening: false, // користувач увімкнув мікрофон (для безперервного режиму)
  micRequested: false, // користувач натиснув кнопку й ще нічого не сказав — не губимо це натискання
  busy: false,
  speaking: false,
  pending: null, // команда, що чекає підтвердження
};

/* ---------- Відображення ---------- */

const money = new Intl.NumberFormat('uk-UA');

function cell(text, className) {
  const td = document.createElement('td');
  if (className) td.className = className;
  td.textContent = text;
  return td;
}

function renderTable(rows, title = 'Усі працівники', highlight = []) {
  els.tableTitle.textContent = title;
  els.tableCount.textContent = `Записів: ${rows.length}`;
  els.rows.replaceChildren();

  if (rows.length === 0) {
    const tr = document.createElement('tr');
    tr.className = 'empty-row';
    const td = cell('Немає записів, що відповідають запиту');
    td.colSpan = 5;
    tr.append(td);
    els.rows.append(tr);
    return;
  }

  for (const r of rows) {
    const tr = document.createElement('tr');
    if (highlight.includes(r.id)) tr.className = 'is-highlight';
    const position = document.createElement('td');
    const tag = document.createElement('span');
    tag.className = 'position-tag';
    tag.textContent = r.position;
    position.append(tag);
    tr.append(
      cell(r.id, 'num'),
      cell(r.name),
      position,
      cell(r.salary != null ? `${money.format(r.salary)} ₴` : '—', 'num'),
      cell(r.created_at?.slice(0, 10) ?? ''),
    );
    els.rows.append(tr);
  }
  els.rows.querySelector('.is-highlight')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function showTranscript(text, interim = false) {
  els.transcript.textContent = text || 'Тут з’явиться те, що ви сказали';
  els.transcript.classList.toggle('is-empty', !text);
  els.transcript.classList.toggle('is-interim', Boolean(text) && interim);
}

function showResponse(message, status) {
  els.responseText.textContent = message;
  els.response.dataset.status = status;
}

function addLog(said, reply, status, source) {
  const li = document.createElement('li');
  li.className = 'log-item';
  li.dataset.status = status;
  const dot = document.createElement('span');
  dot.className = 'log-dot';
  const saidEl = document.createElement('span');
  saidEl.className = 'log-said';
  saidEl.textContent = `«${said}»`;
  const replyEl = document.createElement('span');
  replyEl.className = 'log-reply';
  replyEl.textContent = reply;
  const meta = document.createElement('span');
  meta.className = 'log-meta';
  meta.textContent = `${new Date().toLocaleTimeString('uk-UA')} · ${source === 'voice' ? 'голос' : 'текст'}`;
  li.append(dot, saidEl, replyEl, meta);
  els.log.prepend(li);
  els.logEmpty.hidden = true;
}

function updateMicUi() {
  // Мікрофон вмикається (або чекає своєї черги) — одразу показуємо, що натискання зараховано.
  const starting = !state.listening && (rec.status === 'starting' || rec.queued || (state.micRequested && (state.busy || state.speaking)));
  els.mic.classList.toggle('is-listening', state.listening);
  els.mic.classList.toggle('is-starting', starting);
  els.mic.classList.toggle('is-busy', state.busy);
  els.mic.setAttribute('aria-pressed', String(state.listening || starting));
  els.mic.setAttribute('aria-label', state.listening || starting ? 'Зупинити слухання' : 'Почати слухати');
  const kind = state.pending?.kind;
  if (starting && (state.busy || state.speaking)) els.micHint.textContent = 'Увімкну мікрофон одразу після відповіді…';
  else if (starting) els.micHint.textContent = 'Вмикаю мікрофон…';
  else if (state.listening && kind === 'confirm') els.micHint.textContent = 'Слухаю відповідь: «так» або «ні»…';
  else if (state.listening && kind === 'value') els.micHint.textContent = 'Слухаю нове значення… («скасуй» — відміна)';
  else if (state.listening) els.micHint.textContent = 'Слухаю… Пауза або кнопка — виконати команду';
  else if (state.busy) els.micHint.textContent = 'Обробляю команду…';
  else if (state.speaking && kind === 'confirm') els.micHint.textContent = 'Дочекайтеся сигналу й скажіть «так» або «ні»';
  else if (state.speaking && kind === 'value') els.micHint.textContent = 'Дочекайтеся сигналу й назвіть нове значення';
  else if (state.speaking) els.micHint.textContent = 'Відповідаю…';
  else els.micHint.innerHTML = 'Натисніть кнопку або клавішу <kbd>Пробіл</kbd>';
}

/* ---------- Озвучення відповідей ---------- */

let ukVoice = null;
function pickVoice() {
  const voices = speechSynthesis.getVoices();
  ukVoice = voices.find((v) => v.lang?.toLowerCase().startsWith('uk')) ?? null;
}
if ('speechSynthesis' in window) {
  pickVoice();
  speechSynthesis.addEventListener?.('voiceschanged', pickVoice);
}

let speechToken = 0; // щоб завершення попереднього озвучення не «закрило» нове
let currentAudio = null;

function stopSpeaking() {
  speechToken++;
  window.speechSynthesis?.cancel();
  currentAudio?.pause();
  currentAudio = null;
  state.speaking = false;
}

// Якщо в браузері є український голос (наприклад, у Microsoft Edge) — використовуємо його.
// Інакше (Chrome на Windows має лише російський голос) — відтворюємо MP3, синтезований сервером.
function speak(text, onDone) {
  stopSpeaking();
  const token = speechToken;
  const finish = () => {
    if (token !== speechToken) return;
    state.speaking = false;
    currentAudio = null;
    updateMicUi();
    onDone?.();
    resumeIfContinuous();
  };
  if (!els.tts.checked) return finish();

  state.speaking = true;
  // Не слухаємо під час озвучення, щоб система не розпізнавала власний голос.
  // Якщо користувач натиснув кнопку, поки система відповідала, мікрофон увімкнеться після відповіді.
  if (isMicActive() || rec.queued) recAbort();
  updateMicUi();

  if (ukVoice) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'uk-UA';
    utterance.voice = ukVoice;
    utterance.onend = finish;
    utterance.onerror = finish;
    speechSynthesis.speak(utterance);
  } else {
    const audio = new Audio(`/api/tts?text=${encodeURIComponent(text)}`);
    currentAudio = audio;
    audio.playbackRate = 1.15; // голос Google досить повільний
    audio.onended = finish;
    audio.onerror = finish;
    audio.play().catch(finish);
  }
}

/* ---------- Звуковий сигнал «можна говорити» (Web Audio API) ---------- */

let beepCtx = null;
function beep() {
  try {
    beepCtx ??= new AudioContext();
    beepCtx.resume();
    const t = beepCtx.currentTime;
    const osc = beepCtx.createOscillator();
    const gain = beepCtx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.15, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(gain).connect(beepCtx.destination);
    osc.start(t);
    osc.stop(t + 0.2);
  } catch {
    /* без звуку — не критично */
  }
}

/* ---------- Індикатор рівня звуку (Web Audio API) ---------- */

const meter = {
  ctx: null,
  analyser: null,
  stream: null,
  frame: 0,
  async start() {
    if (this.stream || !navigator.mediaDevices?.getUserMedia) return;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      this.ctx ??= new AudioContext();
      await this.ctx.resume();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.ctx.createMediaStreamSource(this.stream).connect(this.analyser);
      if (!state.listening) return this.stop();
      this.draw();
    } catch {
      this.stream = null; // без доступу до мікрофона індикатор просто не показується
    }
  },
  stop() {
    cancelAnimationFrame(this.frame);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.analyser = null;
    drawLevel(null);
  },
  draw() {
    if (!this.analyser) return;
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(data);
    drawLevel(data);
    this.frame = requestAnimationFrame(() => this.draw());
  },
};

function drawLevel(data) {
  const canvas = els.level;
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const styles = getComputedStyle(document.documentElement);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = styles.getPropertyValue(data ? '--live' : '--border').trim();
  const bars = 32;
  const gap = 3;
  const barWidth = (width - gap * (bars - 1)) / bars;
  for (let i = 0; i < bars; i++) {
    const value = data ? data[Math.floor((i / bars) * data.length * 0.7)] / 255 : 0;
    const h = Math.max(3, value * height);
    ctx.beginPath();
    ctx.roundRect(i * (barWidth + gap), (height - h) / 2, barWidth, h, 2);
    ctx.fill();
  }
}

/* ---------- Розпізнавання мовлення (Web Speech API) ---------- */

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;

// Стан сесії розпізнавання. Chrome вмикає й вимикає мікрофон асинхронно, а start(), викликаний до onend
// попередньої сесії, кидає помилку. Тому натискання в такий момент не губимо, а ставимо в чергу.
const rec = { status: 'idle', queued: false, watchdog: 0, retries: 0 }; // idle | starting | listening | stopping
const isMicActive = () => rec.status === 'starting' || rec.status === 'listening';

const RECOGNITION_ERRORS = {
  'no-speech': 'Мовлення не виявлено. Спробуйте ще раз, говоріть ближче до мікрофона.',
  'audio-capture': 'Мікрофон не знайдено. Перевірте підключення.',
  'not-allowed': 'Доступ до мікрофона заборонено. Дозвольте його в налаштуваннях браузера.',
  'service-not-allowed': 'Служба розпізнавання недоступна в цьому браузері.',
  network: 'Помилка мережі: розпізнавання мовлення в браузері потребує інтернету.',
  'language-not-supported': 'Браузер не підтримує розпізнавання української мови.',
};

// Сам Chrome завершує фразу вже після ~1 с тиші, і довгі команди обриваються.
// Тому слухаємо в безперервному режимі, а кінець команди визначаємо самі: пауза заданої довжини
// (налаштування «Пауза завершення») або повторне натискання кнопки мікрофона.
const NO_SPEECH_TIMEOUT = 10000; // скільки чекаємо початку мовлення
const CONFIRM_PAUSE = 1200; // «так» / «ні» короткі — для них довга пауза не потрібна

const phrase = { segments: [], interim: '', silenceTimer: 0, noSpeechTimer: 0, done: false };

const phraseText = () => [...phrase.segments.map((s) => s[0]), phrase.interim].filter(Boolean).join(' ').trim();

function pauseMs() {
  const pause = Number(els.pause.value) || 2500;
  return state.pending?.kind === 'confirm' ? Math.min(CONFIRM_PAUSE, pause) : pause;
}

function resetPhrase() {
  clearTimeout(phrase.silenceTimer);
  clearTimeout(phrase.noSpeechTimer);
  phrase.segments = [];
  phrase.interim = '';
  showPauseProgress(0);
}

// Смужка під текстом: скільки лишилося до автоматичного виконання команди.
function showPauseProgress(ms) {
  const bar = els.pauseBar;
  bar.style.transition = 'none';
  bar.style.width = '0%';
  if (!ms) return;
  void bar.offsetWidth; // перезапуск CSS-переходу
  bar.style.transition = `width ${ms}ms linear`;
  bar.style.width = '100%';
}

// Фраза завершена (пауза або кнопка) — відправляємо на обробку.
function commitPhrase() {
  const text = phraseText();
  if (!text || phrase.done) return;
  // Варіанти розпізнавання: k-та альтернатива кожного шматка фрази.
  const alternatives = [];
  for (let k = 0; k < 3; k++) {
    const alt = [...phrase.segments.map((s) => s[k] ?? s[0]), phrase.interim].filter(Boolean).join(' ').trim();
    if (alt && !alternatives.includes(alt)) alternatives.push(alt);
  }
  phrase.done = true;
  state.micRequested = false;
  resetPhrase();
  recAbort(); // далі не слухаємо — інакше почуємо власну озвучену відповідь
  handleSpeech(alternatives);
}

function handleNoSpeech() {
  state.micRequested = false;
  if (state.pending) {
    // Тиша під час очікування відповіді: слухаємо ще, але не нескінченно.
    if (++state.pending.silences > MAX_CONFIRM_RETRIES) {
      cancelPending('', `Відповіді не почув. ${state.pending.cancelMessage}`, 'voice');
    }
    return;
  }
  if (state.wantListening && els.continuous.checked) return;
  showResponse(RECOGNITION_ERRORS['no-speech'], 'error');
}

function createRecognition() {
  const r = new SpeechRecognition();
  r.lang = 'uk-UA';
  r.interimResults = true;
  r.maxAlternatives = 3;
  r.continuous = true;
  // Події від покинутої («завислої») сесії ігноруємо.
  const own = (handler) => (event) => {
    if (r === recognition) handler(event);
  };
  r.onstart = own(onRecStart);
  r.onresult = own(onRecResult);
  r.onerror = own(onRecError);
  r.onend = own(onRecEnd);
  return r;
}

function recStart() {
  if (!recognition || isMicActive()) return;
  if (rec.status === 'stopping') {
    rec.queued = true; // запуститься в onend попередньої сесії
    updateMicUi();
    return;
  }
  try {
    recognition.start();
    rec.status = 'starting';
  } catch {
    // Браузер вважає, що сесія ще активна: закриваємо її й запускаємо нову після onend.
    rec.status = 'stopping';
    rec.queued = true;
    try {
      recognition.abort();
    } catch {
      /* немає активної сесії */
    }
  }
  armWatchdog();
  updateMicUi();
}

function recAbort() {
  rec.queued = false;
  if (!isMicActive()) return;
  rec.status = 'stopping';
  state.listening = false;
  armWatchdog();
  recognition.abort();
}

// Якщо браузер так і не надіслав onstart / onend — створюємо нову сесію розпізнавання.
function armWatchdog() {
  clearTimeout(rec.watchdog);
  rec.watchdog = setTimeout(() => {
    if (rec.status !== 'starting' && rec.status !== 'stopping') return;
    const wanted = rec.queued || rec.status === 'starting';
    const stale = recognition;
    recognition = createRecognition();
    try {
      stale.abort();
    } catch {
      /* ігноруємо */
    }
    rec.status = 'idle';
    rec.queued = false;
    state.listening = false;
    meter.stop();
    // Нову сесію запускаємо з невеликою затримкою, щоб стара встигла закритися.
    if (wanted && state.wantListening && rec.retries++ < 1) {
      rec.queued = true;
      updateMicUi();
      return setTimeout(() => {
        rec.queued = false;
        recStart();
      }, 300);
    }
    updateMicUi();
    if (wanted) showResponse('Не вдалося увімкнути мікрофон. Натисніть кнопку ще раз.', 'error');
  }, 3000);
}

function onRecStart() {
  clearTimeout(rec.watchdog);
  rec.status = 'listening';
  rec.retries = 0;
  state.listening = true;
  phrase.done = false;
  resetPhrase();
  phrase.noSpeechTimer = setTimeout(() => {
    if (phraseText() || phrase.done) return;
    phrase.done = true;
    recAbort();
    handleNoSpeech();
  }, NO_SPEECH_TIMEOUT);
  beep();
  updateMicUi();
  meter.start();
}

function onRecResult(event) {
  if (phrase.done) return;
  clearTimeout(phrase.noSpeechTimer);
  // Перебудовуємо фразу з усіх результатів сесії: завершені шматки + поточний проміжний.
  const segments = [];
  let interim = '';
  for (const result of event.results) {
    if (result.isFinal) {
      const alternatives = Array.from(result, (a) => a.transcript.trim()).filter(Boolean);
      if (alternatives.length) segments.push(alternatives);
    } else {
      interim += result[0].transcript;
    }
  }
  phrase.segments = segments;
  phrase.interim = interim.trim();
  showTranscript(phraseText(), Boolean(phrase.interim));

  clearTimeout(phrase.silenceTimer);
  const pause = pauseMs();
  phrase.silenceTimer = setTimeout(commitPhrase, pause);
  showPauseProgress(pause);
}

function onRecError(event) {
  if (event.error === 'aborted') return;
  if (event.error === 'no-speech') {
    if (phraseText()) commitPhrase();
    else if (!phrase.done) {
      phrase.done = true;
      handleNoSpeech();
    }
    return;
  }
  state.micRequested = false;
  if (event.error === 'not-allowed' || event.error === 'service-not-allowed') state.wantListening = false;
  showResponse(RECOGNITION_ERRORS[event.error] ?? `Помилка розпізнавання: ${event.error}`, 'error');
}

function onRecEnd() {
  clearTimeout(rec.watchdog);
  rec.status = 'idle';
  state.listening = false;
  meter.stop();
  if (!phrase.done && phraseText()) commitPhrase(); // браузер сам закрив сесію посеред фрази
  resetPhrase();
  if (rec.queued) {
    // Користувач натиснув кнопку, поки попередня сесія закривалася, — запускаємо зараз.
    rec.queued = false;
    return recStart();
  }
  if (!els.continuous.checked && !state.pending && !state.micRequested) state.wantListening = false;
  updateMicUi();
  resumeIfContinuous();
}

if (SpeechRecognition) {
  recognition = createRecognition();
} else {
  els.warning.hidden = false;
  els.mic.disabled = true;
  els.micHint.textContent = 'Голосове керування недоступне в цьому браузері';
}

function startListening() {
  if (!recognition) return;
  state.wantListening = true;
  recStart();
}

// Натискання кнопки під час слухання: якщо вже щось сказано — виконати зараз, інакше зупинитися.
function stopListening() {
  if (phraseText()) return commitPhrase();
  state.wantListening = false;
  state.micRequested = false;
  phrase.done = true;
  recAbort();
  updateMicUi();
}

// Автоматичне ввімкнення мікрофона після відповіді: у безперервному режимі, під час уточнення
// (так/ні, нове значення) або якщо користувач натиснув кнопку, поки система відповідала.
function resumeIfContinuous() {
  if (!state.wantListening || state.speaking || state.busy || isMicActive()) return;
  if (!els.continuous.checked && !state.pending && !state.micRequested) return;
  setTimeout(() => {
    if (state.wantListening && !state.speaking && !state.busy && !isMicActive()) recStart();
  }, 150);
}

/* ---------- Обробка команд ---------- */

// Перевіряє всі варіанти розпізнавання: 'yes' | 'no' | null.
function classifyAnswer(alternatives) {
  for (const alt of alternatives) {
    const answer = simplify(alt);
    if (NO.test(answer)) return 'no';
    if (YES.test(answer)) return 'yes';
  }
  return null;
}

// Відповідь на запитання системи: «так/ні» для видалення або нове значення для оновлення.
// Повертає true, якщо фразу оброблено як відповідь (а не як нову команду).
function answerPending(text, alternatives, source) {
  const pending = state.pending;

  if (pending.kind === 'value') {
    const said = simplify(text);
    if (CANCEL.test(said)) {
      cancelPending(text, pending.cancelMessage, source);
      return true;
    }
    clearPending();
    if (COMMAND_START.test(said)) return false; // замість значення сказали нову команду
    runCommand(`${pending.text} на ${text}`, { source, said: text });
    return true;
  }

  const answer = classifyAnswer(alternatives);
  if (answer) {
    resolvePending(answer === 'yes', source, text);
    return true;
  }
  // Коротка нерозбірлива фраза — перепитуємо; довга — це вже нова команда.
  if (source === 'voice' && simplify(text).split(' ').length < 3 && pending.retries < MAX_CONFIRM_RETRIES) {
    pending.retries++;
    const message = 'Не зрозумів відповідь. Скажіть «так» або «ні».';
    showResponse(message, 'warn');
    addLog(text, message, 'warn', source);
    speak('Так чи ні?');
    return true;
  }
  clearPending();
  return false;
}

function handleSpeech(alternatives) {
  const [text] = alternatives;
  showTranscript(text);
  if (state.pending && answerPending(text, alternatives, 'voice')) return;
  runCommand(text, { alternatives: alternatives.slice(1), source: 'voice' });
}

function clearPending() {
  state.pending = null;
  els.confirm.hidden = true;
}

function cancelPending(said, message, source) {
  clearPending();
  showResponse(message, 'warn');
  if (said) addLog(said, message, 'warn', source);
  if (!els.continuous.checked) state.wantListening = false;
  speak(message);
}

function resolvePending(confirmed, source, said) {
  const { text, cancelMessage } = state.pending;
  if (!confirmed) return cancelPending(said, cancelMessage, source);
  clearPending();
  runCommand(text, { confirmed: true, source, said });
}

async function runCommand(text, { alternatives = [], confirmed = false, source = 'text', said = text } = {}) {
  if (source === 'text') showTranscript(text);
  state.busy = true;
  updateMicUi();

  let data;
  try {
    const response = await fetch('/api/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, alternatives, confirmed }),
    });
    data = await response.json();
  } catch {
    data = { ok: false, message: 'Сервер недоступний. Перевірте, чи запущено команду npm start.' };
  } finally {
    state.busy = false;
    updateMicUi();
  }

  const status = !data.ok ? 'error' : data.needsConfirmation || data.needsValue ? 'warn' : 'ok';
  showResponse(data.message, status);
  addLog(said, data.message, status, source);
  if (data.rows) renderTable(data.rows, data.title, data.highlight);

  if (data.needsConfirmation || data.needsValue) {
    state.pending = data.needsConfirmation
      ? { kind: 'confirm', text: data.recognized, cancelMessage: 'Видалення скасовано.', retries: 0, silences: 0 }
      : { kind: 'value', text: data.recognized, cancelMessage: 'Зміну скасовано.', retries: 0, silences: 0 };
    els.confirm.hidden = !data.needsConfirmation;
    // Після голосової команди автоматично слухаємо відповідь.
    if (source === 'voice') state.wantListening = true;
    else if (data.needsValue) els.textInput.focus();
  }
  speak(data.speech ?? data.message);
}

async function loadAll() {
  try {
    const response = await fetch('/api/employees');
    const { rows } = await response.json();
    renderTable(rows);
  } catch {
    showResponse('Не вдалося завантажити дані. Перевірте, чи запущено сервер.', 'error');
  }
}

/* ---------- Події інтерфейсу ---------- */

els.mic.addEventListener('click', () => {
  if (isMicActive() || rec.queued || (state.micRequested && (state.busy || state.speaking))) return stopListening();
  stopSpeaking();
  state.micRequested = true;
  startListening();
});

// Пробіл вмикає мікрофон, навіть якщо фокус на іншій кнопці (інакше Пробіл «натиснув» би її).
const isTyping = (el) => el.closest('input, textarea, select, [contenteditable]');
document.addEventListener('keydown', (event) => {
  if (event.code !== 'Space' || isTyping(event.target)) return;
  event.preventDefault();
  if (!event.repeat) els.mic.click();
});
document.addEventListener('keyup', (event) => {
  if (event.code === 'Space' && !isTyping(event.target)) event.preventDefault();
});

els.textForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = els.textInput.value.trim();
  if (!text) return;
  els.textInput.value = '';
  if (state.pending && answerPending(text, [text], 'text')) return;
  runCommand(text);
});

els.confirmYes.addEventListener('click', () => state.pending && resolvePending(true, 'text', 'Так'));
els.confirmNo.addEventListener('click', () => state.pending && resolvePending(false, 'text', 'Ні'));
els.showAll.addEventListener('click', loadAll);
els.clearLog.addEventListener('click', () => {
  els.log.replaceChildren();
  els.logEmpty.hidden = false;
});
// Обрана пауза запам'ятовується в браузері (якщо сховище недоступне — просто типове значення).
try {
  const saved = localStorage.getItem('pauseMs');
  if (saved && [...els.pause.options].some((o) => o.value === saved)) els.pause.value = saved;
} catch {
  /* немає доступу до localStorage */
}
els.pause.addEventListener('change', () => {
  try {
    localStorage.setItem('pauseMs', els.pause.value);
  } catch {
    /* немає доступу до localStorage */
  }
});

els.continuous.addEventListener('change', () => {
  if (!els.continuous.checked && !state.listening) state.wantListening = false;
});

for (const example of EXAMPLES) {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'chip';
  chip.textContent = example;
  chip.addEventListener('click', () => {
    clearPending();
    runCommand(example);
  });
  els.examples.append(chip);
}

drawLevel(null);
loadAll();
