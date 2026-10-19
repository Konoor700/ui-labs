// Справжня доповнена реальність через WebXR Device API (Chrome на Android використовує ARCore).
// Потрібно: телефон із «Google Play Services for AR» і захищене з'єднання (HTTPS або localhost через `adb reverse`).
import * as THREE from 'three';
import { makeReticle } from '../layer.js';

export async function isArSupported() {
  try {
    return Boolean(navigator.xr) && (await navigator.xr.isSessionSupported('immersive-ar'));
  } catch {
    return false;
  }
}

const PLANE_COLORS = [0x3cc8ff, 0x7cff5a, 0xff5ad8, 0xffd84a, 0xa98bff, 0xff9a3c];

export class WebXRSession {
  constructor({ overlay, onFrame, onSelect, onEnd }) {
    this.overlay = overlay;
    this.onFrame = onFrame;
    this.onSelect = onSelect;
    this.onEnd = onEnd;
    this.planes = new Map(); // XRPlane → { group, changed }
    this.lastHit = { ok: false, reason: 'Пошук поверхонь…' };
  }

  async start() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.xr.enabled = true;
    this.renderer.domElement.className = 'xr-canvas';
    document.body.append(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x666666, 2));
    this.camera = new THREE.PerspectiveCamera();

    // Кільце прицілу лежить у площині XZ, бо в позі hit-test вісь Y — нормаль поверхні.
    this.reticle = new THREE.Group();
    this.reticle.matrixAutoUpdate = false;
    this.reticle.visible = false;
    const ring = makeReticle();
    ring.visible = true;
    ring.rotation.x = -Math.PI / 2;
    this.reticle.add(ring);
    this.scene.add(this.reticle);

    const session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay', 'plane-detection', 'anchors'],
      domOverlay: { root: this.overlay },
    });
    this.session = session;
    this.renderer.xr.setReferenceSpaceType('local');
    await this.renderer.xr.setSession(session);
    this.refSpace = this.renderer.xr.getReferenceSpace();
    const viewer = await session.requestReferenceSpace('viewer');
    this.hitSource = await session.requestHitTestSource({ space: viewer });

    // Дотик до екрана (поза кнопками інтерфейсу) — додати точку в місці прицілу.
    session.addEventListener('select', () => this.onSelect(this.lastHit));
    session.addEventListener('end', () => this.cleanup());
    this.renderer.setAnimationLoop((time, frame) => this.frame(frame));
    return this.scene;
  }

  frame(frame) {
    if (!frame) return;
    const hits = this.hitSource ? frame.getHitTestResults(this.hitSource) : [];
    const pose = hits[0]?.getPose(this.refSpace);
    if (pose) {
      this.reticle.matrix.fromArray(pose.transform.matrix);
      this.reticle.visible = true;
      const position = new THREE.Vector3().setFromMatrixPosition(this.reticle.matrix);
      const normal = new THREE.Vector3().setFromMatrixColumn(this.reticle.matrix, 1).normalize();
      this.lastHit = { ok: true, point: { x: position.x, y: position.y, z: position.z }, normal, surface: 'xr', label: 'поверхня' };
    } else {
      this.reticle.visible = false;
      this.lastHit = { ok: false, reason: 'Повільно поводіть телефоном над підлогою чи стіною, щоб знайти поверхню.' };
    }
    this.updatePlanes(frame);
    this.onFrame(this.lastHit);
    this.renderer.render(this.scene, this.camera);
  }

  // Знайдені площини (якщо браузер підтримує plane-detection) — напівпрозорі багатокутники.
  updatePlanes(frame) {
    const detected = frame.detectedPlanes;
    if (!detected) return;
    for (const [plane, entry] of this.planes) {
      if (!detected.has(plane)) {
        this.scene.remove(entry.group);
        this.planes.delete(plane);
      }
    }
    let index = 0;
    for (const plane of detected) {
      let entry = this.planes.get(plane);
      if (!entry || entry.changed !== plane.lastChangedTime) {
        if (entry) this.scene.remove(entry.group);
        const shape = new THREE.Shape(plane.polygon.map((p) => new THREE.Vector2(p.x, -p.z)));
        const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({
          color: PLANE_COLORS[index % PLANE_COLORS.length], transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false,
        }));
        mesh.rotation.x = -Math.PI / 2;
        const group = new THREE.Group();
        group.matrixAutoUpdate = false;
        group.add(mesh);
        this.scene.add(group);
        entry = { group, changed: plane.lastChangedTime };
        this.planes.set(plane, entry);
      }
      const pose = frame.getPose(plane.planeSpace, this.refSpace);
      if (pose) entry.group.matrix.fromArray(pose.transform.matrix);
      index++;
    }
  }

  end() {
    this.session?.end();
  }

  cleanup() {
    this.renderer.setAnimationLoop(null);
    this.renderer.domElement.remove();
    this.renderer.dispose();
    this.onEnd();
  }
}
