(async () => {
  const root = document.getElementById('root');
  const show404 = () => { root.innerHTML = '<div class="nf">404 Not Found</div>'; };

  const hash = location.hash.slice(1);
  if (!hash) { show404(); return; }

  const b64urlDecode = (s) => {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };

  let cryptoKey, content;
  try {
    const keyBytes = b64urlDecode(hash);
    if (keyBytes.length !== 32) return;

    cryptoKey = await crypto.subtle.importKey(
      'raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']
    );

    const res = await fetch('content.enc.json', { cache: 'no-store' });
    if (!res.ok) return;
    const { iv, data } = await res.json();
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64urlDecode(iv) },
      cryptoKey,
      b64urlDecode(data)
    );
    content = JSON.parse(new TextDecoder().decode(plain));
  } catch {
    show404();
    return;
  }

  const { html, css, reveal, audio: hasAudio, images = [] } = content;
  const revealAt = new Date(reveal).getTime();

  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  document.title = ' ';

  async function decryptBin(path, mime) {
    try {
      const res = await fetch(path, { cache: 'no-store' });
      if (!res.ok) return null;
      const buf = await res.arrayBuffer();
      const iv = buf.slice(0, 12);
      const data = buf.slice(12);
      const plainBuf = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv }, cryptoKey, data
      );
      return URL.createObjectURL(new Blob([plainBuf], { type: mime }));
    } catch {
      return null;
    }
  }

  const audioPromise = hasAudio ? decryptBin('audio.enc.bin', 'audio/mpeg') : Promise.resolve(null);
  const introPromise = images.includes('intro') ? decryptBin('intro.enc.bin', 'image/jpeg') : Promise.resolve(null);
  const programPromise = images.includes('program') ? decryptBin('program.enc.bin', 'image/jpeg') : Promise.resolve(null);

  // ---- Audio : un seul élément, primé lors du tap pendant le countdown ----
  // Sans ce priming, iOS ne propage pas le user-gesture jusqu'à un Audio créé
  // plus tard de manière asynchrone → autoplay refusé même après tap.
  const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
  const audioEl = new Audio();
  audioEl.loop = true;
  audioEl.preload = 'auto';
  let audioPrimed = false;

  function primeAudio() {
    if (audioPrimed) return;
    audioPrimed = true;
    // Play silencieux dans le gesture handler → débloque l'élément sur iOS.
    // Une fois débloqué, changer src vers la musique réelle plus tard préserve
    // l'autorisation de lecture.
    audioEl.src = SILENT_WAV;
    audioEl.muted = true;
    audioEl.play().then(() => {
      audioEl.pause();
      audioEl.currentTime = 0;
      audioEl.muted = false;
    }).catch(() => {
      audioEl.muted = false;
    });
  }

  audioPromise.then((url) => {
    if (!url) return;
    // Remplace la source ; si on a primé, l'élément reste débloqué.
    const wasPlaying = !audioEl.paused;
    audioEl.pause();
    audioEl.src = url;
    if (wasPlaying) audioEl.play().catch(() => {});
  });

  function startMusic() {
    audioEl.volume = 0;
    audioEl.play().then(() => {
      const fade = setInterval(() => {
        if (audioEl.volume < 1) audioEl.volume = Math.min(1, audioEl.volume + 0.04);
        else clearInterval(fade);
      }, 50);
    }).catch(() => {
      // Autoplay refusé malgré tout → bouton de secours
      const btn = document.createElement('button');
      btn.className = 'play-btn';
      btn.textContent = '▶ Play music';
      btn.addEventListener('click', () => {
        audioEl.volume = 1;
        audioEl.play();
        btn.remove();
      }, { once: true });
      document.body.appendChild(btn);
    });
  }

  const INTRO_HTML = `
    <div class="intro">
      <div class="intro-stage">
        <div class="intro-row" data-i="0"></div>
        <div class="intro-row" data-i="1"></div>
        <div class="intro-row" data-i="2"></div>
        <div class="intro-row" data-i="3"></div>
      </div>
    </div>
  `;

  const HOLD_MS = 500;
  const SPREAD_MS = 1300;
  const APPEAR_END_MS = 450 + 700;

  async function runIntroThenAccueil() {
    root.innerHTML = INTRO_HTML;
    const intro = root.querySelector('.intro');

    // S'assure que la source audio est en place puis lance
    await audioPromise;
    if (hasAudio) startMusic();

    await new Promise((r) => setTimeout(r, APPEAR_END_MS + HOLD_MS));
    intro.classList.add('spread');
    await new Promise((r) => setTimeout(r, SPREAD_MS));

    root.innerHTML = html;
  }

  async function doReveal(withFade) {
    const [introUrl, programUrl] = await Promise.all([introPromise, programPromise]);
    if (introUrl) document.documentElement.style.setProperty('--intro-img', `url("${introUrl}")`);
    if (programUrl) document.documentElement.style.setProperty('--program-img', `url("${programUrl}")`);

    if (withFade) {
      root.style.transition = 'opacity 500ms ease';
      root.style.opacity = '0';
      await new Promise((r) => setTimeout(r, 500));
    }
    root.style.opacity = '1';

    await runIntroThenAccueil();
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  function tick() {
    const diff = revealAt - Date.now();
    if (diff <= 0) { doReveal(true); return; }
    const s = Math.floor(diff / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const time = root.querySelector('.timer .time');
    if (time) {
      time.innerHTML =
        `<span>${pad(d)}</span><i>:</i><span>${pad(h)}</span>` +
        `<i>:</i><span>${pad(m)}</span><i>:</i><span>${pad(sec)}</span>`;
    }
    setTimeout(tick, 1000 - (Date.now() % 1000));
  }

  if (Date.now() >= revealAt) {
    doReveal(false);
  } else {
    root.innerHTML = `
      <div class="timer">
        <div class="time"><span>--</span><i>:</i><span>--</span><i>:</i><span>--</span><i>:</i><span>--</span></div>
        <p class="hint">Tap the screen to enable sound</p>
      </div>
    `;
    const hint = root.querySelector('.timer .hint');
    root.querySelector('.timer').addEventListener('pointerdown', () => {
      primeAudio();
      hint.style.opacity = '0';
      setTimeout(() => {
        hint.textContent = "you're on";
        hint.classList.add('on');
        hint.style.opacity = '';
      }, 200);
    }, { once: true });
    tick();
  }
})();
