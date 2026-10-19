// Емуляція окулярів на звичайному комп'ютері: «голова» — камера (огляд мишею, WASD),
// «контролер» — промінь від миші (клік — курок), приціл погляду — центр екрана.
import * as THREE from 'three';

export class DesktopRig {
  constructor({ canvas, camera, manager, scene, onClick }) {
    this.canvas = canvas;
    this.camera = camera;
    this.manager = manager;
    this.onClick = onClick;
    this.yaw = 0;
    this.pitch = -0.25; // погляд трохи вниз — на меню, що висить нижче рівня очей
    this.keys = new Set();
    this.mouseNdc = null;
    camera.position.set(0, 1.6, 0);
    camera.rotation.order = 'YXZ';
    this.apply();
    manager.addPointer('mouse', 'mouse');

    // Видимий «промінь контролера» від уявної руки до точки наведення.
    this.laser = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
      new THREE.LineBasicMaterial({ color: 0x8ec5ff, transparent: true, opacity: 0.8, depthTest: false }),
    );
    this.laser.renderOrder = 20;
    this.laser.frustumCulled = false;
    this.laser.visible = false;
    scene.add(this.laser);
    this.bind();
  }

  apply() {
    this.pitch = Math.max(-1.3, Math.min(1.3, this.pitch));
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    this.camera.updateMatrixWorld();
  }

  lookAt(target) {
    const d = target.clone().sub(this.camera.position);
    this.yaw = Math.atan2(-d.x, -d.z);
    this.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    this.apply();
  }

  bind() {
    const c = this.canvas;
    let drag = null;
    const ndc = (e) => {
      const r = c.getBoundingClientRect();
      return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    };
    c.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, yaw: this.yaw, pitch: this.pitch, moved: false };
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      this.mouseNdc = ndc(e);
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) > 5) drag.moved = true;
      if (drag.moved) {
        this.yaw = drag.yaw + dx * 0.004;
        this.pitch = drag.pitch + dy * 0.004;
        this.apply();
      }
    });
    c.addEventListener('pointerup', (e) => {
      if (drag && !drag.moved) {
        this.mouseNdc = ndc(e);
        this.updateMouseRay();
        this.onClick?.();
      }
      drag = null;
    });
    c.addEventListener('pointerleave', () => {
      this.mouseNdc = null;
      this.manager.disable('mouse');
    });
    const typing = (e) => e.target.closest?.('input, textarea, select');
    window.addEventListener('keydown', (e) => !typing(e) && this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  updateMouseRay() {
    if (!this.mouseNdc) return;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(this.mouseNdc, this.camera);
    this.manager.setRay('mouse', raycaster.ray.origin, raycaster.ray.direction);
  }

  update(dt) {
    const k = this.keys;
    const turn = (k.has('ArrowLeft') || k.has('KeyQ') ? 1 : 0) - (k.has('ArrowRight') || k.has('KeyE') ? 1 : 0);
    const tilt = (k.has('ArrowUp') ? 1 : 0) - (k.has('ArrowDown') ? 1 : 0);
    const f = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    const r = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    if (turn || tilt) {
      this.yaw += turn * 1.5 * dt;
      this.pitch += tilt * 1.0 * dt;
    }
    if (f || r) {
      const p = this.camera.position;
      p.x += (-Math.sin(this.yaw) * f + Math.cos(this.yaw) * r) * 1.2 * dt;
      p.z += (-Math.cos(this.yaw) * f - Math.sin(this.yaw) * r) * 1.2 * dt;
      p.x = Math.max(-4.5, Math.min(4.5, p.x));
      p.z = Math.max(-4.5, Math.min(4.5, p.z));
    }
    this.apply();
    this.updateMouseRay();

    // Промінь «контролера» малюється від уявної правої руки.
    const pointer = this.manager.pointers.get('mouse');
    if (pointer?.enabled) {
      const hand = new THREE.Vector3(0.22, -0.28, -0.35).applyMatrix4(this.camera.matrixWorld);
      const end = pointer.hit ? pointer.hit.point : pointer.ray.origin.clone().addScaledVector(pointer.ray.direction, 4);
      this.laser.geometry.setFromPoints([hand, end]);
      this.laser.material.color.set(pointer.hit ? 0xffd166 : 0x8ec5ff);
      this.laser.visible = true;
    } else {
      this.laser.visible = false;
    }
  }
}

// Приціл погляду: кільце в центрі поля зору з прогресом вибору.
export class GazeReticle {
  constructor(scene) {
    this.group = new THREE.Group();
    const material = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.009, 0.013, 32), material(0xffffff, 0.85));
    this.progress = new THREE.Mesh(new THREE.RingGeometry(0.013, 0.02, 32, 1, Math.PI / 2, 0), material(0xffd166, 1));
    for (const m of [this.ring, this.progress]) {
      m.renderOrder = 30;
      this.group.add(m);
    }
    scene.add(this.group);
  }

  // direction — напрям погляду (за замовчуванням — центр поля зору, «голова»; для очей — оцінка з камери).
  update(head, hit, progress, enabled, direction = null) {
    this.group.visible = enabled;
    if (!enabled) return;
    const forward = direction ?? new THREE.Vector3(0, 0, -1).applyQuaternion(head.quaternion);
    const distance = hit ? Math.max(0.3, hit.distance - 0.01) : 1.2;
    this.group.position.copy(head.position).addScaledVector(forward, distance);
    this.group.quaternion.copy(head.quaternion);
    this.group.scale.setScalar(distance);
    this.progress.geometry.dispose();
    this.progress.geometry = new THREE.RingGeometry(0.013, 0.02, 32, 1, Math.PI / 2, -progress * Math.PI * 2);
    this.ring.material.color.set(hit ? 0xffd166 : 0xffffff);
  }
}
