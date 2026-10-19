// Ознаки погляду з 478 точок обличчя MediaPipe Face Landmarker (з точками зіниць).
// Положення зіниці відносно куточків ока + поворот голови → вектор ознак для калібрувальної моделі.

// Індекси точок (праве око — праве для людини, на зображенні ліворуч).
export const EYE = {
  right: { outer: 33, inner: 133, top: 159, bottom: 145, iris: 468 },
  left: { inner: 362, outer: 263, top: 386, bottom: 374, iris: 473 },
};
const NOSE = 1;
const CHEEK_R = 234;
const CHEEK_L = 454;
const FOREHEAD = 10;
const CHIN = 152;
export const BLINK_RATIO = 0.12; // висота / ширина ока нижче цього — очі закриті

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const len = (a) => Math.hypot(a.x, a.y);

// Положення зіниці в оці: h — уздовж лінії куточків (0…1, зліва направо на зображенні), v — вгору/вниз.
function eyeRatios(lm, eye, a, b) {
  const p1 = lm[a];
  const p2 = lm[b];
  const axis = sub(p2, p1);
  const width = len(axis) || 1e-6;
  const iris = lm[eye.iris];
  const h = dot(sub(iris, p1), axis) / (width * width);
  const midY = (lm[eye.top].y + lm[eye.bottom].y) / 2;
  const v = (iris.y - midY) / width;
  const openness = Math.abs(lm[eye.bottom].y - lm[eye.top].y) / width;
  return { h, v, openness, width };
}

// Поворот голови: з матриці трансформації обличчя (якщо є) або наближено з точок.
export function headPose(lm, matrix) {
  if (matrix?.length === 16) {
    const m = matrix; // 4×4, по стовпцях
    return { yaw: Math.atan2(m[8], m[10]), pitch: Math.atan2(-m[9], Math.hypot(m[8], m[10])) };
  }
  const faceW = Math.abs(lm[CHEEK_L].x - lm[CHEEK_R].x) || 1e-6;
  const faceH = Math.abs(lm[CHIN].y - lm[FOREHEAD].y) || 1e-6;
  return {
    yaw: (lm[NOSE].x - (lm[CHEEK_L].x + lm[CHEEK_R].x) / 2) / faceW,
    pitch: (lm[NOSE].y - (lm[FOREHEAD].y + lm[CHIN].y) / 2) / faceH,
  };
}

/**
 * @returns { features: number[5] | null, blink: boolean, eyeWidth }
 * features = [h, v, open, yaw, pitch] — положення зіниць (середнє по двох очах), розкриття очей
 * (верхня повіка піднімається, коли дивимося вгору, — це підсилює слабку вертикальну ознаку) + поворот голови.
 */
export function extractFeatures(lm, matrix) {
  if (!lm || lm.length < 478) return { features: null, blink: false };
  const r = eyeRatios(lm, EYE.right, EYE.right.outer, EYE.right.inner);
  const l = eyeRatios(lm, EYE.left, EYE.left.inner, EYE.left.outer);
  const blink = Math.min(r.openness, l.openness) < BLINK_RATIO;
  const { yaw, pitch } = headPose(lm, matrix);
  const features = [(r.h + l.h) / 2, (r.v + l.v) / 2, (r.openness + l.openness) / 2, yaw, pitch];
  return { features: features.every(Number.isFinite) ? features : null, blink, eyeWidth: (r.width + l.width) / 2 };
}
