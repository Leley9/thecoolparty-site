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

  // Tous les assets se chargent en parallèle dès la décryption du content
  const audioPromise = hasAudio ? decryptBin('audio.enc.bin', 'audio/mpeg') : Promise.resolve(null);
  const introPromise = images.includes('intro') ? decryptBin('intro.enc.bin', 'image/jpeg') : Promise.resolve(null);
  const programPromise = images.includes('program') ? decryptBin('program.enc.bin', 'image/jpeg') : Promise.resolve(null);

  function playWithFallback(audio) {
    audio.loop = true;
    audio.volume = 0;
    audio.play().then(() => {
      const fade = setInterval(() => {
        if (audio.volume < 1) audio.volume = Math.min(1, audio.volume + 0.04);
        else clearInterval(fade);
      }, 50);
    }).catch(() => {
      const btn = document.createElement('button');
      btn.className = 'play-btn';
      btn.textContent = '▶ Play music';
      btn.addEventListener('click', () => {
        audio.volume = 1;
        audio.play();
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

  // Timing intro :
  //   - 0-1150ms : 4 rangs apparaissent staggerés (0/150/300/450 + 700ms de fade)
  //   - 500ms de pause sur l'image complète
  //   - 1300ms de spread
  //   → swap accueil à 2950ms
  const HOLD_MS = 500;
  const SPREAD_MS = 1300;
  const APPEAR_END_MS = 450 + 700; // dernier rang appear-end

  async function runIntroThenAccueil() {
    root.innerHTML = INTRO_HTML;
    const intro = root.querySelector('.intro');

    // Lance la musique au moment où l'intro démarre
    const audioUrl = await audioPromise;
    if (audioUrl) playWithFallback(new Audio(audioUrl));

    await new Promise((r) => setTimeout(r, APPEAR_END_MS + HOLD_MS));
    intro.classList.add('spread');
    await new Promise((r) => setTimeout(r, SPREAD_MS));

    root.innerHTML = html;
  }

  async function doReveal(withFade) {
    // Injecte les blob URLs des images avant le render des éléments qui les utilisent
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
