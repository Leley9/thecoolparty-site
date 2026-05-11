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
  return { iv, payload: Buffer.concat([ct, tag]) };
}

const key = loadOrCreateKey();

// ---- 1. contenu texte (html + css + meta) → content.enc.json ----
const html = readFileSync(join(SRC, 'content.html'), 'utf8');
const css = readFileSync(join(SRC, 'content.css'), 'utf8');
const meta = JSON.parse(readFileSync(join(SRC, 'meta.json'), 'utf8'));

const AUDIO_RX = /\.(mp3|wav|ogg|m4a)$/i;
const audioFile = readdirSync(SRC).find((f) => AUDIO_RX.test(f));

const payload = { html, css, ...meta };
if (audioFile) payload.audio = true;

const { iv: contentIv, payload: contentCt } = encryptBuffer(
  key,
  Buffer.from(JSON.stringify(payload), 'utf8')
);
writeFileSync(
  join(DOCS, 'content.enc.json'),
  JSON.stringify({ iv: b64url(contentIv), data: b64url(contentCt) })
);
console.log('OK → docs/content.enc.json');

// ---- 2. audio (si présent) → audio.enc.bin (binaire brut : iv|ct|tag) ----
if (audioFile) {
  const audioBuf = readFileSync(join(SRC, audioFile));
  const { iv: aIv, payload: aCt } = encryptBuffer(key, audioBuf);
  writeFileSync(join(DOCS, 'audio.enc.bin'), Buffer.concat([aIv, aCt]));
  const mb = (audioBuf.length / 1024 / 1024).toFixed(1);
  console.log(`OK → docs/audio.enc.bin (source: "${audioFile}", ${mb} MB)`);
}

// ---- 3. rappel URL ----
const keyUrl = b64url(key);
console.log('\nFragment de clé (à coller après #) :');
console.log('  ' + keyUrl);
console.log('\nURL complète pour le QR :');
console.log('  https://leley9.github.io/thecoolparty-site/#' + keyUrl + '\n');
