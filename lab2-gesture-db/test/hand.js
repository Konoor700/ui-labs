// Генератор синтетичної руки (21 точка у форматі MediaPipe) для тестів рушія жестів.
// (x, y) — центр долоні (точка 9) у координатах кадру 0..1, s — розмір долоні (зап'ясток → точка 9).

const OPEN = [
  [0, 0], // 0 зап'ясток
  [-0.35, -0.15], [-0.55, -0.35], [-0.7, -0.55], [-0.8, -0.75], // 1–4 великий
  [-0.3, -0.95], [-0.33, -1.35], [-0.35, -1.6], [-0.37, -1.8], // 5–8 вказівний
  [0, -1.0], [0, -1.45], [0, -1.72], [0, -1.95], // 9–12 середній
  [0.25, -0.95], [0.27, -1.38], [0.28, -1.62], [0.29, -1.82], // 13–16 безіменний
  [0.47, -0.85], [0.52, -1.15], [0.55, -1.33], [0.57, -1.5], // 17–20 мізинець
];

// Зігнутий палець: кінчик повертається до основи.
function curl(points, mcp) {
  const [mx, my] = points[mcp];
  points[mcp + 1] = [mx, my - 0.25];
  points[mcp + 2] = [mx, my - 0.1];
  points[mcp + 3] = [mx, my + 0.15];
}

const POSES = {
  open: () => OPEN.map((p) => [...p]),
  fist: () => {
    const p = OPEN.map((q) => [...q]);
    [5, 9, 13, 17].forEach((mcp) => curl(p, mcp));
    p[4] = [-0.1, -0.75]; // великий палець поперек кулака — близько до вказівного
    return p;
  },
  point: () => {
    const p = OPEN.map((q) => [...q]);
    [9, 13, 17].forEach((mcp) => curl(p, mcp));
    p[4] = [-0.1, -0.75];
    return p;
  },
  pinch: () => {
    const p = OPEN.map((q) => [...q]);
    p[6] = [-0.45, -1.25];
    p[7] = [-0.55, -1.15];
    p[8] = [-0.6, -1.0];
    p[4] = [-0.62, -0.98]; // кінчики великого й вказівного торкаються («OK»)
    return p;
  },
};

export function hand({ x = 0.5, y = 0.5, s = 0.18, pose = 'open' } = {}) {
  const wristX = x;
  const wristY = y + s; // точка 9 опиняється рівно в (x, y)
  return POSES[pose]().map(([rx, ry]) => ({ x: wristX + rx * s, y: wristY + ry * s, z: 0 }));
}

// Послідовність кадрів 30 FPS: fn(progress 0..1) → параметри руки.
export function frames(engine, { from, duration, fps = 30, category, score = 0.9, ...rest }, fn) {
  const events = [];
  const n = Math.max(1, Math.round((duration / 1000) * fps));
  for (let i = 0; i <= n; i++) {
    const t = from + (i * duration) / n;
    const params = fn ? fn(i / n) : rest;
    events.push(...engine.update({ t, landmarks: hand(params), category: params.category ?? category, score }));
  }
  return { events, end: from + duration };
}

export const commandsOf = (events) => events.filter((e) => e.type === 'command').map((e) => e.name);
