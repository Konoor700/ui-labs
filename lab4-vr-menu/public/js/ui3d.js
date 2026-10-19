// 3D-елементи інтерфейсу: панелі й кнопки, текст яких малюється на canvas (українська, будь-який шрифт).
// Кнопка — площина, що реагує на наведення (погляд, промінь, рука) і показує прогрес вибору поглядом.
import * as THREE from 'three';

const PX = 900; // пікселів canvas на метр
const FONT = '"Segoe UI", Arial, sans-serif';

const COLORS = {
  panel: 'rgba(24, 27, 33, 0.94)',
  button: 'rgba(52, 58, 68, 0.97)',
  hover: 'rgba(58, 104, 170, 0.98)',
  accent: 'rgba(46, 125, 72, 0.98)',
  danger: 'rgba(160, 52, 44, 0.98)',
  disabled: 'rgba(52, 58, 68, 0.45)',
  text: '#ffffff',
  sub: '#c4cad3',
  progress: '#ffd166',
};

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

// Перенесення тексту по словах у межах ширини.
function wrap(ctx, text, maxWidth) {
  const lines = [];
  for (const paragraph of String(text).split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    lines.push(line);
  }
  return lines;
}

function makeMesh(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * PX);
  canvas.height = Math.round(h * PX);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
  mesh.renderOrder = 2;
  return { mesh, canvas, texture };
}

/**
 * Панель з текстом (не інтерактивна).
 * lines: [{ text, size, color, bold, align }]
 */
export function makePanel({ w, h, lines = [], background = COLORS.panel, padding = 0.03, radius = 0.025 }) {
  const { mesh, canvas, texture } = makeMesh(w, h);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = background;
  roundRect(ctx, 0, 0, canvas.width, canvas.height, radius * PX);
  ctx.fill();
  let y = padding * PX;
  for (const line of lines) {
    const size = (line.size ?? 0.028) * PX;
    ctx.font = `${line.bold ? 600 : 400} ${size}px ${FONT}`;
    ctx.fillStyle = line.color ?? COLORS.text;
    ctx.textBaseline = 'top';
    ctx.textAlign = line.align ?? 'left';
    const x = line.align === 'center' ? canvas.width / 2 : line.align === 'right' ? canvas.width - padding * PX : padding * PX;
    for (const l of wrap(ctx, line.text, canvas.width - 2 * padding * PX)) {
      ctx.fillText(l, x, y);
      y += size * 1.3;
    }
    y += (line.gap ?? 0.008) * PX;
  }
  texture.needsUpdate = true;
  mesh.renderOrder = 1;
  return mesh;
}

/**
 * Кнопка. options: { id, w, h, label, sub, variant ('default'|'accent'|'danger'), disabled, selected, size, onSelect }
 * Стан кнопки змінюють: setHover(bool), setProgress(0…1), flash().
 */
export function makeButton(options) {
  const { w, h } = options;
  const { mesh, canvas, texture } = makeMesh(w, h);
  const ctx = canvas.getContext('2d');
  const state = { hover: false, progress: 0 };

  function draw() {
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const base = options.disabled ? COLORS.disabled
      : state.hover ? COLORS.hover
      : options.variant === 'accent' ? COLORS.accent
      : options.variant === 'danger' ? COLORS.danger
      : COLORS.button;
    ctx.fillStyle = base;
    roundRect(ctx, 0, 0, W, H, Math.min(0.02 * PX, H / 2));
    ctx.fill();
    if (options.selected || state.hover) {
      ctx.strokeStyle = state.hover ? '#ffffff' : COLORS.progress;
      ctx.lineWidth = 0.004 * PX;
      roundRect(ctx, 2, 2, W - 4, H - 4, Math.min(0.02 * PX, H / 2));
      ctx.stroke();
    }
    const size = (options.size ?? 0.03) * PX;
    ctx.fillStyle = options.disabled ? '#8a9099' : COLORS.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${size}px ${FONT}`;
    const labelLines = wrap(ctx, options.label, W - 0.02 * PX);
    const subSize = size * 0.68;
    const blockH = labelLines.length * size * 1.15 + (options.sub ? subSize * 1.3 : 0);
    // Текст по центру або внизу кнопки (у картках страв зверху — мініатюра).
    let y = options.valign === 'bottom' ? H - blockH - 0.022 * PX + size * 0.58 : H / 2 - blockH / 2 + size * 0.58;
    for (const l of labelLines) {
      ctx.fillText(l, W / 2, y);
      y += size * 1.15;
    }
    if (options.sub) {
      ctx.font = `400 ${subSize}px ${FONT}`;
      ctx.fillStyle = options.disabled ? '#7b818a' : COLORS.sub;
      ctx.fillText(options.sub, W / 2, y - size * 0.15 + subSize * 0.3);
    }
    // Прогрес вибору поглядом — смужка внизу кнопки.
    if (state.progress > 0) {
      ctx.fillStyle = COLORS.progress;
      ctx.fillRect(0.012 * PX, H - 0.012 * PX, (W - 0.024 * PX) * state.progress, 0.006 * PX);
    }
    texture.needsUpdate = true;
  }

  draw();
  mesh.userData = {
    id: options.id,
    interactive: !options.disabled,
    onSelect: options.onSelect,
    setHover(v) {
      if (state.hover === v) return;
      state.hover = v;
      mesh.position.z = (mesh.userData.baseZ ?? 0) + (v ? 0.008 : 0); // кнопка «підстрибує» назустріч
      draw();
    },
    setProgress(v) {
      const p = Math.round(v * 40) / 40;
      if (state.progress === p) return;
      state.progress = p;
      draw();
    },
  };
  return mesh;
}

// Підпис-спрайт, що завжди повернутий до користувача (назви інгредієнтів).
export function makeLabel(text, { size = 0.028, color = '#ffffff', background = 'rgba(24,27,33,0.82)' } = {}) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const px = size * PX;
  ctx.font = `500 ${px}px ${FONT}`;
  const w = Math.ceil(ctx.measureText(text).width + px * 1.0);
  const h = Math.ceil(px * 1.6);
  canvas.width = w;
  canvas.height = h;
  ctx.font = `500 ${px}px ${FONT}`;
  ctx.fillStyle = background;
  roundRect(ctx, 0, 0, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, px * 0.5, h / 2 + 1);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(w / PX, h / PX, 1);
  sprite.renderOrder = 3;
  return sprite;
}

export function disposeTree(object) {
  object.traverse((o) => {
    o.geometry?.dispose();
    const materials = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of materials) {
      m.map?.dispose();
      m.dispose();
    }
  });
}
