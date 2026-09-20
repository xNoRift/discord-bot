'use strict';

/**
 * Spotify-Links (Playlist / Album / Titel) in eine Titelliste auflösen.
 *
 * Spotify erlaubt kein Streamen an Bots (DRM) und die Web-API gibt seit 2026 für
 * fremde Playlists keine Daten mehr heraus. Deshalb wird nur die Titelliste
 * (Name + Interpret + Dauer) aus der öffentlichen Embed-Seite gelesen – ohne
 * Login und ohne API-Key. Abgespielt wird später über YouTube (siehe musicService).
 *
 * Grenzen: nur öffentliche Playlists, Spotify liefert dort maximal 100 Titel.
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const TYPES = new Set(['playlist', 'album', 'track']);

/** { type, id } aus Link/URI, sonst null. Akzeptiert auch /intl-de/ und ?si=… */
function parse(input) {
  const s = String(input || '').trim();
  const uri = s.match(/^spotify:(playlist|album|track):([A-Za-z0-9]{22})$/);
  if (uri) return { type: uri[1], id: uri[2] };
  const url = s.match(/^https?:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(playlist|album|track)\/([A-Za-z0-9]{22})(?:[/?#]|$)/i);
  if (url) return { type: url[1].toLowerCase(), id: url[2] };
  return null;
}

const clean = (v) => String(v || '').replace(/\s+/g, ' ').trim();

function toTrack(t) {
  const id = String(t.uri || '').split(':').pop();
  return {
    id,
    title: clean(t.title),
    artist: clean(t.subtitle),
    duration: Math.round((Number(t.duration) || 0) / 1000),
    url: id ? `https://open.spotify.com/track/${id}` : null,
  };
}

/**
 * @returns {Promise<{ type: string, name: string, tracks: Array<{id,title,artist,duration,url}> }>}
 */
async function fetchTracks({ type, id }) {
  if (!TYPES.has(type)) throw new Error('Dieser Spotify-Link wird nicht unterstützt (nur Playlist, Album oder Titel).');
  let res;
  try {
    res = await fetch(`https://open.spotify.com/embed/${type}/${id}`, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'de,en;q=0.8' },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error('Spotify ist gerade nicht erreichbar – bitte später nochmal versuchen.');
  }
  if (!res.ok) throw new Error(`Spotify hat die Anfrage abgelehnt (HTTP ${res.status}).`);

  const html = await res.text();
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  let entity = null;
  try {
    entity = m ? JSON.parse(m[1])?.props?.pageProps?.state?.data?.entity : null;
  } catch {
    /* unten: Fehlermeldung */
  }
  if (!entity) {
    throw new Error('Spotify-Link nicht gefunden. Die Playlist muss öffentlich sein (nicht privat) – Link nochmal prüfen.');
  }

  let raw;
  if (type === 'track') {
    raw = [{
      uri: entity.uri,
      title: entity.title || entity.name,
      subtitle: (entity.artists || []).map((a) => a.name).join(', '),
      duration: entity.duration,
    }];
  } else {
    raw = entity.trackList || [];
  }
  const tracks = raw.map(toTrack).filter((t) => t.title);
  if (!tracks.length) throw new Error('Die Spotify-Liste ist leer oder konnte nicht gelesen werden.');
  return { type, name: clean(entity.name || entity.title), tracks };
}

module.exports = { parse, fetchTracks };
