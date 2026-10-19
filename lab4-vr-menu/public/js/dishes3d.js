// Процедурні 3D-моделі страв (з примітивів three.js, без зовнішніх файлів). Розмір ~25–30 см.
import * as THREE from 'three';

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...extra });

function plate(radius = 0.16) {
  const shape = new THREE.LatheGeometry([
    new THREE.Vector2(0, 0), new THREE.Vector2(radius * 0.7, 0), new THREE.Vector2(radius, 0.015), new THREE.Vector2(radius * 1.02, 0.02),
  ], 48);
  const mesh = new THREE.Mesh(shape, mat(0xf3f1ec, { roughness: 0.3, side: THREE.DoubleSide }));
  mesh.receiveShadow = true;
  return mesh;
}

function bowl(radius = 0.12, color = 0xf3f1ec) {
  const points = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    points.push(new THREE.Vector2(radius * Math.sin(t * Math.PI / 2) + 0.01, 0.09 * (1 - Math.cos(t * Math.PI / 2))));
  }
  return new THREE.Mesh(new THREE.LatheGeometry(points, 48), mat(color, { roughness: 0.35, side: THREE.DoubleSide }));
}

// Розкидати дрібні об'єкти по колу (топінги, зелень).
function scatter(group, count, radius, y, make, seed = 1) {
  let s = seed;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < count; i++) {
    const r = Math.sqrt(rnd()) * radius;
    const a = rnd() * Math.PI * 2;
    const m = make(i);
    m.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
    m.rotation.y = rnd() * Math.PI;
    group.add(m);
  }
}

const builders = {
  pizza(c) {
    const g = new THREE.Group();
    g.add(plate(0.17));
    const crust = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.145, 0.02, 48), mat(0xd9a45b));
    crust.position.y = 0.03;
    const sauce = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.125, 0.006, 48), mat(0xb8321f));
    sauce.position.y = 0.042;
    const cheese = new THREE.Mesh(new THREE.CylinderGeometry(0.118, 0.118, 0.005, 48), mat(0xf4d27a, { roughness: 0.5 }));
    cheese.position.y = 0.046;
    g.add(crust, sauce, cheese);
    const topping = new THREE.Color(c.topping ?? '#b3261e');
    scatter(g, 11, 0.1, 0.05, () => new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.005, 16), mat(topping)), 3);
    return g;
  },
  burger(c) {
    const g = new THREE.Group();
    g.add(plate(0.15));
    const layer = (geometry, color, y) => {
      const m = new THREE.Mesh(geometry, mat(color));
      m.position.y = y;
      m.castShadow = true;
      g.add(m);
      return m;
    };
    layer(new THREE.CylinderGeometry(0.075, 0.07, 0.03, 32), 0xd99a4e, 0.035);
    layer(new THREE.CylinderGeometry(0.078, 0.078, 0.025, 32), new THREE.Color(c.patty ?? '#5b3220'), 0.062);
    if (c.cheese) layer(new THREE.BoxGeometry(0.15, 0.006, 0.15), new THREE.Color(c.cheese), 0.077).rotation.y = 0.4;
    layer(new THREE.CylinderGeometry(0.082, 0.082, 0.008, 24), 0x5aa63a, 0.083);
    layer(new THREE.CylinderGeometry(0.06, 0.06, 0.008, 24), 0xd23c2c, 0.091);
    const top = layer(new THREE.SphereGeometry(0.078, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), 0xd99a4e, 0.096);
    top.scale.y = 0.7;
    scatter(g, 14, 0.05, 0.135, () => new THREE.Mesh(new THREE.SphereGeometry(0.004, 6, 4), mat(0xf6ecd0)), 7);
    return g;
  },
  salad(c) {
    const g = new THREE.Group();
    g.add(bowl(0.12));
    scatter(g, 16, 0.085, 0.07, (i) => {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), mat(i % 3 ? 0x5fae3e : 0x86c55a));
      leaf.scale.set(1, 0.35, 0.8);
      return leaf;
    }, 5);
    const accent = new THREE.Color(c.accent ?? '#d63c2f');
    scatter(g, 7, 0.07, 0.085, () => new THREE.Mesh(new THREE.SphereGeometry(0.016, 12, 8), mat(accent)), 11);
    return g;
  },
  soup(c) {
    const g = new THREE.Group();
    g.add(plate(0.16));
    const b = bowl(0.11);
    b.position.y = 0.015;
    g.add(b);
    const soup = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.004, 40), mat(new THREE.Color(c.soup ?? '#a3202a'), { roughness: 0.25 }));
    soup.position.y = 0.085;
    g.add(soup);
    const garnish = new THREE.Mesh(new THREE.SphereGeometry(0.022, 16, 8), mat(0xfaf6ee));
    garnish.scale.y = 0.4;
    garnish.position.y = 0.09;
    g.add(garnish);
    scatter(g, 8, 0.07, 0.089, () => new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.002, 0.004), mat(0x3f8f2f)), 13);
    return g;
  },
  cake(c) {
    const g = new THREE.Group();
    g.add(plate(0.14));
    const slice = (r, h, color, y) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 32, 1, false, 0, Math.PI / 3), mat(color));
      m.position.y = y;
      m.rotation.y = -Math.PI / 6;
      m.castShadow = true;
      g.add(m);
    };
    slice(0.12, 0.02, 0xc89a62, 0.03);
    slice(0.12, 0.06, new THREE.Color(c.cream ?? '#f6ecd2'), 0.07);
    slice(0.12, 0.012, new THREE.Color(c.top ?? '#c2273a'), 0.106);
    const berry = new THREE.Mesh(new THREE.SphereGeometry(0.018, 16, 12), mat(0xd1263a, { roughness: 0.3 }));
    berry.position.set(0.05, 0.125, 0);
    g.add(berry);
    return g;
  },
  drink(c) {
    const g = new THREE.Group();
    const coaster = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.006, 32), mat(0x6b4a2e));
    coaster.position.y = 0.003;
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.038, 0.17, 32, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xdff2ff, transparent: true, opacity: 0.28, roughness: 0.05, side: THREE.DoubleSide }));
    glass.position.y = 0.09;
    const liquid = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.036, 0.13, 32), mat(new THREE.Color(c.liquid ?? '#f2e36b'), { roughness: 0.2, transparent: true, opacity: 0.85 }));
    liquid.position.y = 0.072;
    const straw = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.22, 8), mat(0xe8463c));
    straw.position.set(0.015, 0.14, 0);
    straw.rotation.z = -0.25;
    g.add(coaster, glass, liquid, straw);
    return g;
  },
};

export function makeDishModel(dish) {
  const build = builders[dish.model] ?? builders.pizza;
  const group = build(dish.colors ?? {});
  group.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  return group;
}
