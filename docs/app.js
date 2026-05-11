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

  try {
    const keyBytes = b64urlDecode(hash);
    if (keyBytes.length !== 32) return;

    const key = await crypto.subtle.importKey(
      'raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']
    );

    const res = await fetch('content.enc.json', { cache: 'no-store' });
    if (!res.ok) return;
    const { iv, data } = await res.json();

    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64urlDecode(iv) },
      key,
      b64urlDecode(data)
    );

    const { html, css } = JSON.parse(new TextDecoder().decode(plaintext));

    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    document.getElementById('root').innerHTML = html;
    document.title = ' ';
  } catch {
    // déchiffrement raté → on garde le 404 par défaut, en silence
  }
})();
