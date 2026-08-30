'use strict';

const ffmpegPath = require('ffmpeg-static');
if (ffmpegPath) process.env.FFMPEG_PATH = ffmpegPath;

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  StreamType,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  NoSubscriberBehavior,
  entersState,
  getVoiceConnection,
} = require('@discordjs/voice');
const prism = require('prism-media');
const ytdlp = require('./ytdlp');

const logger = require('../utils/logger');
const settingsModel = require('../database/models/settings');
const stationsModel = require('../database/models/musicStations');
const BUILTIN_STATIONS = require('../data/radioStations');

/**
 * Musik-Service: eine Session pro Server (im Speicher).
 * Quellen: YouTube (Suche/Link, via yt-dlp) und Radio/direkte Stream-URLs (via FFmpeg).
 */

const IDLE_DISCONNECT_MS = 3 * 60 * 1000;
const MAX_QUEUE = 200;

/** @type {Map<string, Session>} */
const sessions = new Map();

function fmtDuration(sec) {
  if (!sec || sec <= 0) return 'LIVE';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(s).padStart(2, '0')}`;
}

function allStations(guildId) {
  const custom = stationsModel.list(guildId).map((r) => ({
    key: `c${r.id}`,
    name: r.name,
    url: r.url,
    genre: 'Eigene',
    custom: true,
    id: r.id,
  }));
  return [...BUILTIN_STATIONS, ...custom];
}

function findStation(guildId, query) {
  const q = String(query || '').trim().toLowerCase();
  const list = allStations(guildId);
  return (
    list.find((s) => s.key.toLowerCase() === q) ||
    list.find((s) => s.name.toLowerCase() === q) ||
    list.find((s) => s.name.toLowerCase().includes(q))
  );
}

/* ---------------------------------------------------------------- */

class Session {
  constructor(guild) {
    this.guild = guild;
    this.guildId = guild.id;
    this.voiceChannelId = null;
    this.textChannelId = null;
    this.queue = [];
    this.current = null;
    this.loop = false;
    this.paused = false;
    const s = settingsModel.get(guild.id);
    this.volume = Math.max(0, Math.min(1.5, (Number(s.music_default_volume) || 100) / 100));
    this.connection = null;
    this.player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
    this.resource = null;
    this.idleTimer = null;

    this.player.on(AudioPlayerStatus.Idle, () => this._onIdle());
    this.player.on('error', (err) => {
      logger.warn(`[music] Player-Fehler (${this.guildId}): ${err.message}`);
      this._announce(`⚠️ Fehler bei **${this.current?.title || 'Titel'}** – überspringe.`);
      this._next();
    });
  }

  async connect(voiceChannel, textChannelId) {
    this.textChannelId = textChannelId || this.textChannelId;
    if (this.connection && this.voiceChannelId === voiceChannel.id) return;
    this.voiceChannelId = voiceChannel.id;
    this.connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: this.guildId,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: true,
    });
    this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(this.connection, VoiceConnectionStatus.Signalling, 5000),
          entersState(this.connection, VoiceConnectionStatus.Connecting, 5000),
        ]);
      } catch {
        this.destroy();
      }
    });
    this.connection.subscribe(this.player);
    await entersState(this.connection, VoiceConnectionStatus.Ready, 20000).catch(() => {
      throw new Error('Konnte dem Sprachkanal nicht beitreten.');
    });
  }

  _clearIdle() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  _scheduleIdle() {
    this._clearIdle();
    this.idleTimer = setTimeout(() => {
      this._announce('👋 Nichts mehr in der Warteschlange – ich verlasse den Sprachkanal.');
      this.destroy();
    }, IDLE_DISCONNECT_MS);
  }

  _onIdle() {
    if (this.loop && this.current) {
      this.queue.unshift(this.current);
    }
    this._next();
  }

  async _next() {
    this.current = this.queue.shift() || null;
    this.paused = false;
    if (!this.current) {
      this.resource = null;
      this._scheduleIdle();
      return;
    }
    this._clearIdle();
    try {
      this.resource = await this._createResource(this.current);
      this.resource.volume?.setVolume(this.volume);
      this.player.play(this.resource);
      this._announce(
        `▶️ **${this.current.title}**` +
          (this.current.live ? ' _(Live)_' : ` \`${fmtDuration(this.current.duration)}\``) +
          (this.current.requestedBy ? ` · von ${this.current.requestedBy.tag}` : ''),
      );
    } catch (err) {
      logger.warn(`[music] Resource-Fehler: ${err.message}`);
      this._announce(`⚠️ **${this.current.title}** konnte nicht abgespielt werden – überspringe.`);
      return this._next();
    }
  }

  async _createResource(track) {
    if (track.source === 'youtube') {
      const src = ytdlp.stream(track.url);
      const ff = new prism.FFmpeg({
        args: ['-i', '-', '-analyzeduration', '0', '-loglevel', '0', '-acodec', 'pcm_s16le', '-f', 's16le', '-ar', '48000', '-ac', '2'],
      });
      src.on('error', () => ff.destroy());
      src.pipe(ff);
      return createAudioResource(ff, { inputType: StreamType.Raw, inlineVolume: true });
    }
    // Radio / direkte URL -> FFmpeg mit Reconnect
    const transcoder = new prism.FFmpeg({
      args: [
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '5',
        '-i', track.url,
        '-analyzeduration', '0',
        '-loglevel', '0',
        '-acodec', 'pcm_s16le',
        '-f', 's16le',
        '-ar', '48000',
        '-ac', '2',
      ],
    });
    return createAudioResource(transcoder, { inputType: StreamType.Raw, inlineVolume: true });
  }

  _announce(text) {
    const ch = this.guild.channels.cache.get(this.textChannelId);
    ch?.send({ content: text, allowedMentions: { parse: [] } }).catch(() => null);
  }

  enqueue(tracks) {
    const room = MAX_QUEUE - this.queue.length;
    const added = tracks.slice(0, Math.max(0, room));
    this.queue.push(...added);
    return added.length;
  }

  async startIfIdle() {
    if (!this.current && this.player.state.status !== AudioPlayerStatus.Playing) {
      await this._next();
    }
  }

  skip() {
    const skipped = this.current;
    this.player.stop(true); // löst Idle -> _next aus
    return skipped;
  }

  stop() {
    this.queue = [];
    this.loop = false;
    this.player.stop(true);
  }

  pause() {
    this.paused = this.player.pause();
    return this.paused;
  }

  resume() {
    const ok = this.player.unpause();
    if (ok) this.paused = false;
    return ok;
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1.5, vol));
    this.resource?.volume?.setVolume(this.volume);
    return this.volume;
  }

  toggleLoop() {
    this.loop = !this.loop;
    return this.loop;
  }

  shuffle() {
    for (let i = this.queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
    }
  }

  removeAt(index) {
    if (index < 0 || index >= this.queue.length) return null;
    return this.queue.splice(index, 1)[0];
  }

  destroy() {
    this._clearIdle();
    try { this.player.stop(true); } catch { /* ignore */ }
    try { this.connection?.destroy(); } catch { /* ignore */ }
    sessions.delete(this.guildId);
  }

  state() {
    return {
      connected: Boolean(this.connection),
      voiceChannelId: this.voiceChannelId,
      paused: this.paused,
      loop: this.loop,
      volume: Math.round(this.volume * 100),
      current: this.current
        ? {
            title: this.current.title,
            url: this.current.url,
            source: this.current.source,
            live: this.current.live,
            duration: this.current.duration,
            thumbnail: this.current.thumbnail || null,
            requestedBy: this.current.requestedBy?.tag || null,
          }
        : null,
      queue: this.queue.map((t, i) => ({
        index: i,
        title: t.title,
        url: t.url,
        source: t.source,
        live: t.live,
        duration: t.duration,
        requestedBy: t.requestedBy?.tag || null,
      })),
    };
  }
}

/* ---------------------------------------------------------------- */

function getSession(guildId) {
  return sessions.get(guildId) || null;
}

function getOrCreate(guild) {
  let s = sessions.get(guild.id);
  if (!s) {
    s = new Session(guild);
    sessions.set(guild.id, s);
  }
  return s;
}

/** Query auflösen -> Liste von Tracks. */
async function resolveTracks(guildId, query, requestedBy) {
  const q = String(query || '').trim();
  if (!q) throw new Error('Bitte einen Suchbegriff oder Link angeben.');
  const noYt = 'YouTube ist auf diesem Server nicht verfügbar (yt-dlp fehlt). Radio-Sender und direkte Stream-URLs funktionieren.';

  if (/^https?:\/\//i.test(q)) {
    const isYouTube = /(?:youtube\.com|youtu\.be|music\.youtube\.com)/i.test(q);
    if (isYouTube) {
      if (!ytdlp.available()) throw new Error(noYt);
      const isPlaylist = /[?&]list=/.test(q) && !/[?&]v=/.test(q);
      if (isPlaylist) {
        const items = await ytdlp.playlist(q);
        if (!items.length) throw new Error('Playlist ist leer oder nicht abrufbar.');
        return items.map((t) => ({ ...t, source: 'youtube', requestedBy }));
      }
      const v = await ytdlp.info(q);
      return [{ ...v, source: 'youtube', requestedBy }];
    }
    // Nicht-YouTube-URL -> als Stream behandeln
    return [{ title: 'Stream', url: q, source: 'url', duration: 0, live: true, requestedBy }];
  }

  // Radio-Sendername?
  const station = findStation(guildId, q);
  if (station) {
    return [{ title: `📻 ${station.name}`, url: station.url, source: 'radio', duration: 0, live: true, requestedBy }];
  }

  // YouTube-Suche
  if (!ytdlp.available()) throw new Error(noYt + `\nTipp: „${q}" als Radio-Sendername? Verfügbar: ${allStations(guildId).slice(0, 6).map((s) => s.name).join(', ')} …`);
  const v = await ytdlp.info(q);
  return [{ ...v, source: 'youtube', requestedBy }];
}

/**
 * Hauptfunktion: Titel/Sender zur Warteschlange hinzufügen (und ggf. starten).
 * @returns {{ added: number, first: object|null, startedNow: boolean }}
 */
async function play_(guild, voiceChannel, textChannelId, query, requestedBy) {
  const session = getOrCreate(guild);
  await session.connect(voiceChannel, textChannelId);
  const tracks = await resolveTracks(guild.id, query, requestedBy);
  const wasIdle = !session.current;
  const added = session.enqueue(tracks);
  await session.startIfIdle();
  return { added, first: tracks[0] || null, startedNow: wasIdle };
}

async function playStation(guild, voiceChannel, textChannelId, stationQuery, requestedBy) {
  const station = findStation(guild.id, stationQuery);
  if (!station) throw new Error(`Sender „${stationQuery}" nicht gefunden.`);
  return play_(guild, voiceChannel, textChannelId, station.name, requestedBy);
}

module.exports = {
  sessions,
  getSession,
  getOrCreate,
  play: play_,
  playStation,
  resolveTracks,
  allStations,
  findStation,
  fmtDuration,
  BUILTIN_STATIONS,
  youtubeAvailable: () => ytdlp.available(),
};
