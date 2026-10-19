// 3D-відображення виміру: точки-кубики, лінії між ними, підписи відстаней, «прев'ю» до прицілу,
// заливка замкненого контуру. Однаково працює в симуляторі та в справжньому AR (WebXR).
import * as THREE from 'three';
import { distance, formatLength, newellNormal } from './geometry.js';

const LINE_COLOR = 0xd4f542; // жовто-зелений, як у AR-рулетках
const POINT_COLOR = 0xd0d0d0;
const SELECTED_COLOR = 0xff8a00;
const v3 = (p) => new THREE.Vector3(p.x, p.y, p.z);

// Підпис — спрайт із текстом на темній підкладці; завжди видимий поверх сцени.
function makeLabel(text) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const font = '600 44px "Segoe UI", Arial, sans-serif';
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 36;
  canvas.width = w;
  canvas.height = 72;
  ctx.font = font;
  ctx.fillStyle = 'rgba(20,20,20,0.82)';
  ctx.beginPath();
  ctx.roundRect(0, 0, w, 72, 14);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 18, 38);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
  const height = 0.05; // ~5 см заввишки
  sprite.scale.set((height * w) / 72, height, 1);
  sprite.renderOrder = 10;
  return sprite;
}

// Відрізок — тонкий циліндр (звичайні лінії WebGL завжди товщиною 1 піксель).
function makeSegment(a, b, radius = 0.004, color = LINE_COLOR) {
  const start = v3(a);
  const end = v3(b);
  const len = start.distanceTo(end);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 8), new THREE.MeshBasicMaterial({ color }));
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().sub(start).normalize());
  mesh.renderOrder = 5;
  return mesh;
}

function disposeTree(object) {
  object.traverse((o) => {
    o.geometry?.dispose();
    if (o.material) {
      o.material.map?.dispose();
      o.material.dispose();
    }
  });
}

export class MeasureLayer {
  constructor(scene) {
    this.group = new THREE.Group();
    this.preview = new THREE.Group();
    // Підсвічування точки, до якої «прилипає» приціл: напівпрозора помаранчева сфера.
    this.snapMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.03, 20, 14),
      new THREE.MeshBasicMaterial({ color: SELECTED_COLOR, transparent: true, opacity: 0.45, depthTest: false }),
    );
    this.snapMarker.renderOrder = 9;
    this.snapMarker.visible = false;
    scene.add(this.group, this.preview, this.snapMarker);
    this.unit = 'cm';
  }

  setSnap(point) {
    this.snapMarker.visible = Boolean(point);
    if (point) this.snapMarker.position.copy(v3(point));
  }

  clear(group) {
    for (const child of [...group.children]) {
      group.remove(child);
      disposeTree(child);
    }
  }

  update(measurement, selectedId) {
    this.clear(this.group);
    const { points, closed } = measurement;

    points.forEach((p, i) => {
      const selected = p.id === selectedId;
      const size = selected ? 0.032 : 0.022;
      const cube = new THREE.Mesh(
        new THREE.BoxGeometry(size, size, size),
        new THREE.MeshBasicMaterial({ color: selected ? SELECTED_COLOR : POINT_COLOR }),
      );
      cube.position.copy(v3(p));
      cube.renderOrder = 6;
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(cube.geometry), new THREE.LineBasicMaterial({ color: 0x333333 }));
      cube.add(edges);
      this.group.add(cube);
      const number = makeLabel(String(i + 1));
      number.scale.multiplyScalar(0.55);
      number.position.copy(v3(p)).add(new THREE.Vector3(0, 0.04, 0));
      this.group.add(number);
    });

    const pairs = [];
    for (let i = 1; i < points.length; i++) pairs.push([points[i - 1], points[i]]);
    if (closed && points.length >= 3) pairs.push([points.at(-1), points[0]]);
    for (const [a, b] of pairs) {
      this.group.add(makeSegment(a, b));
      const label = makeLabel(formatLength(distance(a, b), this.unit));
      label.position.copy(v3(a)).add(v3(b)).multiplyScalar(0.5).add(new THREE.Vector3(0, 0.035, 0));
      this.group.add(label);
    }

    // Заливка замкненого контуру (у площині контуру).
    if (closed && points.length >= 3) {
      const n = newellNormal(points);
      const normal = new THREE.Vector3(n.x, n.y, n.z).normalize();
      if (normal.lengthSq() > 0.5) {
        const origin = v3(points[0]);
        const u = v3(points[1]).sub(origin).normalize();
        const w = normal.clone().cross(u).normalize();
        const shape = new THREE.Shape(points.map((p) => {
          const d = v3(p).sub(origin);
          return new THREE.Vector2(d.dot(u), d.dot(w));
        }));
        const fill = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({
          color: LINE_COLOR, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false,
        }));
        fill.matrixAutoUpdate = false;
        fill.matrix.makeBasis(u, w, normal).setPosition(origin.clone().addScaledVector(normal, 0.003));
        this.group.add(fill);
      }
    }
  }

  // Пунктирна «прев'ю»-лінія від останньої точки до прицілу з поточною відстанню.
  setPreview(from, to) {
    this.clear(this.preview);
    if (!from || !to) return;
    const geometry = new THREE.BufferGeometry().setFromPoints([v3(from), v3(to)]);
    const line = new THREE.Line(geometry, new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.03, gapSize: 0.02, depthTest: false }));
    line.computeLineDistances();
    line.renderOrder = 7;
    this.preview.add(line);
    const label = makeLabel(formatLength(distance(from, to), this.unit));
    label.position.copy(v3(from)).add(v3(to)).multiplyScalar(0.5).add(new THREE.Vector3(0, 0.035, 0));
    label.material.opacity = 0.85;
    this.preview.add(label);
  }
}

// Приціл: кільце з крапкою, що лягає на поверхню за її нормаллю.
export function makeReticle() {
  const group = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.035, 0.048, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.95 }));
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.008, 16), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, depthTest: false }));
  ring.renderOrder = dot.renderOrder = 8;
  group.add(ring, dot);
  group.visible = false;
  return group;
}

// Помаранчевий приціл — «прилипання» до наявної точки, білий — звичайний.
export function setReticleSnapped(reticle, snapped) {
  reticle.traverse((o) => o.material?.color?.set(snapped ? SELECTED_COLOR : 0xffffff));
}

export function placeReticle(reticle, point, normal) {
  reticle.position.set(point.x, point.y, point.z).addScaledVector(normal, 0.003);
  reticle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  reticle.visible = true;
}
