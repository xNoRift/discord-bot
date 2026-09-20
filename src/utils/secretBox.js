'use strict';

const crypto = require('node:crypto');

/**
 * Verschlüsselung sensibler Werte in der Datenbank (AES-256-GCM).
 * Schlüssel: DATA_ENCRYPTION_KEY aus der .env, sonst wird er aus SESSION_SECRET abgeleitet.
 * Klartext-Altwerte (ohne "enc:v1:"-Präfix) werden beim Lesen unverändert durchgereicht,
 * damit bestehende Datenbanken weiter funktionieren.
 */

const PREFIX = 'enc:v1:';
let keyCache = null;

function getKey() {
  if (keyCache) return keyCache;
  const secret = process.env.DATA_ENCRYPTION_KEY || process.env.SESSION_SECRET;
  if (!secret) throw new Error('Weder DATA_ENCRYPTION_KEY noch SESSION_SECRET gesetzt – Verschlüsselung nicht möglich.');
  keyCache = crypto.scryptSync(secret, 'norift-secretbox-v1', 32);
  return keyCache;
}

function encrypt(plain) {
  if (plain === null || plain === undefined || plain === '') return plain;
  const text = String(plain);
  if (text.startsWith(PREFIX)) return text;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const ct = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

function decrypt(value) {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return value;
  try {
    const [iv, tag, ct] = value.slice(PREFIX.length).split(':').map((p) => Buffer.from(p, 'base64'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    // Falscher Schlüssel / beschädigter Wert -> als "kein Token" behandeln (erzwingt neuen Login).
    return null;
  }
}

function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

module.exports = { encrypt, decrypt, isEncrypted };
