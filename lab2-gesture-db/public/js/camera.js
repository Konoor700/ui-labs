// Камера (getUserMedia) + MediaPipe Gesture Recognizer у браузері.
// Усе працює локально: бібліотека, WebAssembly і модель роздаються нашим сервером, кадри нікуди не надсилаються.
import { GestureRecognizer, FilesetResolver, DrawingUtils } from '/vendor/mediapipe/vision_bundle.mjs';

const MODEL = '/models/gesture_recognizer.task';

async function createRecognizer() {
  const fileset = await FilesetResolver.forVisionTasks('/vendor/mediapipe/wasm');
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: MODEL, delegate },
    runningMode: 'VIDEO',
    numHands: 1,
    minHandDetectionConfidence: 0.6,
    minHandPresenceConfidence: 0.6,
    minTrackingConfidence: 0.5,
  });
  // GPU (WebGL) швидший; якщо недоступний — працюємо на CPU.
  try {
    return { recognizer: await GestureRecognizer.createFromOptions(fileset, options('GPU')), delegate: 'GPU' };
  } catch {
    return { recognizer: await GestureRecognizer.createFromOptions(fileset, options('CPU')), delegate: 'CPU' };
  }
}

async function openCamera(video) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 }, facingMode: 'user' },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  return stream;
}

// Середня яскравість кадру (0–255) — щоб підказати, якщо замало світла.
function brightness(video, ctx) {
  ctx.drawImage(video, 0, 0, 16, 12);
  const { data } = ctx.getImageData(0, 0, 16, 12);
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  return sum / (data.length / 4);
}

/**
 * Запускає камеру й розпізнавання. onFrame отримує { t, landmarks, category, score } для кожного кадру,
 * onStatus — зміни стану (модель, камера, FPS, освітлення).
 */
export async function startCamera({ video, canvas, onFrame, onStatus }) {
  onStatus({ model: 'loading' });
  let recognizer;
  let delegate;
  try {
    ({ recognizer, delegate } = await createRecognizer());
    onStatus({ model: 'ready', delegate });
  } catch (err) {
    onStatus({ model: 'error', error: err.message });
    return;
  }

  try {
    await openCamera(video);
    onStatus({ camera: 'ready' });
  } catch (err) {
    onStatus({ camera: 'error', error: err.name === 'NotAllowedError' ? 'denied' : err.name });
    return;
  }

  const ctx = canvas.getContext('2d');
  const drawer = new DrawingUtils(ctx);
  const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const trail = [];
  let lastVideoTime = -1;
  let frames = 0;
  let fpsSince = performance.now();
  let lightAt = 0;

  const loop = () => {
    if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      if (canvas.width !== video.videoWidth) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }
      const t = performance.now();
      const result = recognizer.recognizeForVideo(video, t);
      const inferMs = performance.now() - t;

      const landmarks = result.landmarks[0] ?? null;
      const gesture = result.gestures[0]?.[0];
      onFrame({ t, landmarks, category: gesture?.categoryName, score: gesture?.score ?? 0 });

      // Малюємо «скелет» руки та слід центру долоні.
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (landmarks) {
        trail.push({ x: landmarks[9].x, y: landmarks[9].y, t });
        drawer.drawConnectors(landmarks, GestureRecognizer.HAND_CONNECTIONS, { color: '#ffffffcc', lineWidth: 3 });
        drawer.drawLandmarks(landmarks, { color: '#e8590c', fillColor: '#ffd8a8', radius: 4, lineWidth: 1 });
      }
      while (trail.length && (t - trail[0].t > 600 || !landmarks)) trail.shift();
      if (trail.length > 1) {
        ctx.strokeStyle = '#4dabf7';
        ctx.lineWidth = 4;
        ctx.beginPath();
        trail.forEach((p, i) => (i ? ctx.lineTo(p.x * canvas.width, p.y * canvas.height) : ctx.moveTo(p.x * canvas.width, p.y * canvas.height)));
        ctx.stroke();
      }

      frames++;
      if (t - fpsSince >= 1000) {
        const status = { fps: Math.round((frames * 1000) / (t - fpsSince)), inferMs: Math.round(inferMs * 10) / 10 };
        if (t - lightAt > 2000) {
          status.light = Math.round(brightness(video, probe));
          lightAt = t;
        }
        onStatus(status);
        frames = 0;
        fpsSince = t;
      }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
