// Вибір поглядом із затримкою: якщо погляд затримався на пункті довше за dwellMs — вибір.
// Після спрацювання треба відвести погляд, щоб той самий пункт не спрацьовував повторно.

export class DwellTracker {
  constructor(dwellMs = 1000) {
    this.dwellMs = dwellMs;
    this.target = null;
    this.elapsed = 0;
    this.fired = false;
  }

  // target — id пункту під поглядом або null; dt — мс від попереднього кадру.
  // Повертає { target, progress (0…1), fired } — fired = true рівно один раз за затримку.
  update(target, dt) {
    if (target !== this.target) {
      this.target = target;
      this.elapsed = 0;
      this.fired = false;
    }
    if (!target || this.fired) return { target, progress: 0, fired: false };
    this.elapsed += dt;
    const progress = Math.min(1, this.elapsed / this.dwellMs);
    if (progress >= 1) {
      this.fired = true;
      return { target, progress: 1, fired: true };
    }
    return { target, progress, fired: false };
  }

  reset() {
    this.target = null;
    this.elapsed = 0;
    this.fired = false;
  }
}
