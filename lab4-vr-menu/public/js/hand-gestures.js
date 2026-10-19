// Жести руки з вебкамери (21 точка MediaPipe) для керування меню без окулярів:
// центр долоні → курсор (промінь), щипок «OK» → вибір, мах відкритою долонею вбік → гортати сторінки.
// Модуль чистий (без DOM), тому його покривають тести.

const LM = { WRIST: 0, THUMB_TIP: 4, INDEX_PIP: 6, INDEX_TIP: 8, MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_TIP: 12, RING_PIP: 14, RING_TIP: 16, PINKY_PIP: 18, PINKY_TIP: 20 };
const BOX = { x0: 0.15, x1: 0.85, y0: 0.12, y1: 0.72 }; // зона кадру, що відображається на весь екран
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const extended = (lm, tip, pip) => dist(lm[tip], lm[LM.WRIST]) > dist(lm[pip], lm[LM.WRIST]) * 1.1;

export function fingers(lm) {
  return {
    index: extended(lm, LM.INDEX_TIP, LM.INDEX_PIP),
    middle: extended(lm, LM.MIDDLE_TIP, LM.MIDDLE_PIP),
    ring: extended(lm, LM.RING_TIP, LM.RING_PIP),
    pinky: extended(lm, LM.PINKY_TIP, LM.PINKY_PIP),
  };
}

export class HandGestures {
  constructor({ pinchOn = 0.3, pinchOff = 0.45, swipeWindow = 500, swipeDist = 0.22, cooldown = 900 } = {}) {
    Object.assign(this, { pinchOn, pinchOff, swipeWindow, swipeDist, cooldown });
    this.reset();
  }

  reset() {
    this.cursor = null;
    this.pinched = false;
    this.trail = [];
    this.cooldownUntil = 0;
  }

  // frame: { t (мс), landmarks | null, category } → події.
  update({ t, landmarks: lm, category }) {
    const events = [];
    if (!lm) {
      if (this.cursor) events.push({ type: 'lost' });
      this.reset();
      return events;
    }
    const palm = { x: 1 - lm[LM.MIDDLE_MCP].x, y: lm[LM.MIDDLE_MCP].y }; // дзеркально
    const target = { x: clamp01((palm.x - BOX.x0) / (BOX.x1 - BOX.x0)), y: clamp01((palm.y - BOX.y0) / (BOX.y1 - BOX.y0)) };
    this.cursor = this.cursor
      ? { x: this.cursor.x + (target.x - this.cursor.x) * 0.45, y: this.cursor.y + (target.y - this.cursor.y) * 0.45 }
      : target;
    events.push({ type: 'cursor', x: this.cursor.x * 2 - 1, y: -(this.cursor.y * 2 - 1) }); // у координатах екрана −1…1

    const f = fingers(lm);
    const others = [f.middle, f.ring, f.pinky].filter(Boolean).length;
    const ratio = dist(lm[LM.THUMB_TIP], lm[LM.INDEX_TIP]) / (dist(lm[LM.WRIST], lm[LM.MIDDLE_MCP]) || 1e-6);
    const fist = category === 'Closed_Fist' || (!f.index && others === 0);
    if (!this.pinched && ratio < this.pinchOn && others >= 2 && !fist) {
      this.pinched = true;
      events.push({ type: 'pinch' });
    } else if (this.pinched && (ratio > this.pinchOff || fist)) {
      this.pinched = false;
    }

    // Мах відкритою долонею вбік.
    const open = category === 'Open_Palm' || (f.index && others === 3);
    this.trail.push({ t, x: palm.x, y: palm.y, open });
    while (this.trail.length && t - this.trail[0].t > this.swipeWindow) this.trail.shift();
    if (t >= this.cooldownUntil && !this.pinched && this.trail.length >= 4) {
      const first = this.trail[0];
      const dx = palm.x - first.x;
      const dy = palm.y - first.y;
      const openShare = this.trail.filter((p) => p.open).length / this.trail.length;
      if (openShare >= 0.7 && Math.abs(dx) >= this.swipeDist && Math.abs(dy) <= 0.6 * Math.abs(dx)) {
        events.push({ type: 'swipe', dir: dx > 0 ? 'right' : 'left' });
        this.cooldownUntil = t + this.cooldown;
        this.trail = [];
      }
    }
    return events;
  }
}
