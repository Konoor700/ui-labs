// Віртуальна кімната для симулятора AR: 5 × 4 м, висота 2,7 м; двері, вікно, стіл відомих розмірів.
// Текстури малюються програмно (canvas) — без зовнішніх файлів.
import * as THREE from 'three';

export const ROOM = { width: 5, depth: 4, height: 2.7 };
export const DOOR = { x: -1.0, width: 0.9, height: 2.1 }; // на дальній стіні (z = −2)
export const WINDOW = { z: 0, width: 1.2, height: 1.4, bottom: 0.9 }; // на лівій стіні (x = −2,5)
export const TABLE = { x: 1.2, z: -0.9, length: 1.2, width: 0.7, height: 0.75 };

/* ---------- Процедурні текстури ---------- */

function canvasTexture(w, h, draw, repeat = [1, 1]) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d'), w, h);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(...repeat);
  texture.anisotropy = 8;
  return texture;
}

function noise(ctx, w, h, amount, alpha = 0.06) {
  for (let i = 0; i < amount; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? `rgba(0,0,0,${alpha})` : `rgba(255,255,255,${alpha})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}

const textures = {
  floor: () => canvasTexture(512, 512, (ctx, w, h) => {
    const plank = h / 6;
    for (let i = 0; i < 6; i++) {
      const shade = 150 + Math.floor(Math.random() * 30);
      ctx.fillStyle = `rgb(${shade + 40}, ${shade}, ${shade - 50})`;
      ctx.fillRect(0, i * plank, w, plank);
      ctx.strokeStyle = 'rgba(60,35,15,0.25)';
      for (let k = 0; k < 14; k++) {
        ctx.beginPath();
        const y = i * plank + Math.random() * plank;
        ctx.moveTo(0, y);
        ctx.bezierCurveTo(w * 0.3, y + 4, w * 0.6, y - 4, w, y + 2);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(40,25,10,0.55)';
      ctx.fillRect(0, i * plank, w, 2);
      ctx.fillRect(((i * 197) % w), i * plank, 2, plank);
    }
    noise(ctx, w, h, 4000);
  }, [3, 2.4]),
  wall: () => canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#e6e1d8';
    ctx.fillRect(0, 0, w, h);
    noise(ctx, w, h, 9000, 0.035);
  }, [4, 2]),
  ceiling: () => canvasTexture(64, 64, (ctx, w, h) => {
    ctx.fillStyle = '#f4f3f0';
    ctx.fillRect(0, 0, w, h);
  }),
  door: () => canvasTexture(256, 512, (ctx, w, h) => {
    ctx.fillStyle = '#6b4226';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(30,15,5,0.25)';
    for (let k = 0; k < 40; k++) {
      ctx.beginPath();
      const x = Math.random() * w;
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 6, h);
      ctx.stroke();
    }
    ctx.strokeStyle = '#4a2c17';
    ctx.lineWidth = 6;
    [[0.15, 0.06, 0.7, 0.38], [0.15, 0.52, 0.7, 0.42]].forEach(([x, y, pw, ph]) => ctx.strokeRect(x * w, y * h, pw * w, ph * h));
    ctx.fillStyle = '#c9c9c9';
    ctx.fillRect(w * 0.82, h * 0.48, w * 0.1, h * 0.025);
  }),
  window: () => canvasTexture(256, 300, (ctx, w, h) => {
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#9cc9ef');
    sky.addColorStop(1, '#dcecf8');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f5f5f2';
    ctx.fillRect(w / 2 - 5, 0, 10, h);
    ctx.fillRect(0, h * 0.35, w, 8);
  }),
  table: () => canvasTexture(512, 256, (ctx, w, h) => {
    ctx.fillStyle = '#8a5a34';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(50,25,10,0.3)';
    for (let k = 0; k < 30; k++) {
      ctx.beginPath();
      const y = Math.random() * h;
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(w * 0.3, y + 6, w * 0.7, y - 6, w, y);
      ctx.stroke();
    }
    noise(ctx, w, h, 2000);
  }),
};

/* ---------- Сітка знайденої площини (як в ARCore) ---------- */

const planeVertex = /* glsl */ `
  varying vec2 vLocal;
  void main() {
    vLocal = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const planeFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec2 uCenter;
  uniform float uRadius;
  uniform float uOpacity;
  varying vec2 vLocal;
  float gridLine(float v) {
    float w = fwidth(v);
    return 1.0 - min(abs(fract(v - 0.5) - 0.5) / max(w, 1e-4), 1.0);
  }
  void main() {
    float d = distance(vLocal, uCenter);
    float mask = 1.0 - smoothstep(uRadius - 0.2, uRadius, d);
    vec2 g = vLocal / 0.14;
    float line = max(max(gridLine(g.x), gridLine(g.y)), gridLine((g.x + g.y) * 0.5));
    float alpha = mask * uOpacity * (0.07 + 0.5 * line);
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

function planeOverlay(width, height, color) {
  return new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.ShaderMaterial({
      vertexShader: planeVertex,
      fragmentShader: planeFragment,
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uCenter: { value: new THREE.Vector2() },
        uRadius: { value: 0 },
        uOpacity: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );
}

/* ---------- Побудова кімнати ---------- */

// Поверхня: прямокутник у просторі з власною системою координат (u, v) у метрах.
function addSurface(scene, surfaces, { id, label, color, width, height, position, rotation, material, detectable = true }) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.position.copy(position);
  mesh.rotation.copy(rotation);
  mesh.receiveShadow = true;
  scene.add(mesh);
  mesh.updateMatrixWorld();

  const surface = {
    id, label, width, height, detectable, mesh,
    normal: new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.quaternion).normalize(),
    overlay: null,
    features: null,
    progress: 0, // «впевненість» трекінгу, 1 — поверхню знайдено
    detected: false,
    radius: 0, // наскільки поверхня вже «покрита» (м від точки, де її знайшли)
  };
  mesh.userData.surface = surface;

  if (detectable) {
    surface.overlay = planeOverlay(width, height, color);
    surface.overlay.position.copy(position).addScaledVector(surface.normal, 0.002);
    surface.overlay.rotation.copy(rotation);
    surface.overlay.renderOrder = 1;
    scene.add(surface.overlay);

    // «Характерні точки», які трекінг бачить на поверхні до того, як її знайде.
    const count = Math.round(width * height * 18) + 20;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * width * 0.95;
      positions[i * 3 + 1] = (Math.random() - 0.5) * height * 0.95;
      positions[i * 3 + 2] = 0.004;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setDrawRange(0, 0);
    surface.features = new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0x3ad7ff, size: 0.018, transparent: true, opacity: 0.85, depthWrite: false }));
    surface.features.position.copy(position);
    surface.features.rotation.copy(rotation);
    scene.add(surface.features);
  }
  surfaces.push(surface);
  return surface;
}

export function buildRoom(scene) {
  const { width: W, depth: D, height: H } = ROOM;
  const surfaces = [];
  const wallMaterial = new THREE.MeshStandardMaterial({ map: textures.wall(), roughness: 0.95 });

  addSurface(scene, surfaces, {
    id: 'floor', label: 'підлога', color: '#3cc8ff', width: W, height: D,
    position: new THREE.Vector3(0, 0, 0), rotation: new THREE.Euler(-Math.PI / 2, 0, 0),
    material: new THREE.MeshStandardMaterial({ map: textures.floor(), roughness: 0.75 }),
  });
  addSurface(scene, surfaces, {
    id: 'back', label: 'стіна з дверима', color: '#7cff5a', width: W, height: H,
    position: new THREE.Vector3(0, H / 2, -D / 2), rotation: new THREE.Euler(0, 0, 0), material: wallMaterial,
  });
  addSurface(scene, surfaces, {
    id: 'left', label: 'стіна з вікном', color: '#ff5ad8', width: D, height: H,
    position: new THREE.Vector3(-W / 2, H / 2, 0), rotation: new THREE.Euler(0, Math.PI / 2, 0), material: wallMaterial,
  });
  addSurface(scene, surfaces, {
    id: 'right', label: 'права стіна', color: '#ffd84a', width: D, height: H,
    position: new THREE.Vector3(W / 2, H / 2, 0), rotation: new THREE.Euler(0, -Math.PI / 2, 0), material: wallMaterial,
  });
  addSurface(scene, surfaces, {
    id: 'front', label: 'стіна позаду', color: '#a98bff', width: W, height: H,
    position: new THREE.Vector3(0, H / 2, D / 2), rotation: new THREE.Euler(0, Math.PI, 0), material: wallMaterial,
  });
  // Однотонну стелю трекінг не розпізнає — як і справжній ARCore.
  addSurface(scene, surfaces, {
    id: 'ceiling', label: 'стеля', color: '#ffffff', width: W, height: D, detectable: false,
    position: new THREE.Vector3(0, H, 0), rotation: new THREE.Euler(Math.PI / 2, 0, 0),
    material: new THREE.MeshStandardMaterial({ map: textures.ceiling(), roughness: 1 }),
  });
  const table = TABLE;
  addSurface(scene, surfaces, {
    id: 'table', label: 'стільниця', color: '#ff9a3c', width: table.length, height: table.width,
    position: new THREE.Vector3(table.x, table.height, table.z), rotation: new THREE.Euler(-Math.PI / 2, 0, 0),
    material: new THREE.MeshStandardMaterial({ map: textures.table(), roughness: 0.6 }),
  });

  // Деталі без власних площин: двері, вікно, рами, ніжки й торці стола.
  const props = new THREE.Group();
  const frameMaterial = new THREE.MeshStandardMaterial({ color: 0xf1efe9, roughness: 0.7 });
  const box = (w, h, d, material, x, y, z) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    props.add(mesh);
    return mesh;
  };

  // Двері: полотно на площині стіни (для вимірювання воно — частина стіни) + рама.
  const doorPanel = new THREE.Mesh(new THREE.PlaneGeometry(DOOR.width, DOOR.height), new THREE.MeshStandardMaterial({ map: textures.door(), roughness: 0.6 }));
  doorPanel.position.set(DOOR.x, DOOR.height / 2, -D / 2 + 0.001);
  doorPanel.userData.surface = surfaces.find((s) => s.id === 'back');
  scene.add(doorPanel);
  const f = 0.05;
  box(f, DOOR.height + f, 0.03, frameMaterial, DOOR.x - DOOR.width / 2 - f / 2, (DOOR.height + f) / 2, -D / 2 + 0.015);
  box(f, DOOR.height + f, 0.03, frameMaterial, DOOR.x + DOOR.width / 2 + f / 2, (DOOR.height + f) / 2, -D / 2 + 0.015);
  box(DOOR.width + 2 * f, f, 0.03, frameMaterial, DOOR.x, DOOR.height + f / 2, -D / 2 + 0.015);

  // Вікно на лівій стіні.
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(WINDOW.width, WINDOW.height), new THREE.MeshBasicMaterial({ map: textures.window() }));
  glass.position.set(-W / 2 + 0.001, WINDOW.bottom + WINDOW.height / 2, WINDOW.z);
  glass.rotation.y = Math.PI / 2;
  glass.userData.surface = surfaces.find((s) => s.id === 'left');
  scene.add(glass);
  const wy = WINDOW.bottom + WINDOW.height / 2;
  box(0.06, f, WINDOW.width + 2 * f, frameMaterial, -W / 2 + 0.03, WINDOW.bottom - f / 2, WINDOW.z);
  box(0.03, f, WINDOW.width + 2 * f, frameMaterial, -W / 2 + 0.015, WINDOW.bottom + WINDOW.height + f / 2, WINDOW.z);
  box(0.03, WINDOW.height, f, frameMaterial, -W / 2 + 0.015, wy, WINDOW.z - WINDOW.width / 2 - f / 2);
  box(0.03, WINDOW.height, f, frameMaterial, -W / 2 + 0.015, wy, WINDOW.z + WINDOW.width / 2 + f / 2);

  // Стіл: товщина стільниці 3 см, ніжки.
  const wood = new THREE.MeshStandardMaterial({ color: 0x6e4527, roughness: 0.7 });
  box(table.length, 0.03, table.width, wood, table.x, table.height - 0.015 - 0.0005, table.z);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    box(0.05, table.height - 0.03, 0.05, wood, table.x + sx * (table.length / 2 - 0.06), (table.height - 0.03) / 2, table.z + sz * (table.width / 2 - 0.06));
  }
  // Плінтуси.
  const skirting = new THREE.MeshStandardMaterial({ color: 0xd9d4ca, roughness: 0.8 });
  box(W, 0.07, 0.015, skirting, 0, 0.035, -D / 2 + 0.0075);
  box(0.015, 0.07, D, skirting, W / 2 - 0.0075, 0.035, 0);
  box(W, 0.07, 0.015, skirting, 0, 0.035, D / 2 - 0.0075);
  scene.add(props);

  // Освітлення.
  const hemi = new THREE.HemisphereLight(0xffffff, 0x8a7a66, 1.2);
  const sun = new THREE.DirectionalLight(0xfff3e0, 1.6);
  sun.position.set(-2, 2.4, 0.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const lamp = new THREE.PointLight(0xffffff, 6, 7, 1.6);
  lamp.position.set(0.5, 2.5, 0);
  scene.add(hemi, sun, lamp);

  // Поверхні, по яких робиться «hit-test» (кидання променя).
  const hitMeshes = [...surfaces.map((s) => s.mesh), doorPanel, glass];
  return { surfaces, hitMeshes, lights: { hemi, sun, lamp } };
}

// Локальні координати точки на поверхні (м), у площині її прямокутника.
export function toSurfaceLocal(surface, worldPoint) {
  return surface.mesh.worldToLocal(worldPoint.clone());
}
