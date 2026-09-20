'use strict';

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const logger = require('../utils/logger');

/**
 * Dünner Wrapper um das yt-dlp-Binary (für YouTube).
 * yt-dlp ist NICHT als npm-Paket dabei – es muss auf dem System liegen:
 *   Linux:  curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o /usr/local/bin/yt-dlp && chmod a+rx /usr/local/bin/yt-dlp
 * oder Pfad per .env  YTDLP_PATH=/pfad/zu/yt-dlp
 */

let _bin = null;
let _checked = false;

function resolveBin() {
  if (_checked) return _bin;
  _checked = true;
  const candidates = [
    process.env.YTDLP_PATH,
    path.join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'),
    process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp',
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      if (c.includes('/') || c.includes('\\')) {
        if (fs.existsSync(c)) { _bin = c; break; }
      } else {
        const r = spawnSync(c, ['--version'], { timeout: 5000 });
        if (r.status === 0) { _bin = c; break; }
      }
    } catch {
      /* weiter */
    }
  }
  if (_bin) logger.info(`[music] yt-dlp gefunden: ${_bin}`);
  else logger.warn('[music] yt-dlp nicht gefunden – YouTube ist deaktiviert (Radio/Stream-URLs funktionieren).');
  return _bin;
}

function available() {
  return Boolean(resolveBin());
}

function run(args, { timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const bin = resolveBin();
    if (!bin) return reject(new Error('YouTube ist nicht verfügbar – auf dem Server fehlt yt-dlp.'));
    const p = spawn(bin, args, { timeout });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(err.split('\n').find((l) => l.includes('ERROR')) || `yt-dlp Fehler (${code})`))));
  });
}

const COMMON = ['--no-playlist', '--no-warnings', '--flat-playlist', '-J'];

/** Metadaten für eine YouTube-URL oder Suche ("ytsearch1:..."). */
async function info(input) {
  const target = /^https?:\/\//i.test(input) ? input : `ytsearch1:${input}`;
  const raw = await run([...COMMON.filter((a) => a !== '--flat-playlist'), '--default-search', 'ytsearch', target]);
  const data = JSON.parse(raw);
  const v = data.entries ? data.entries[0] : data;
  if (!v) throw new Error('Nichts gefunden.');
  return {
    title: v.title || 'Unbekannt',
    url: v.webpage_url || v.original_url || input,
    duration: Math.round(v.duration || 0),
    live: Boolean(v.is_live),
    thumbnail: v.thumbnail || (v.thumbnails && v.thumbnails[v.thumbnails.length - 1]?.url) || null,
  };
}

/**
 * Beste YouTube-Übereinstimmung für einen Songtitel (z. B. aus Spotify): holt die
 * Top-5-Treffer und nimmt den, dessen Länge der erwarteten am nächsten kommt
 * (max. 15 s Abweichung) – sonst den ersten Nicht-Live-Treffer.
 */
async function searchBest(query, expectedSec = 0) {
  let entries = [];
  try {
    const raw = await run(['--flat-playlist', '--no-warnings', '-J', `ytsearch5:${query}`]);
    entries = (JSON.parse(raw).entries || []).filter((e) => e && e.id && !e.is_live);
  } catch {
    /* unten: Fallback auf Einzelsuche */
  }
  if (!entries.length) return info(query);
  let pick = entries[0];
  if (expectedSec > 0) {
    const scored = entries
      .filter((e) => e.duration)
      .map((e) => ({ e, diff: Math.abs(e.duration - expectedSec) }))
      .sort((a, b) => a.diff - b.diff);
    if (scored.length && scored[0].diff <= 15) pick = scored[0].e;
  }
  return {
    title: pick.title || 'Unbekannt',
    url: pick.url && pick.url.startsWith('http') ? pick.url : `https://www.youtube.com/watch?v=${pick.id}`,
    duration: Math.round(pick.duration || 0),
    live: false,
    thumbnail: pick.thumbnails && pick.thumbnails[pick.thumbnails.length - 1]?.url,
  };
}

/** Playlist auflösen (bis limit). */
async function playlist(url, limit = 100) {
  const raw = await run(['--yes-playlist', '--flat-playlist', '--no-warnings', '-J', '--playlist-end', String(limit), url]);
  const data = JSON.parse(raw);
  const entries = data.entries || [];
  return entries.map((e) => ({
    title: e.title || 'Unbekannt',
    url: e.url && e.url.startsWith('http') ? e.url : `https://www.youtube.com/watch?v=${e.id}`,
    duration: Math.round(e.duration || 0),
    live: Boolean(e.is_live),
    thumbnail: e.thumbnails && e.thumbnails[e.thumbnails.length - 1]?.url,
  }));
}

/** Bestes Audio als Node-Readable-Stream (yt-dlp -> stdout). */
function stream(url) {
  const bin = resolveBin();
  if (!bin) throw new Error('YouTube ist nicht verfügbar – auf dem Server fehlt yt-dlp.');
  const p = spawn(
    bin,
    [
      // Opus-Audio bevorzugen (verlustärmer bei der Weitergabe an Discord)
      '-f', 'bestaudio[acodec=opus]/bestaudio[ext=webm]/bestaudio/best',
      '-N', '4', // 4 Fragmente parallel laden -> gleichmäßigerer Puffer, weniger Aussetzer
      '--no-playlist', '--no-warnings', '--no-part', '--quiet',
      '-o', '-', url,
    ],
    { stdio: ['ignore', 'pipe', 'ignore'] },
  );
  p.on('error', () => p.stdout?.destroy());
  return p.stdout;
}

module.exports = { available, info, searchBest, playlist, stream };
