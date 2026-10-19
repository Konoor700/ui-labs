// Справжні AR/VR-окуляри через WebXR (наприклад, браузер Meta Quest):
// контролери або руки (щипок) дають промені й подію «вибір», голова — погляд.
import * as THREE from 'three';

export async function xrSupport() {
  if (!navigator.xr) return { vr: false, ar: false };
  const check = async (mode) => {
    try {
      return await navigator.xr.isSessionSupported(mode);
    } catch {
      return false;
    }
  };
  return { vr: await check('immersive-vr'), ar: await check('immersive-ar') };
}

export class XRRig {
  constructor({ renderer, scene, manager, onSqueeze, onEnd }) {
    this.renderer = renderer;
    this.manager = manager;
    this.onEnd = onEnd;
    this.controllers = [0, 1].map((i) => {
      const controller = renderer.xr.getController(i);
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
        new THREE.LineBasicMaterial({ color: 0x8ec5ff }),
      );
      line.scale.z = 3;
      line.visible = false;
      controller.add(line);
      controller.addEventListener('connected', () => (line.visible = true));
      controller.addEventListener('disconnected', () => {
        line.visible = false;
        manager.disable(`xr${i}`);
      });
      // «Курок» контролера або щипок руки (hand-tracking) — вибір.
      controller.addEventListener('selectstart', () => manager.select(`xr${i}`));
      // Бокова кнопка «стиснути» — показати/сховати меню.
      controller.addEventListener('squeezestart', () => onSqueeze?.());
      scene.add(controller);
      manager.addPointer(`xr${i}`, 'controller');
      return { controller, line };
    });
  }

  async enter(mode, overlayRoot) {
    const session = await navigator.xr.requestSession(mode, {
      optionalFeatures: ['local-floor', 'hand-tracking', ...(mode === 'immersive-ar' ? ['dom-overlay'] : [])],
      ...(mode === 'immersive-ar' && overlayRoot ? { domOverlay: { root: overlayRoot } } : {}),
    });
    this.renderer.xr.setReferenceSpaceType('local-floor');
    await this.renderer.xr.setSession(session);
    session.addEventListener('end', () => this.onEnd?.());
    return session;
  }

  update() {
    if (!this.renderer.xr.isPresenting) return;
    const origin = new THREE.Vector3();
    const direction = new THREE.Vector3();
    this.controllers.forEach(({ controller, line }, i) => {
      if (!line.visible) return;
      controller.updateMatrixWorld();
      origin.setFromMatrixPosition(controller.matrixWorld);
      direction.set(0, 0, -1).transformDirection(controller.matrixWorld);
      this.manager.setRay(`xr${i}`, origin, direction);
      const hit = this.manager.pointers.get(`xr${i}`).hit;
      line.scale.z = hit ? hit.distance : 3;
    });
  }
}
