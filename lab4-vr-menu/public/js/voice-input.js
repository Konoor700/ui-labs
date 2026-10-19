// Голосові команди (Web Speech API, українська). Безперервне слухання, поки увімкнено.

export class VoiceInput {
  constructor({ onText, onStatus }) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.supported = Boolean(SR);
    this.onText = onText;
    this.onStatus = onStatus;
    this.enabled = false;
    if (!SR) return;
    this.rec = new SR();
    this.rec.lang = 'uk-UA';
    this.rec.continuous = true;
    this.rec.interimResults = false;
    this.rec.maxAlternatives = 1;
    this.rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) this.onText(e.results[i][0].transcript.trim());
      }
    };
    this.rec.onerror = (e) => {
      if (e.error === 'not-allowed') {
        this.enabled = false;
        this.onStatus('Голос: немає доступу до мікрофона');
      }
    };
    // Браузер періодично завершує сесію — перезапускаємо, поки голос увімкнено.
    this.rec.onend = () => {
      if (this.enabled) setTimeout(() => this.enabled && this.safeStart(), 250);
    };
  }

  safeStart() {
    try {
      this.rec.start();
    } catch {
      /* уже слухає */
    }
  }

  start() {
    if (!this.supported) return false;
    this.enabled = true;
    this.safeStart();
    this.onStatus('Голос: слухаю (скажіть «меню», «піца», «далі», «додай в замовлення»…)');
    return true;
  }

  stop() {
    this.enabled = false;
    this.rec?.stop();
    this.onStatus('Голос: вимкнено');
  }
}
