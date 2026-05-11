#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes, createCipheriv } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KEY_FILE = resolve(ROOT, '.key');
const SRC_HTML = resolve(ROOT, 'src/content.html');
const SRC_CSS = resolve(ROOT, 'src/content.css');
const OUT = resolve(ROOT, 'docs/content.enc.json');

const b64url = (buf) =>
  Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let key;
if (existsSync(KEY_FILE)) {
  const raw = readFileSync(KEY_FILE, 'utf8').trim();
  key = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (key.length !== 32) {
    throw new Error('.key invalide (32 octets attendus en base64url)');
  }
} else {
  key = randomBytes(32);
  writeFileSync(KEY_FILE, b64url(key) + '\n', { mode: 0o600 });
  console.log('Nouvelle clé générée → .key (gitignored, garde-la précieusement)');
}

const html = readFileSync(SRC_HTML, 'utf8');
const css = readFileSync(SRC_CSS, 'utf8');
const plaintext = Buffer.from(JSON.stringify({ html, css }), 'utf8');

const iv = randomBytes(12);
const cipher = createCipheriv('aes-256-gcm', key, iv);
const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
const tag = cipher.getAuthTag();
const payload = Buffer.concat([ct, tag]);

writeFileSync(OUT, JSON.stringify({ iv: b64url(iv), data: b64url(payload) }));

const keyUrl = b64url(key);
console.log('\nOK → docs/content.enc.json');
console.log('\nFragment à coller après le # de l\'URL :');
console.log('  ' + keyUrl);
console.log('\nExemple :');
console.log('  https://<user>.github.io/<repo>/#' + keyUrl);
console.log('\nC\'est cette URL complète qu\'il faut encoder dans le QR code.\n');
