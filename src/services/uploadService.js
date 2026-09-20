'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../../config/config');

/**
 * Bild-Uploads aus dem Dashboard (Embed-Bilder, Vorschaubilder, Banner).
 * Discord-Embeds brauchen eine öffentliche https-URL – die Datei wird deshalb unter
 * <DASHBOARD_URL>/uploads/<guildId>/<hash>.<ext> öffentlich (ohne Login) ausgeliefert.
 *
 * Sicherheit: Es werden nur echte Rasterbilder angenommen (Erkennung am Dateiinhalt, kein SVG),
 * der Dateiname ist ein Hash des Inhalts (kein Nutzer-Dateiname, kein Pfad-Trick).
 */

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB je Bild
const MAX_GUILD_BYTES = 1024 * 1024 * 1024; // 1 GB je Server als Schutz vor vollgelaufener Platte

const uploadsDir = () => path.join(config.database.dir, 'uploads');

/** Dateityp am Inhalt erkennen. */
function detectType(buf) {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 6 && ['GIF87a', 'GIF89a'].includes(buf.subarray(0, 6).toString('latin1'))) return 'gif';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

function dirSize(dir) {
  let total = 0;
  for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    try { total += fs.statSync(path.join(dir, name)).size; } catch { /* ignore */ }
  }
  return total;
}

/**
 * Speichert ein Bild (Data-URL oder reines Base64) und liefert die öffentliche URL.
 * @returns {{ url: string, file: string, bytes: number }}
 */
function saveImage(guildId, input) {
  if (!/^\d{5,25}$/.test(String(guildId))) throw Object.assign(new Error('Ungültiger Server.'), { status: 400 });
  const raw = String(input || '').replace(/^data:[^;,]*;base64,/, '');
  if (!raw || !/^[A-Za-z0-9+/=\s]+$/.test(raw)) throw Object.assign(new Error('Ungültiges Bild.'), { status: 400 });
  if (raw.length > MAX_BYTES * 1.4) throw Object.assign(new Error('Das Bild ist zu groß (max. 8 MB).'), { status: 413 });

  const buf = Buffer.from(raw, 'base64');
  if (!buf.length) throw Object.assign(new Error('Ungültiges Bild.'), { status: 400 });
  if (buf.length > MAX_BYTES) throw Object.assign(new Error('Das Bild ist zu groß (max. 8 MB).'), { status: 413 });
  const ext = detectType(buf);
  if (!ext) throw Object.assign(new Error('Nur PNG, JPG, GIF oder WebP sind erlaubt.'), { status: 400 });

  const dir = path.join(uploadsDir(), String(guildId));
  fs.mkdirSync(dir, { recursive: true });
  const file = `${crypto.createHash('sha256').update(buf).digest('hex').slice(0, 32)}.${ext}`;
  const target = path.join(dir, file);
  if (!fs.existsSync(target)) {
    if (dirSize(dir) + buf.length > MAX_GUILD_BYTES) throw Object.assign(new Error('Der Bild-Speicher dieses Servers ist voll.'), { status: 413 });
    fs.writeFileSync(target, buf);
  }
  return { url: `${config.dashboard.url}/uploads/${guildId}/${file}`, file, bytes: buf.length };
}

module.exports = { saveImage, detectType, uploadsDir, MAX_BYTES };
