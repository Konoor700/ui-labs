// Рушій жестів: перетворює покадрові результати MediaPipe (21 точка руки + статична поза)
// на події інтерфейсу — команди, підтвердження, «щипок»-клік і позицію курсора.
// Модуль не залежить від DOM, тому його можна тестувати в Node на синтетичних даних.

// Індекси ключових точок руки MediaPipe Hands.
export const LM = {
  WRIST: 0, THUMB_TIP: 4,
  INDEX_MCP: 5, INDEX_PIP: 6, INDEX_TIP: 8,
  MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_TIP: 12,
  RING_PIP: 14, RING_TIP: 16,
  PINKY_PIP: 18, PINKY_TIP: 20,
};

export const COMMANDS = {
  select_all: 'Показати всіх',
  add: 'Додати запис',
  update: 'Оновити запис',
  delete: 'Видалити запис',
};

export const DEFAULTS = {
  mirror: true, // відео показується дзеркально — рухи «вліво/вправо» з точки зору користувача
  minScore: 0.5, // мінімальна впевненість класифікатора MediaPipe
  swipeWindow: 500, // мах має відбутися швидше за 0,5 с
  swipeDistX: 0.22, // … на 22 % ширини кадру вбік
  swipeRatio: 0.6, // вертикальне зміщення не більше 60 % від горизонтального
  swipeOpenShare: 0.7, // ≥ 70 % кадрів маху — відкрита долоня
  circleWindow: 2500,
  circleAngle: 1.5 * Math.PI, // коло — не менше 270°
  circleMinRadius: 0.025,
  circleMaxSpread: 0.55, // відхилення радіуса (овал — так, лінія — ні)
  fistMin: 250, // кулак тримати ≥ 0,25 с …
  fistToPointWindow: 1500, // … і впродовж 1,5 с показати вказівний палець
  pointHold: 300,
  holdMs: 600, // статичний жест (V, палець угору / униз) утримувати 0,6 с
  holdGap: 300, // короткі «провали» розпізнавання під час утримання не скидають відлік
  pinchOn: 0.3, // відстань «великий—вказівний» / розмір долоні
  pinchOff: 0.45,
  cooldown: 1000, // пауза після команди, щоб один рух не спрацював двічі
  cursorBox: { x0: 0.15, x1: 0.85, y0: 0.12, y1: 0.72 }, // зона кадру, що відображається на весь екран
};

// Статичні жести з утриманням і що вони роблять.
const HOLD_ACTIONS = {
  victory: { type: 'command', name: 'select_all' }, // V-жест — «показати всіх»
  thumb_up: { type: 'confirm' }, // великий палець угору — зберегти / так
  thumb_down: { type: 'cancel' }, // великий палець униз — скасувати / ні
};

// Що дозволено в кожному режимі інтерфейсу.
const MODES = {
  command: { commands: true, holds: ['victory'], pinch: true, cursor: true },
  form: { commands: false, holds: ['thumb_up', 'thumb_down'], pinch: true, cursor: true },
  confirm: { commands: false, holds: ['thumb_up', 'thumb_down'], pinch: true, cursor: true },
  test: { commands: true, holds: ['victory', 'thumb_up', 'thumb_down'], pinch: true, cursor: true },
  paused: { commands: false, holds: [], pinch: false, cursor: false },
};

const CATEGORY_POSE = {
  Open_Palm: 'open',
  Closed_Fist: 'fist',
  Pointing_Up: 'point',
  Thumb_Up: 'thumb_up',
  Thumb_Down: 'thumb_down',
  Victory: 'victory',
  ILoveYou: 'love',
};

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Палець розігнутий, якщо кінчик далі від зап'ястка, ніж середній суглоб.
function isExtended(lm, tip, pip) {
  return dist(lm[tip], lm[LM.WRIST]) > dist(lm[pip], lm[LM.WRIST]) * 1.1;
}

export function fingerState(lm) {
  return {
    index: isExtended(lm, LM.INDEX_TIP, LM.INDEX_PIP),
    middle: isExtended(lm, LM.MIDDLE_TIP, LM.MIDDLE_PIP),
    ring: isExtended(lm, LM.RING_TIP, LM.RING_PIP),
    pinky: isExtended(lm, LM.PINKY_TIP, LM.PINKY_PIP),
  };
}

// Поза руки: класифікатор MediaPipe, а якщо він не впевнений — правила за положенням пальців.
export function detectPose(lm, category, score, minScore = DEFAULTS.minScore) {
  if (category && score >= minScore && CATEGORY_POSE[category]) return CATEGORY_POSE[category];
  const f = fingerState(lm);
  const count = [f.index, f.middle, f.ring, f.pinky].filter(Boolean).length;
  if (count >= 4) return 'open';
  if (count === 0) return 'fist';
  if (f.index && !f.middle && !f.ring && !f.pinky) return 'point';
  return 'other';
}

// «Щипок» (жест «OK»): великий і вказівний пальці зімкнуті, а інші пальці розігнуті.
// Умова про інші пальці відсікає кулак, у якому кінчики теж близько.
export function pinchRatio(lm) {
  return dist(lm[LM.THUMB_TIP], lm[LM.INDEX_TIP]) / (dist(lm[LM.WRIST], lm[LM.MIDDLE_MCP]) || 1e-6);
}

function othersExtended(lm) {
  const f = fingerState(lm);
  return [f.middle, f.ring, f.pinky].filter(Boolean).length >= 2;
}

export class GestureEngine {
  constructor(options = {}) {
    this.o = { ...DEFAULTS, ...options, cursorBox: { ...DEFAULTS.cursorBox, ...options.cursorBox } };
    this.mode = 'command';
    this.reset();
  }

  setMode(mode) {
    if (!MODES[mode]) throw new Error(`Невідомий режим: ${mode}`);
    this.mode = mode;
    this.resetMotion();
    this.hold = null;
  }

  reset() {
    this.resetMotion();
    this.present = false;
    this.pose = null;
    this.pinched = false;
    this.hold = null;
    this.cursor = null;
    this.cooldownUntil = 0;
  }

  resetMotion() {
    this.palmTrail = [];
    this.tipTrail = [];
    this.fistSince = null;
    this.fistArmedUntil = 0;
    this.pointSince = null;
  }

  // frame: { t: мс, landmarks: [{x,y,z}×21] | null, category?: string, score?: number }
  update(frame) {
    const events = [];
    const rules = MODES[this.mode];
    const { t } = frame;
    const lm = frame.landmarks;

    if (!lm) {
      if (this.present) events.push({ type: 'hand', present: false });
      if (this.pinched) events.push({ type: 'pinch', phase: 'up' });
      this.reset();
      this.cooldownUntil = 0;
      return events;
    }
    if (!this.present) events.push({ type: 'hand', present: true });
    this.present = true;

    // Координати з точки зору користувача (дзеркально).
    const P = (i) => ({ x: this.o.mirror ? 1 - lm[i].x : lm[i].x, y: lm[i].y });

    const pose = detectPose(lm, frame.category, frame.score ?? 0, this.o.minScore);
    if (pose !== this.pose) events.push({ type: 'pose', pose });
    this.pose = pose;
    this.indexExtended = fingerState(lm).index;

    // Курсор: центр долоні (не залежить від рухів пальців під час «щипка»), зі згладжуванням.
    if (rules.cursor) {
      const palm = P(LM.MIDDLE_MCP);
      const box = this.o.cursorBox;
      const target = { x: clamp01((palm.x - box.x0) / (box.x1 - box.x0)), y: clamp01((palm.y - box.y0) / (box.y1 - box.y0)) };
      if (!this.cursor) this.cursor = target;
      else {
        const speed = Math.hypot(target.x - this.cursor.x, target.y - this.cursor.y);
        const alpha = Math.min(0.8, 0.25 + speed * 4); // швидкий рух — менше згладжування
        this.cursor = { x: this.cursor.x + (target.x - this.cursor.x) * alpha, y: this.cursor.y + (target.y - this.cursor.y) * alpha };
      }
      events.push({ type: 'cursor', x: this.cursor.x, y: this.cursor.y, t });
    }

    // Щипок = клік (з гістерезисом, щоб не «дрижав»).
    if (rules.pinch) {
      const ratio = pinchRatio(lm);
      if (!this.pinched && ratio < this.o.pinchOn && pose !== 'fist' && othersExtended(lm)) {
        this.pinched = true;
        events.push({ type: 'pinch', phase: 'down' });
      } else if (this.pinched && (ratio > this.o.pinchOff || pose === 'fist')) {
        this.pinched = false;
        events.push({ type: 'pinch', phase: 'up' });
      }
    }

    // Статичні жести з утриманням: V — показати всіх, великий палець угору / униз — підтвердити / скасувати.
    if (rules.holds.length) this.updateHold(t, pose, rules.holds, events);

    if (rules.commands && !this.pinched) {
      const command = t >= this.cooldownUntil ? this.detectCommand(t, pose, P) : null;
      if (command) this.fireCommand(t, command, events);
    }
    return events;
  }

  fireCommand(t, name, events) {
    events.push({ type: 'command', name });
    this.cooldownUntil = t + this.o.cooldown;
    this.resetMotion();
  }

  updateHold(t, pose, allowed, events) {
    const holdPose = allowed.includes(pose) ? pose : null;
    // Перерва, довша за holdGap, або інший жест — відлік спочатку.
    if (this.hold && (t - this.hold.lastSeen > this.o.holdGap || (holdPose && holdPose !== this.hold.pose))) {
      if (!this.hold.fired) events.push({ type: 'hold', pose: this.hold.pose, progress: 0 });
      this.hold = null;
    }
    // Класифікатор іноді на мить «губить» позу — короткий провал відлік не скидає.
    if (!holdPose) return;
    this.hold ??= { pose: holdPose, since: t, lastSeen: t, fired: false };
    this.hold.lastSeen = t;
    if (this.hold.fired) return; // для повтору треба опустити руку й знову показати жест
    const progress = Math.min(1, (t - this.hold.since) / this.o.holdMs);
    events.push({ type: 'hold', pose: holdPose, progress });
    if (progress < 1) return;
    this.hold.fired = true;
    const action = HOLD_ACTIONS[holdPose];
    if (action.type === 'command') {
      if (t >= this.cooldownUntil) this.fireCommand(t, action.name, events);
    } else {
      events.push({ type: action.type });
    }
  }

  detectCommand(t, pose, P) {
    const o = this.o;

    // Історія руху долоні (для махів) та кінчика вказівного пальця (для кола).
    this.palmTrail.push({ t, ...P(LM.MIDDLE_MCP), open: pose === 'open' });
    while (this.palmTrail.length && t - this.palmTrail[0].t > o.swipeWindow) this.palmTrail.shift();
    // Під час руху пальця класифікатор може «перескакувати» з «вказівного» на «інше» — враховуємо обидва,
    // якщо вказівний палець розігнутий.
    const pointing = pose === 'point' || (pose === 'other' && this.indexExtended);
    if (pointing) {
      this.tipTrail.push({ t, ...P(LM.INDEX_TIP) });
      while (this.tipTrail.length && t - this.tipTrail[0].t > o.circleWindow) this.tipTrail.shift();
    } else if (this.tipTrail.length && t - this.tipTrail[this.tipTrail.length - 1].t > 200) {
      this.tipTrail = [];
    }

    // Кулак, а потім вказівний палець — «додати».
    if (pose === 'fist') {
      this.fistSince ??= t;
      if (t - this.fistSince >= o.fistMin) this.fistArmedUntil = t + o.fistToPointWindow;
    } else {
      this.fistSince = null;
    }
    if (pose === 'point') {
      this.pointSince ??= t;
      if (t <= this.fistArmedUntil && t - this.pointSince >= o.pointHold) {
        this.fistArmedUntil = 0;
        return 'add';
      }
    } else {
      this.pointSince = null;
    }

    return this.detectSwipe() ?? this.detectCircle();
  }

  // Мах відкритою долонею вбік — «видалити».
  detectSwipe() {
    const o = this.o;
    const trail = this.palmTrail;
    if (trail.length < 4) return null;
    const first = trail[0];
    const last = trail[trail.length - 1];
    if (last.t - first.t < 80) return null;
    if (trail.filter((p) => p.open).length / trail.length < o.swipeOpenShare) return null;
    const dx = last.x - first.x;
    const dy = last.y - first.y;
    if (Math.abs(dx) >= o.swipeDistX && Math.abs(dy) <= o.swipeRatio * Math.abs(dx)) return 'delete';
    return null;
  }

  // Коло вказівним пальцем — «оновити».
  detectCircle() {
    const o = this.o;
    const pts = this.tipTrail;
    if (pts.length < 12) return null;
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const radii = pts.map((p) => Math.hypot(p.x - cx, p.y - cy));
    const meanR = radii.reduce((s, r) => s + r, 0) / radii.length;
    if (meanR < o.circleMinRadius) return null;
    const spread = Math.sqrt(radii.reduce((s, r) => s + (r - meanR) ** 2, 0) / radii.length) / meanR;
    if (spread > o.circleMaxSpread) return null;
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      const a0 = Math.atan2(pts[i - 1].y - cy, pts[i - 1].x - cx);
      const a1 = Math.atan2(pts[i].y - cy, pts[i].x - cx);
      total += wrapAngle(a1 - a0);
    }
    return Math.abs(total) >= o.circleAngle ? 'update' : null;
  }
}
