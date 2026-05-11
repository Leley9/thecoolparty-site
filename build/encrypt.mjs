#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { randomBytes, createCipheriv } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KEY_FILE = resolve(ROOT, '.key');
const SRC = resolve(ROOT, 'src');
const DOCS = resolve(ROOT, 'docs');

const b64url = (buf) =>
  Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function loadOrCreateKey() {
  if (existsSync(KEY_FILE)) {
    const raw = readFileSync(KEY_FILE, 'utf8').trim();
    const key = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (key.length !== 32) throw new Error('.key invalide (32 octets attendus en base64url)');
    return key;
  }
  const key = randomBytes(32);
  writeFileSync(KEY_FILE, b64url(key) + '\n', { mode: 0o600 });
  console.log('Nouvelle clé générée → .key');
  return key;
}

function encryptBuffer(key, plaintextBuf) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintextBuf), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ct, tag]);
}

const key = loadOrCreateKey();

// ---- 1. contenu texte (html + css + meta) → content.enc.json ----
const html = readFileSync(join(SRC, 'content.html'), 'utf8');
const css = readFileSync(join(SRC, 'content.css'), 'utf8');
const meta = JSON.parse(readFileSync(join(SRC, 'meta.json'), 'utf8'));

const contentObj = { html, css, ...meta };

// ---- 2. audio (.mp3/.wav/.ogg/.m4a) → audio.enc.bin ----
const AUDIO_RX = /\.(mp3|wav|ogg|m4a)$/i;
const audioFile = readdirSync(SRC).find((f) => AUDIO_RX.test(f));
if (audioFile) {
  const buf = readFileSync(join(SRC, audioFile));
  writeFileSync(join(DOCS, 'audio.enc.bin'), encryptBuffer(key, buf));
  contentObj.audio = true;
  const mb = (buf.length / 1024 / 1024).toFixed(1);
  console.log(`OK → docs/audio.enc.bin (source: "${audioFile}", ${mb} MB)`);
}

// ---- 3. images attendues → <key>.enc.bin ----
const IMG_RX = /\.(jpg|jpeg|png|webp)$/i;
const IMG_KEYS = ['intro', 'program'];
const includedImages = [];
for (const k of IMG_KEYS) {
  const file = readdirSync(SRC).find(
    (f) => f.toLowerCase().startsWith(k) && IMG_RX.test(f)
  );
  if (!file) continue;
  const buf = readFileSync(join(SRC, file));
  writeFileSync(join(DOCS, `${k}.enc.bin`), encryptBuffer(key, buf));
  includedImages.push(k);
  const kb = (buf.length / 1024).toFixed(0);
  console.log(`OK → docs/${k}.enc.bin (source: "${file}", ${kb} KB)`);
}
if (includedImages.length) contentObj.images = includedImages;

// ---- 4. content.enc.json ----
const contentBuf = Buffer.from(JSON.stringify(contentObj), 'utf8');
const contentEnc = encryptBuffer(key, contentBuf);
// On garde le format JSON { iv, data } pour ce fichier (compat existante)
const iv = contentEnc.slice(0, 12);
const rest = contentEnc.slice(12);
writeFileSync(
  join(DOCS, 'content.enc.json'),
  JSON.stringify({ iv: b64url(iv), data: b64url(rest) })
);
console.log('OK → docs/content.enc.json');

// ---- 5. cache-bust : injecte le timestamp dans docs/index.html ----
const INDEX = join(DOCS, 'index.html');
const idx = readFileSync(INDEX, 'utf8');
const stamped = idx.replace(/app\.js\?v=\d+/, `app.js?v=${Date.now()}`);
if (stamped !== idx) {
  writeFileSync(INDEX, stamped);
  console.log('OK → docs/index.html (cache-bust mis à jour)');
}

// ---- 6. URL finale ----
const keyUrl = b64url(key);
console.log('\nURL complète pour le QR :');
console.log('  https://leley9.github.io/thecoolparty-site/#' + keyUrl + '\n');
