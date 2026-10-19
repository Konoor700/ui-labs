// Екран калібрування погляду: 9 точок для навчання моделі, потім 4 контрольні точки для оцінки похибки.
// Після оцінки модель донавчається на всіх 13 точках; на екрані результату — живий приціл для перевірки.
import { CALIBRATION_POINTS, VALIDATION_POINTS, fit, evaluate, predict, pixelsToDegrees, dropOutliers } from './gaze-calibration.js';
import { SMOOTHING } from './eye-tracker.js';

const mean = (rows) => rows[0].map((_, i) => rows.reduce((s, r) => s + r[i], 0) / rows.length);
const MIN_PER_POINT = 5; // кадрів з видимими очима на точку
const TOTAL = CALIBRATION_POINTS.length + VALIDATION_POINTS.length;
const STORE_KEY = 'vr-eye-smoothing';

export class EyeCalibration {
  constructor({ tracker, layer }) {
    this.tracker = tracker;
    this.layer = layer;
    this.dot = layer.querySelector('.calib-dot');
    this.box = layer.querySelector('.calib-box');
    this.marks = layer.querySelector('.calib-marks');
    this.count = layer.querySelector('.calib-count');
    this.live = layer.querySelector('.calib-live');
    // settle — час, щоб погляд «долетів» до точки; collect — збір кадрів (точка поступово стискається).
    this.timing = { settle: 1000, collect: 1500 };
    this.running = false;
    this.initSmoothing();
  }

  // Вибір плавності прицілу (запам’ятовується в браузері).
  initSmoothing() {
    const select = this.el('smooth');
    select.replaceChildren(...Object.entries(SMOOTHING).map(([value, s]) => new Option(s.label, value)));
    let saved = null;
    try {
      saved = localStorage.getItem(STORE_KEY);
    } catch {
      /* без localStorage — типове значення */
    }
    this.tracker.setSmoothing(saved ?? 'medium');
    select.value = this.tracker.smoothing;
    select.addEventListener('change', () => {
      this.tracker.setSmoothing(select.value);
      try {
        localStorage.setItem(STORE_KEY, select.value);
      } catch {
        /* не збереглося — не страшно */
      }
    });
  }

  el(name) {
    return this.layer.querySelector(`[data-calib="${name}"]`);
  }

  // Повертає { model, meanPx, maxPx, deg, … } або null, якщо скасовано.
  async run() {
    this.running = true;
    this.cancelled = false;
    this.layer.hidden = false;
    const previous = this.tracker.model;
    let result = null;
    try {
      for (;;) {
        if (!(await this.intro())) return null;
        result = await this.measure();
        if (!result) return null;
        const done = await this.showResult(result);
        if (done === null) return (result = null);
        if (done) return result;
      }
    } finally {
      if (!result) this.tracker.setModel(previous); // скасовано — лишаємо попереднє калібрування
      cancelAnimationFrame(this.liveFrame);
      this.live.hidden = true;
      this.count.hidden = true;
      this.running = false;
      this.layer.hidden = true;
      this.dot.hidden = true;
      this.layer.classList.remove('is-measuring');
      this.marks.replaceChildren();
      clearInterval(this.faceTimer);
    }
  }

  cancel() {
    this.cancelled = true;
    this.resolveChoice?.(null);
  }

  // Пояснення + живий стан «обличчя видно / не видно». Чекаємо кнопку «Почати» або пробіл.
  intro(error) {
    this.box.hidden = false;
    this.dot.hidden = true;
    this.marks.replaceChildren();
    this.el('title').textContent = 'Калібрування погляду';
    this.el('text').textContent = error
      ?? 'Сядьте рівно на відстані 50–70 см від екрана, обличчя має бути добре освітлене спереду. Під час калібрування не рухайте головою — лише очима дивіться в центр точки, поки вона стискається й не перескочить далі (13 точок, ≈ 35 с). Кліпати можна — такі кадри відкидаються.';
    this.el('go').textContent = 'Почати';
    this.el('retry').hidden = true;
    const face = this.el('face');
    const showFace = () => {
      const ok = this.tracker.faceVisible;
      face.textContent = ok ? (this.tracker.last.blink ? 'Обличчя знайдено (очі закриті)' : 'Обличчя знайдено, очі видно') : 'Обличчя не видно — подивіться в камеру';
      face.dataset.ok = String(ok);
    };
    showFace();
    clearInterval(this.faceTimer);
    this.faceTimer = setInterval(showFace, 200);
    return this.choice().then((go) => {
      clearInterval(this.faceTimer);
      return go;
    });
  }

  choice() {
    return new Promise((resolve) => {
      const finish = (value) => {
        this.el('go').onclick = null;
        this.el('cancel').onclick = null;
        this.el('retry').onclick = null;
        document.removeEventListener('keydown', onKey, true);
        this.resolveChoice = null;
        resolve(value);
      };
      const onKey = (e) => {
        if (e.code === 'Space' || e.code === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          finish(true);
        }
      };
      this.resolveChoice = finish;
      this.el('go').onclick = () => finish(true);
      this.el('cancel').onclick = () => finish(null);
      this.el('retry').onclick = () => finish(false);
      document.addEventListener('keydown', onKey, true);
    });
  }

  sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // Показати точку, дати очам «долетіти», зібрати ознаки.
  async gather([x, y], index) {
    this.count.hidden = false;
    this.count.textContent = `Точка ${index} з ${TOTAL}${index > CALIBRATION_POINTS.length ? ' (контрольна)' : ''}`;
    this.dot.hidden = false;
    this.dot.classList.remove('is-collect');
    this.dot.style.transitionDuration = '0s';
    this.dot.style.left = `${x * 100}%`;
    this.dot.style.top = `${y * 100}%`;
    await this.sleep(this.timing.settle);
    if (this.cancelled) return [];
    this.dot.style.transitionDuration = `${this.timing.collect}ms`;
    this.dot.classList.add('is-collect');
    this.tracker.collect();
    await this.sleep(this.timing.collect);
    // Відкидаємо першу чверть (очі ще могли «доводитися» до точки) і кадри-викиди.
    const samples = this.tracker.stopCollect();
    return dropOutliers(samples.slice(Math.floor(samples.length / 4)));
  }

  async measure() {
    this.box.hidden = true;
    this.layer.classList.add('is-measuring');
    const train = [];
    for (const [i, point] of CALIBRATION_POINTS.entries()) {
      const samples = await this.gather(point, i + 1);
      if (this.cancelled) return null;
      if (samples.length < MIN_PER_POINT) return this.retryIntro('Не вдалося побачити очі на одній з точок. Перевірте освітлення й те, що обличчя повністю в кадрі, і спробуйте ще раз.');
      train.push(...samples.map((f) => ({ f, x: point[0], y: point[1] })));
    }
    const checkModel = fit(train);
    const check = [];
    const extra = [];
    for (const [i, point] of VALIDATION_POINTS.entries()) {
      const samples = await this.gather(point, CALIBRATION_POINTS.length + i + 1);
      if (this.cancelled) return null;
      if (samples.length < MIN_PER_POINT) return this.retryIntro('Під час перевірки очі не було видно. Спробуйте ще раз.');
      check.push({ f: mean(samples), x: point[0], y: point[1] });
      extra.push(...samples.map((f) => ({ f, x: point[0], y: point[1] })));
    }
    this.dot.hidden = true;
    this.count.hidden = true;
    this.layer.classList.remove('is-measuring');
    const { width, height } = this.layer.getBoundingClientRect();
    // Похибку чесно рахуємо моделлю, яка контрольних точок не бачила; для роботи — донавчаємо на всіх 13.
    const err = evaluate(checkModel, check, { width, height });
    const model = fit([...train, ...extra]);
    return { model, checkModel, meanPx: err.mean, maxPx: err.max, deg: pixelsToDegrees(err.mean), check, width, height };
  }

  async retryIntro(message) {
    this.dot.hidden = true;
    this.layer.classList.remove('is-measuring');
    if (!(await this.intro(message))) return null;
    return this.measure();
  }

  // Результат: контрольні точки (кола) і де система «бачила» погляд (хрестики).
  showResult(result) {
    this.marks.replaceChildren(...result.check.flatMap((c) => {
      const p = predict(result.checkModel, c.f);
      const target = document.createElement('span');
      target.className = 'calib-target';
      Object.assign(target.style, { left: `${c.x * 100}%`, top: `${c.y * 100}%` });
      const est = document.createElement('span');
      est.className = 'calib-est';
      Object.assign(est.style, { left: `${p.x * 100}%`, top: `${p.y * 100}%` });
      return [target, est];
    }));
    const px = Math.round(result.meanPx);
    const verdict = result.meanPx < 80 ? 'Точності достатньо для вибору кнопок меню.'
      : result.meanPx < 150 ? 'Точність середня: великі кнопки обиратимуться, дрібні — можуть «промахуватися».'
        : 'Точність низька — краще повторити (більше світла, голову не рухати).';
    this.el('title').textContent = 'Калібрування завершено';
    this.el('text').textContent = `Середня похибка на контрольних точках: ${px} пікс. (≈ ${result.deg.toFixed(1).replace('.', ',')}° за відстані 60 см), найбільша — ${Math.round(result.maxPx)} пікс. ${verdict} Кола — контрольні точки, хрестики — куди, за оцінкою системи, ви дивилися. Жовта точка — живий приціл: подивіться на кола й перевірте, чи він за вами встигає.`;
    this.el('face').textContent = '';
    this.tracker.setModel(result.model);
    this.live.hidden = false;
    const follow = () => {
      const p = this.tracker.gazePoint();
      this.live.style.visibility = p ? 'visible' : 'hidden';
      if (p) Object.assign(this.live.style, { left: `${p.x * 100}%`, top: `${p.y * 100}%` });
      this.liveFrame = requestAnimationFrame(follow);
    };
    follow();
    this.el('go').textContent = 'Готово';
    this.box.hidden = false;
    this.el('retry').hidden = false;
    return this.choice().then((v) => {
      this.el('retry').hidden = true;
      cancelAnimationFrame(this.liveFrame);
      this.live.hidden = true;
      return v; // true — готово, false — повторити, null — скасувати
    });
  }
}
