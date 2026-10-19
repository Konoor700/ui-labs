// Рука з вебкамери (MediaPipe, локально) — запасний спосіб жестового керування без окулярів.
import { HandGestures } from './hand-gestures.js';

export class WebcamHand {
  constructor({ video, onEvent, onStatus }) {
    this.video = video;
    this.onEvent = onEvent;
    this.onStatus = onStatus;
    this.gestures = new HandGestures();
    this.running = false;
  }

  async start() {
    if (this.running) return;
    this.onStatus('Рука: завантаження моделі…');
    const { GestureRecognizer, FilesetResolver } = await import('/vendor/mediapipe/vision_bundle.mjs');
    const fileset = await FilesetResolver.forVisionTasks('/vendor/mediapipe/wasm');
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: '/models/gesture_recognizer.task', delegate },
      runningMode: 'VIDEO',
      numHands: 1,
    });
    try {
      this.recognizer = await GestureRecognizer.createFromOptions(fileset, options('GPU'));
    } catch {
      this.recognizer = await GestureRecognizer.createFromOptions(fileset, options('CPU'));
    }
    this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240, facingMode: 'user' }, audio: false });
    this.video.srcObject = this.stream;
    await this.video.play();
    this.running = true;
    this.onStatus('Рука: камера увімкнена');
    let last = -1;
    const loop = () => {
      if (!this.running) return;
      if (this.video.readyState >= 2 && this.video.currentTime !== last) {
        last = this.video.currentTime;
        const t = performance.now();
        const r = this.recognizer.recognizeForVideo(this.video, t);
        const events = this.gestures.update({ t, landmarks: r.landmarks[0] ?? null, category: r.gestures[0]?.[0]?.categoryName });
        events.forEach((e) => this.onEvent(e));
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.gestures.reset();
    this.onEvent({ type: 'lost' });
    this.onStatus('Рука: вимкнено');
  }
}
