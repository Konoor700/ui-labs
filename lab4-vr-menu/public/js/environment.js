// Віртуальний ресторан навколо користувача (у режимі VR). У режимі AR оточення ховається —
// меню «плаває» поверх реального світу.
import * as THREE from 'three';

function texture(w, h, draw, repeat = [1, 1]) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = 8;
  return t;
}

export function buildEnvironment(scene) {
  const env = new THREE.Group();

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshStandardMaterial({
    map: texture(512, 512, (ctx, w, h) => {
      for (let i = 0; i < 8; i++) {
        for (let j = 0; j < 8; j++) {
          ctx.fillStyle = (i + j) % 2 ? '#3a2a20' : '#46342a';
          ctx.fillRect(i * w / 8, j * h / 8, w / 8, h / 8);
        }
      }
    }, [5, 5]),
    roughness: 0.8,
  }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  env.add(floor);

  const wallMat = new THREE.MeshStandardMaterial({
    map: texture(256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#5b3f30';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#4c3327';
      for (let x = 0; x < w; x += 32) ctx.fillRect(x, 0, 4, h);
    }, [6, 1.5]),
    roughness: 0.9,
  });
  for (const [x, z, ry] of [[0, -5, 0], [0, 5, Math.PI], [-5, 0, Math.PI / 2], [5, 0, -Math.PI / 2]]) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(10, 3.2), wallMat);
    wall.position.set(x, 1.6, z);
    wall.rotation.y = ry;
    env.add(wall);
  }
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshStandardMaterial({ color: 0x2a211c }));
  ceiling.position.y = 3.2;
  ceiling.rotation.x = Math.PI / 2;
  env.add(ceiling);

  // Столик перед користувачем.
  const wood = new THREE.MeshStandardMaterial({ color: 0x6e4527, roughness: 0.6 });
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.04, 40), wood);
  top.position.set(0, 0.74, -0.7);
  top.castShadow = top.receiveShadow = true;
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.72, 16), wood);
  leg.position.set(0, 0.36, -0.7);
  env.add(top, leg);

  // Інші столики та лампи — для відчуття простору.
  for (const [x, z] of [[-2.6, -2.8], [2.6, -2.8], [-3, 1.5], [3, 1.6], [0, -3.8]]) {
    const t = top.clone();
    t.position.set(x, 0.74, z);
    const l = leg.clone();
    l.position.set(x, 0.36, z);
    env.add(t, l);
  }
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffb45a, emissiveIntensity: 1.4 });
  for (const [x, z] of [[0, -0.7], [-2.6, -2.8], [2.6, -2.8], [0, -3.8]]) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 20, 12), lampMat);
    lamp.position.set(x, 2.3, z);
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.9, 6), new THREE.MeshBasicMaterial({ color: 0x111111 }));
    cord.position.set(x, 2.75, z);
    env.add(lamp, cord);
  }
  // Рослини в кутах.
  const plantMat = new THREE.MeshStandardMaterial({ color: 0x3f7a35, roughness: 0.9 });
  const potMat = new THREE.MeshStandardMaterial({ color: 0x8a5a3a });
  for (const [x, z] of [[-4.3, -4.3], [4.3, -4.3], [-4.3, 4.3], [4.3, 4.3]]) {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.4, 16), potMat);
    pot.position.set(x, 0.2, z);
    const plant = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.2, 12), plantMat);
    plant.position.set(x, 1.0, z);
    env.add(pot, plant);
  }
  scene.add(env);

  // Освітлення (теплий ресторанний тон).
  const hemi = new THREE.HemisphereLight(0xfff1dc, 0x3a2a20, 1.1);
  const key = new THREE.DirectionalLight(0xfff0d8, 1.4);
  key.position.set(1.5, 3, 1.5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  const warm = new THREE.PointLight(0xffb45a, 4, 6, 1.5);
  warm.position.set(0, 2.2, -0.7);
  scene.add(hemi, key, warm);

  const lights = [hemi, key, warm];
  const base = lights.map((l) => l.intensity);
  return {
    group: env,
    setBrightness(k) {
      lights.forEach((l, i) => (l.intensity = base[i] * k));
    },
  };
}
