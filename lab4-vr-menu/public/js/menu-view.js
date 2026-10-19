// 3D-вигляд віртуального меню: сторінки з панелей і кнопок, що «плавають» перед користувачем,
// 3D-модель страви з інгредієнтами довкола, плавне слідування за поглядом.
import * as THREE from 'three';
import { makePanel, makeButton, makeLabel, disposeTree } from './ui3d.js';
import { makeDishModel } from './dishes3d.js';

const money = (n) => `${n.toLocaleString('uk-UA')} грн`;
// Українські відмінки після числа: 1 страва, 3 страви, 5 страв.
export function plural(n, [one, few, many]) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} ${one}`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} ${few}`;
  return `${n} ${many}`;
}
const FOLLOW_ANGLE = THREE.MathUtils.degToRad(35); // далі цього кута меню «наздоганяє» погляд

export class MenuView {
  constructor(model, { onAction }) {
    this.model = model;
    this.onAction = onAction;
    this.root = new THREE.Group();
    this.content = new THREE.Group();
    this.preview = new THREE.Group();
    this.toastGroup = new THREE.Group();
    this.root.add(this.content, this.preview, this.toastGroup);
    this.root.visible = false;
    this.interactives = [];
    this.targetPose = null;
    this.openAnim = 1;
    this.toastTimer = 0;
  }

  /* ---------- Побудова сторінок ---------- */

  button(opts, x, y, z = 0) {
    const b = makeButton({
      ...opts,
      onSelect: (source) => this.onAction(opts.action, opts.payload, source),
    });
    b.position.set(x, y, z);
    b.userData.baseZ = z;
    this.content.add(b);
    if (b.userData.interactive) this.interactives.push(b);
    return b;
  }

  panel(opts, x, y, z = -0.005) {
    const p = makePanel(opts);
    p.position.set(x, y, z);
    this.content.add(p);
    return p;
  }

  rebuild() {
    for (const group of [this.content, this.preview]) {
      for (const child of [...group.children]) {
        group.remove(child);
        disposeTree(child);
      }
    }
    this.interactives = [];
    const m = this.model;
    ({
      home: () => this.buildHome(),
      category: () => this.buildCategory(),
      dish: () => this.buildDish(),
      order: () => this.buildOrder(),
      confirm: () => this.buildConfirm(),
      settings: () => this.buildSettings(),
    })[m.page]?.();
  }

  header(title, sub) {
    this.panel({ w: 0.86, h: 0.1, lines: [{ text: title, size: 0.04, bold: true, align: 'center' }, ...(sub ? [{ text: sub, size: 0.022, color: '#c4cad3', align: 'center' }] : [])], padding: 0.016 }, 0, 0.34);
  }

  buildHome() {
    const m = this.model;
    this.header('Ресторан «Віртуальний смак»', 'Оберіть категорію — поглядом, променем, щипком або голосом');
    m.categories.forEach((c, i) => {
      const count = m.dishesIn(c.id).length;
      this.button({ id: `cat-${c.id}`, w: 0.26, h: 0.15, label: c.name, sub: plural(count, ['страва', 'страви', 'страв']), size: 0.036, action: 'category', payload: c.id },
        (i % 3 - 1) * 0.28, i < 3 ? 0.17 : 0.0);
    });
    const count = m.cartCount();
    this.button({ id: 'order', w: 0.26, h: 0.09, label: `Замовлення · ${count}`, size: 0.028, sub: count ? money(m.cartTotal()) : 'порожнє', variant: count ? 'accent' : 'default', action: 'order' }, -0.28, -0.15);
    this.button({ id: 'settings', w: 0.26, h: 0.09, label: 'Налаштування', action: 'settings' }, 0, -0.15);
    this.button({ id: 'close', w: 0.26, h: 0.09, label: 'Закрити меню', action: 'close' }, 0.28, -0.15);
  }

  buildCategory() {
    const m = this.model;
    const cat = m.category();
    const pages = m.pageCount();
    this.header(cat.name, `Сторінка ${m.pageIndex + 1} з ${pages}`);
    m.visibleDishes().forEach((d, i) => {
      const x = (i - 1) * 0.28;
      const card = this.button({ id: `dish-${d.id}`, w: 0.26, h: 0.27, label: d.name, sub: `${money(d.price)} · ${d.kcal} ккал`, size: 0.034, valign: 'bottom', action: 'dish', payload: d.id }, x, 0.08, Math.abs(i - 1) * 0.03);
      card.rotation.y = -(i - 1) * 0.16; // меню трохи огортає користувача
      // Мініатюра страви над карткою.
      const mini = makeDishModel(d);
      mini.scale.setScalar(0.45);
      mini.position.set(x, 0.13, 0.05 + Math.abs(i - 1) * 0.03);
      mini.rotation.x = 0.5;
      this.preview.add(mini);
    });
    this.button({ id: 'prev', w: 0.19, h: 0.08, label: '‹ Попередня', size: 0.026, disabled: m.pageIndex === 0, action: 'prev' }, -0.3, -0.15);
    this.button({ id: 'back', w: 0.19, h: 0.08, label: 'Назад', size: 0.026, action: 'back' }, -0.1, -0.15);
    this.button({ id: 'home', w: 0.19, h: 0.08, label: 'Головна', size: 0.026, action: 'home' }, 0.1, -0.15);
    this.button({ id: 'next', w: 0.19, h: 0.08, label: 'Наступна ›', size: 0.026, disabled: m.pageIndex >= pages - 1, action: 'next' }, 0.3, -0.15);
  }

  buildDish() {
    const m = this.model;
    const d = m.dish();
    this.panel({
      w: 0.5,
      h: 0.36,
      lines: [
        { text: d.name, size: 0.042, bold: true },
        { text: d.description, size: 0.024, color: '#c4cad3' },
        { text: `${money(d.price)} · ${d.weight} г · ${d.kcal} ккал`, size: 0.026, color: '#ffd166', gap: 0.016 },
        { text: `Склад: ${d.ingredients.join(', ')}`, size: 0.023 },
      ],
    }, -0.2, 0.13);
    this.button({ id: 'minus', w: 0.08, h: 0.08, label: '−', size: 0.05, disabled: m.qty <= 1, action: 'minus' }, -0.41, -0.11);
    this.panel({ w: 0.1, h: 0.08, lines: [{ text: `× ${m.qty}`, size: 0.034, bold: true, align: 'center' }], padding: 0.02 }, -0.31, -0.11);
    this.button({ id: 'plus', w: 0.08, h: 0.08, label: '+', size: 0.05, action: 'plus' }, -0.21, -0.11);
    this.button({ id: 'add', w: 0.24, h: 0.08, label: 'Додати', sub: money(d.price * m.qty), variant: 'accent', action: 'add' }, 0.0, -0.11);
    this.button({ id: 'back', w: 0.19, h: 0.07, label: 'Назад', action: 'back' }, -0.35, -0.21);
    this.button({ id: 'order', w: 0.21, h: 0.07, label: `Замовлення · ${m.cartCount()}`, size: 0.025, action: 'order' }, -0.14, -0.21);
    this.button({ id: 'home', w: 0.19, h: 0.07, label: 'Головна', action: 'home' }, 0.07, -0.21);

    // Віртуальний перегляд страви: модель на підставці + інгредієнти довкола.
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.19, 0.03, 40), new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.4 }));
    stand.position.set(0.37, -0.1, 0.08);
    const turntable = new THREE.Group();
    turntable.position.set(0.37, -0.085, 0.08);
    turntable.add(makeDishModel(d));
    turntable.userData.spin = true;
    this.preview.add(stand, turntable);
    // Інгредієнти — дугою над моделлю (від 160° до 20°).
    const n = d.ingredients.length;
    d.ingredients.forEach((name, i) => {
      const a = THREE.MathUtils.degToRad(n === 1 ? 90 : 160 - (140 * i) / (n - 1));
      const label = makeLabel(name, { size: 0.022 });
      label.position.set(0.37 + Math.cos(a) * 0.21, 0.02 + Math.sin(a) * 0.17, 0.12);
      label.userData.bob = i;
      this.preview.add(label);
    });
  }

  buildOrder() {
    const m = this.model;
    const items = m.cartItems();
    this.header('Ваше замовлення', items.length ? `${plural(m.cartCount(), ['порція', 'порції', 'порцій'])} · ${money(m.cartTotal())}` : 'Поки що порожнє');
    if (!items.length) {
      this.panel({ w: 0.6, h: 0.12, lines: [{ text: 'Додайте страви з меню — вони з’являться тут.', size: 0.028, align: 'center' }], padding: 0.04 }, 0, 0.12);
      this.button({ id: 'home', w: 0.26, h: 0.09, label: 'До меню', action: 'home' }, 0, -0.06);
      return;
    }
    items.slice(0, 5).forEach((item, i) => {
      const y = 0.21 - i * 0.075;
      this.panel({ w: 0.52, h: 0.065, lines: [{ text: `${item.dish.name} × ${item.qty} — ${money(item.sum)}`, size: 0.027 }], padding: 0.018 }, -0.12, y);
      this.button({ id: `remove-${item.dish.id}`, w: 0.16, h: 0.065, label: 'Прибрати', size: 0.026, action: 'remove', payload: item.dish.id }, 0.25, y);
    });
    if (items.length > 5) this.panel({ w: 0.52, h: 0.05, lines: [{ text: `…і ще ${items.length - 5}`, size: 0.022 }], padding: 0.012 }, -0.12, -0.17);
    const by = Math.max(-0.25, 0.21 - Math.min(items.length, 5) * 0.075 - 0.075);
    this.button({ id: 'checkout', w: 0.3, h: 0.09, label: 'Оформити', sub: money(m.cartTotal()), variant: 'accent', action: 'checkout' }, -0.27, by);
    this.button({ id: 'clear', w: 0.18, h: 0.09, label: 'Очистити', variant: 'danger', action: 'clear' }, -0.02, by);
    this.button({ id: 'back', w: 0.14, h: 0.09, label: 'Назад', action: 'back' }, 0.15, by);
    this.button({ id: 'home', w: 0.14, h: 0.09, label: 'Головна', action: 'home' }, 0.3, by);
  }

  buildConfirm() {
    const m = this.model;
    const lines = m.cartItems().slice(0, 4).map((i) => ({ text: `${i.dish.name} × ${i.qty}`, size: 0.025, color: '#c4cad3', gap: 0.002 }));
    this.panel({
      w: 0.62,
      h: 0.3,
      lines: [
        { text: 'Підтвердити замовлення?', size: 0.04, bold: true, align: 'center', gap: 0.016 },
        ...lines,
        { text: `Разом: ${money(m.cartTotal())}`, size: 0.03, bold: true, color: '#ffd166' },
      ],
      padding: 0.03,
    }, 0, 0.14);
    this.button({ id: 'yes', w: 0.3, h: 0.1, label: 'Так, оформити', variant: 'accent', action: 'yes' }, -0.16, -0.08);
    this.button({ id: 'no', w: 0.22, h: 0.1, label: 'Ні', action: 'no' }, 0.18, -0.08);
    this.panel({ w: 0.62, h: 0.05, lines: [{ text: 'Або скажіть «так» / «ні»', size: 0.022, color: '#c4cad3', align: 'center' }], padding: 0.012, background: 'rgba(0,0,0,0)' }, 0, -0.18);
  }

  buildSettings() {
    const s = this.model.settings;
    this.header('Налаштування');
    const rows = [
      { label: `Відстань меню: ${s.distance.toFixed(1).replace('.', ',')} м`, minus: ['distance', s.distance - 0.1], plus: ['distance', s.distance + 0.1] },
      { label: `Яскравість сцени: ${Math.round(s.brightness * 100)} %`, minus: ['brightness', s.brightness - 0.2], plus: ['brightness', s.brightness + 0.2] },
      { label: `Час вибору поглядом: ${(s.dwellMs / 1000).toFixed(1).replace('.', ',')} с`, minus: ['dwellMs', s.dwellMs - 250], plus: ['dwellMs', s.dwellMs + 250] },
      { label: 'Вибір поглядом', toggle: ['gaze', !s.gaze], value: s.gaze ? 'Увімкнено' : 'Вимкнено' },
      { label: 'Меню слідує за поглядом', toggle: ['follow', !s.follow], value: s.follow ? 'Так' : 'Ні' },
    ];
    rows.forEach((r, i) => {
      const y = 0.21 - i * 0.09;
      this.panel({ w: 0.46, h: 0.075, lines: [{ text: r.label, size: 0.027 }], padding: 0.022 }, -0.18, y);
      if (r.toggle) {
        this.button({ id: `set-${r.toggle[0]}`, w: 0.24, h: 0.075, label: r.value, selected: true, size: 0.027, action: 'setting', payload: r.toggle }, 0.24, y);
      } else {
        this.button({ id: `set-${r.minus[0]}-minus`, w: 0.11, h: 0.075, label: '−', size: 0.042, action: 'setting', payload: r.minus }, 0.18, y);
        this.button({ id: `set-${r.plus[0]}-plus`, w: 0.11, h: 0.075, label: '+', size: 0.042, action: 'setting', payload: r.plus }, 0.31, y);
      }
    });
    this.button({ id: 'back', w: 0.22, h: 0.08, label: 'Назад', action: 'back' }, -0.13, -0.27);
    this.button({ id: 'home', w: 0.22, h: 0.08, label: 'Головна', action: 'home' }, 0.13, -0.27);
  }

  /* ---------- Розміщення в просторі ---------- */

  // Поставити меню перед головою на заданій відстані, обличчям до користувача.
  poseFor(head) {
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(head.quaternion);
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
    dir.normalize();
    const position = head.position.clone().addScaledVector(dir, this.model.settings.distance);
    // Трохи нижче рівня очей (~17°): зручно для шиї, а погляд «прямо» не потрапляє на кнопки випадково.
    position.y = head.position.y - 0.3;
    const quaternion = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().lookAt(position, new THREE.Vector3(head.position.x, position.y, head.position.z), new THREE.Vector3(0, 1, 0)),
    );
    // lookAt матриці дивиться −z на ціль; меню має дивитися +z на користувача.
    quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
    return { position, quaternion };
  }

  placeInFront(head) {
    const pose = this.poseFor(head);
    this.root.position.copy(pose.position);
    this.root.quaternion.copy(pose.quaternion);
    this.targetPose = null;
    this.openAnim = 0;
  }

  update(dt, head, time) {
    if (!this.root.visible) return;
    // Плавна поява.
    if (this.openAnim < 1) {
      this.openAnim = Math.min(1, this.openAnim + dt * 5);
      this.root.scale.setScalar(0.7 + 0.3 * this.openAnim);
    }
    // Слідування: якщо меню далеко від напрямку погляду — плавно переносимо його.
    if (this.model.settings.follow && head) {
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(head.quaternion).setY(0).normalize();
      const toMenu = this.root.position.clone().sub(head.position).setY(0).normalize();
      if (forward.angleTo(toMenu) > FOLLOW_ANGLE) this.targetPose = this.poseFor(head);
    }
    if (this.targetPose) {
      const k = Math.min(1, dt * 4);
      this.root.position.lerp(this.targetPose.position, k);
      this.root.quaternion.slerp(this.targetPose.quaternion, k);
      if (this.root.position.distanceTo(this.targetPose.position) < 0.005) this.targetPose = null;
    }
    // Анімація прев'ю: обертання страви, «плавання» інгредієнтів.
    for (const child of this.preview.children) {
      if (child.userData.spin) child.rotation.y += dt * 0.6;
      if (child.userData.bob !== undefined) child.position.y += Math.sin(time * 2 + child.userData.bob) * 0.0004;
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastGroup.clear();
    }
  }

  toast(text) {
    for (const child of [...this.toastGroup.children]) disposeTree(child);
    this.toastGroup.clear();
    const t = makePanel({ w: 0.62, h: 0.06, lines: [{ text, size: 0.026, align: 'center' }], padding: 0.015, background: 'rgba(46,125,72,0.92)' });
    t.position.set(0, 0.45, 0.02);
    this.toastGroup.add(t);
    this.toastTimer = 2.5;
  }
}
