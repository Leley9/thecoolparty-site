(async () => {
  const hash = location.hash.slice(1);
  if (!hash) return;

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
    return;
  }

  const { html, css, reveal, audio: hasAudio } = content;
  const revealAt = new Date(reveal).getTime();
  const root = document.getElementById('root');

  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  document.title = ' ';

  const audioPromise = hasAudio ? (async () => {
    try {
      const res = await fetch('audio.enc.bin', { cache: 'no-store' });
      if (!res.ok) return null;
      const buf = await res.arrayBuffer();
      const iv = buf.slice(0, 12);
      const data = buf.slice(12);
      const plainBuf = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv }, cryptoKey, data
      );
      return URL.createObjectURL(new Blob([plainBuf], { type: 'audio/mpeg' }));
    } catch {
      return null;
    }
  })() : Promise.resolve(null);

  function playWithFallback(audio) {
    audio.volume = 0;
    audio.play().then(() => {
      const fade = setInterval(() => {
        if (audio.volume < 1) audio.volume = Math.min(1, audio.volume + 0.04);
        else clearInterval(fade);
      }, 50);
    }).catch(() => {
      const btn = document.createElement('button');
      btn.className = 'play-btn';
      btn.textContent = '▶ Lancer la musique';
      btn.addEventListener('click', () => {
        audio.volume = 1;
        audio.play();
        btn.remove();
      }, { once: true });
      document.body.appendChild(btn);
    });
  }

  async function doReveal(withFade) {
    if (withFade) {
      root.style.transition = 'opacity 500ms ease';
      root.style.opacity = '0';
      await new Promise((r) => setTimeout(r, 500));
    }
    root.innerHTML = html;
    root.style.opacity = '1';

    const url = await audioPromise;
    if (url) playWithFallback(new Audio(url));
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
        <p class="hint">Touchez l'écran pour activer le son</p>
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
