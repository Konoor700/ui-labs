// Відстеження погляду звичайною вебкамерою: MediaPipe Face Landmarker (478 точок обличчя разом із
// зіницями, локально) → ознаки очей → калібрувальна модель → згладжена точка на екрані.
import { extractFeatures } from './eye-features.js';
import { predict, OneEuroFilter, MedianFilter } from './gaze-calibration.js';

const clamp = (v) => Math.min(1.1, Math.max(-0.1, v));
const STALE_MS = 400; // якщо стільки часу немає нової оцінки (обличчя зникло) — погляд невідомий

// Плавність прицілу: більше — стабільніше, але приціл трохи запізнюється за очима.
export const SMOOTHING = {
  low: { label: 'Слабка (швидкий приціл)', median: 5, minCutoff: 0.6, beta: 3 },
  medium: { label: 'Середня', median: 7, minCutoff: 0.3, beta: 1.5 },
  high: { label: 'Сильна (стабільний приціл)', median: 11, minCutoff: 0.15, beta: 0.8 },
};

export class EyeTracker {
  constructor({ video, onStatus = () => {} }) {
    this.video = video;
    this.onStatus = onStatus;
    this.running = false;
    this.model = null;
    this.setSmoothing('medium');
    this.last = { features: null, blink: false, t: 0 };
    this.point = null; // { x, y, t } — частки області перегляду (0…1)
    this.collector = null;
    this.frames = 0;
    this.detectMs = 0;
  }

  async start() {
    if (this.running) return;
    this.onStatus('Очі: завантаження моделі…');
    const { FaceLandmarker, FilesetResolver } = await import('/vendor/mediapipe/vision_bundle.mjs');
    const fileset = await FilesetResolver.forVisionTasks('/vendor/mediapipe/wasm');
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: '/models/face_landmarker.task', delegate },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFacialTransformationMatrixes: true,
    });
    try {
      this.landmarker = await FaceLandmarker.createFromOptions(fileset, options('GPU'));
    } catch {
      this.landmarker = await FaceLandmarker.createFromOptions(fileset, options('CPU'));
    }
    // Більша роздільність — точніше видно зіниці.
    this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
    this.video.srcObject = this.stream;
    await this.video.play();
    this.running = true;
    this.onStatus('Очі: камера увімкнена');
    let lastTime = -1;
    const loop = () => {
      if (!this.running) return;
      if (this.video.readyState >= 2 && this.video.currentTime !== lastTime) {
        lastTime = this.video.currentTime;
        const t = performance.now();
        const r = this.landmarker.detectForVideo(this.video, t);
        const ms = performance.now() - t;
        this.detectMs = this.frames < 3 ? ms : this.detectMs * 0.9 + ms * 0.1; // перші кадри — «прогрів» моделі
        const { features, blink } = extractFeatures(r.faceLandmarks?.[0], r.facialTransformationMatrixes?.[0]?.data);
        this.handle(features, blink, t);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // Для автотестів: замість камери — функція, що повертає { features, blink }.
  startSimulated(source) {
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      const { features, blink = false } = source();
      this.handle(features, blink, performance.now());
      setTimeout(loop, 33);
    };
    loop();
  }

  handle(features, blink, t) {
    this.frames++;
    this.last = { features, blink, t };
    if (!features || blink) return; // під час моргання тримаємо попередню точку
    this.collector?.push(features);
    if (!this.model) return;
    const p = predict(this.model, features);
    // Спершу медіана (прибирає поодинокі викиди), потім One Euro (гасить дрібне тремтіння).
    const x = this.mx.filter(clamp(p.x));
    const y = this.my.filter(clamp(p.y));
    this.point = { x: this.fx.filter(x, t), y: this.fy.filter(y, t), t };
  }

  get faceVisible() {
    return Boolean(this.last.features) && performance.now() - this.last.t < STALE_MS;
  }

  collect() {
    this.collector = [];
  }

  stopCollect() {
    const samples = this.collector ?? [];
    this.collector = null;
    return samples;
  }

  setSmoothing(level) {
    const s = SMOOTHING[level] ?? SMOOTHING.medium;
    this.smoothing = SMOOTHING[level] ? level : 'medium';
    this.fx = new OneEuroFilter({ minCutoff: s.minCutoff, beta: s.beta });
    this.fy = new OneEuroFilter({ minCutoff: s.minCutoff, beta: s.beta });
    this.mx = new MedianFilter(s.median);
    this.my = new MedianFilter(s.median);
  }

  setModel(model) {
    this.model = model;
    this.fx.reset();
    this.fy.reset();
    this.mx.reset();
    this.my.reset();
    this.point = null;
  }

  // Поточна точка погляду або null, якщо обличчя не видно.
  gazePoint(now = performance.now()) {
    return this.point && now - this.point.t < STALE_MS ? this.point : null;
  }

  stop() {
    this.running = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.point = null;
    this.last = { features: null, blink: false, t: 0 };
    this.onStatus('Очі: вимкнено');
  }
}
