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

  const { html, css, reveal, audio: hasAudio, images = [], fonts = [] } = content;
  const revealAt = new Date(reveal).getTime();

  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  document.title = ' ';

  // ---- Décryption d'un binaire (IV|ciphertext|tag) → Blob URL ----
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

  // Toutes les images sont déchiffrées en parallèle et exposées comme variables
  // CSS --<name>-img. Disponibles dès que prêtes, le CSS s'auto-remplit.
  for (const { name, mime } of images) {
    decryptBin(`${name}.enc.bin`, mime).then((url) => {
      if (url) document.documentElement.style.setProperty(`--${name}-img`, `url("${url}")`);
    });
  }

  // Fonts : déchiffrement + enregistrement via FontFace API, en parallèle.
  // On collecte les promesses pour attendre le chargement avant le reveal,
  // sinon FOUT visible quand on swap vers .page (qui utilise la font).
  const fontPromises = fonts.map(({ name, family, mime }) =>
    decryptBin(`${name}.enc.bin`, mime).then(async (url) => {
      if (!url) return;
      const face = new FontFace(family, `url(${url})`);
      await face.load();
      document.fonts.add(face);
    })
  );

  // ---- Audio : un seul élément, primé lors du tap pour autoplay iOS ----
  // Si l'audio réel est déjà chargé au moment du tap → on prime directement
  // avec la vraie source (le plus fiable). Sinon → silence le temps que
  // l'audio finisse de se déchiffrer, puis on swap la src.
  const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
  const audioEl = new Audio();
  audioEl.loop = true;
  audioEl.preload = 'auto';
  let audioPrimed = false;
  let realSrcReady = false;

  audioPromise.then((url) => {
    if (!url) return;
    audioEl.src = url;
    realSrcReady = true;
    audioEl.load();
  });

  function primeAudio() {
    if (audioPrimed) return;
    audioPrimed = true;
    // Bug avant : on écrasait toujours src par SILENT_WAV, ce qui pétait
    // la vraie source si elle était déjà là. On garde la vraie src si dispo.
    if (!realSrcReady) {
      audioEl.src = SILENT_WAV;
    }
    audioEl.muted = true;
    const p = audioEl.play();
    if (p) {
      p.then(() => {
        audioEl.pause();
        audioEl.muted = false;
      }).catch(() => {
        audioEl.muted = false;
      });
    }
  }

  function startMusic() {
    audioEl.currentTime = 0;
    audioEl.volume = 0;
    audioEl.play().then(() => {
      const fade = setInterval(() => {
        if (audioEl.volume < 1) audioEl.volume = Math.min(1, audioEl.volume + 0.04);
        else clearInterval(fade);
      }, 50);
    }).catch(() => {
      // Pas de tap pendant le countdown → autoplay refusé. Silencieux.
    });
  }

  async function doReveal(withFade) {
    // Attend les fonts pour éviter un FOUT (la page utilise Danken)
    await Promise.all(fontPromises);

    if (withFade) {
      root.style.transition = 'opacity 500ms ease';
      root.style.opacity = '0';
      await new Promise((r) => setTimeout(r, 500));
    }
    root.innerHTML = html;
    root.style.opacity = '1';

    await audioPromise;
    if (hasAudio) startMusic();
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
        <div class="rabbit rabbit-looking"></div>
        <p class="hint">Tap the screen to enable sound</p>
        <div class="rabbit rabbit-seating"></div>
        <div class="rabbit rabbit-running"></div>
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
