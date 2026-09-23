'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const ytdlp = require('./ytdlp');
const spotify = require('./spotify');
const logger = require('../utils/logger');
const embeds = require('../utils/embeds');
const settingsModel = require('../database/models/settings');
const stationsModel = require('../database/models/musicStations');
const playlistsModel = require('../database/models/musicPlaylists');

let BUILTIN_STATIONS = [];
try {
  BUILTIN_STATIONS = require('./radioStations');
} catch {
  try {
    BUILTIN_STATIONS = require('../data/radioStations');
  } catch {
    /* Datei fehlt -> nur eigene Sender/URLs */
  }
}

/**
 * Musik-Service: eine Session pro Server (im Speicher).
 * Quellen: YouTube (Suche/Link, via yt-dlp), Spotify-Links (Titelliste von Spotify,
 * Ton von YouTube) und Radio/direkte Stream-URLs (via FFmpeg).
 *
 * Die Voice-Pakete (@discordjs/voice, ffmpeg-static, prism-media) werden
 * defensiv geladen: fehlen sie oder ist Node zu alt (<22), bleibt der Rest
 * des Bots + Dashboards funktionsfähig – nur die Musik meldet einen Hinweis.
 */

let voice = null;
let prism = null;
let MUSIC_ERROR = null;

try {
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor < 22) {
    throw new Error(`Node ${process.versions.node} ist zu alt – Musik braucht Node 22+.`);
  }
  const ffmpegPath = require('ffmpeg-static');
  if (ffmpegPath) process.env.FFMPEG_PATH = ffmpegPath;
  voice = require('@discordjs/voice');
  prism = require('prism-media');
} catch (err) {
  MUSIC_ERROR = err.message;
  logger.warn(`[music] Musik deaktiviert: ${err.message}`);
}

const musicEnabled = () => Boolean(voice && prism);
function assertMusic() {
  if (!musicEnabled()) {
    throw new Error(`Musik ist auf diesem Server nicht verfügbar: ${MUSIC_ERROR || 'Voice-Pakete fehlen.'}`);
  }
}

/** Vom Server-Admin im Dashboard abschaltbar (guild_settings.music_enabled). */
function assertMusicAllowed(guildId) {
  if (settingsModel.get(guildId).music_enabled === 0) {
    throw new Error('Das Musik-Modul ist auf diesem Server deaktiviert.');
  }
}

const IDLE_DISCONNECT_MS = 3 * 60 * 1000;
const MAX_QUEUE = 200;
const MAX_PLAYLISTS = 25;

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
    this.player = voice.createAudioPlayer({ behaviors: { noSubscriber: voice.NoSubscriberBehavior.Pause } });
    this.resource = null;
    this.idleTimer = null;
    this.panelMessageId = null;
    this.destroyed = false;

    // player.stop() innerhalb von destroy() löst 'Idle' erst einen Tick später aus - die
    // destroyed-Sperre verhindert, dass das dann noch die Warteschlange weiterschaltet
    // oder das Panel überschreibt (z. B. nachdem der Bot gekickt/verschoben wurde).
    this.player.on(voice.AudioPlayerStatus.Idle, () => {
      if (!this.destroyed) this._onIdle();
    });
    this.player.on('error', (err) => {
      if (this.destroyed) return;
      logger.warn(`[music] Player-Fehler (${this.guildId}): ${err.message}`);
      this._announce(`⚠️ Fehler bei **${this.current?.title || 'Titel'}** – überspringe.`);
      this._next();
    });
  }

  async connect(voiceChannel, textChannelId) {
    this.textChannelId = textChannelId || this.textChannelId;
    if (this.connection && this.voiceChannelId === voiceChannel.id) return;
    this.voiceChannelId = voiceChannel.id;
    this.connection = voice.joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: this.guildId,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: true,
    });
    this.connection.on(voice.VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          voice.entersState(this.connection, voice.VoiceConnectionStatus.Signalling, 5000),
          voice.entersState(this.connection, voice.VoiceConnectionStatus.Connecting, 5000),
        ]);
      } catch {
        this.destroy('⚠️ Verbindung zum Sprachkanal verloren.');
      }
    });
    this.connection.subscribe(this.player);
    await voice.entersState(this.connection, voice.VoiceConnectionStatus.Ready, 20000).catch(() => {
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
      this.destroy('👋 Nichts mehr in der Warteschlange – ich verlasse den Sprachkanal.');
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
      this._updatePanelIdle('⏸️ Warteschlange ist leer.').catch(() => null);
      return;
    }
    this._clearIdle();
    try {
      this.resource = await this._createResource(this.current);
      this.resource.volume?.setVolume(this.volume);
      this.player.play(this.resource);
      this._tuneEncoder();
      this._resolveTrack(this.queue[0])?.catch(() => null); // nächsten Spotify-Titel vorab suchen -> keine Pause dazwischen
      this._sendOrUpdatePanel().catch((err) => logger.warn(`[music] Panel-Fehler: ${err.message}`));
    } catch (err) {
      logger.warn(`[music] Resource-Fehler: ${err.message}`);
      this._announce(`⚠️ **${this.current.title}** konnte nicht abgespielt werden – überspringe.`);
      return this._next();
    }
  }

  // Lautheits-Normalisierung: leise/laute Tracks werden angeglichen (der hörbar größte Gewinn).
  static AUDIO_FILTER = 'dynaudnorm=f=250:g=15:p=0.9:m=12';

  /** Spotify-Titel -> passendes YouTube-Video suchen (einmalig, Ergebnis bleibt am Track). */
  _resolveTrack(track) {
    if (!track || track.source !== 'spotify' || track.streamUrl) return null;
    track.resolving ||= ytdlp
      .searchBest(track.search, track.duration)
      .then((v) => {
        track.streamUrl = v.url;
        track.thumbnail = track.thumbnail || v.thumbnail || null;
      })
      .finally(() => {
        track.resolving = null;
      });
    return track.resolving;
  }

  async _createResource(track) {
    if (track.source === 'spotify') await this._resolveTrack(track);
    if (track.source === 'youtube' || track.source === 'spotify') {
      const src = ytdlp.stream(track.streamUrl || track.url);
      const ff = new prism.FFmpeg({
        args: [
          '-thread_queue_size', '4096',
          '-i', '-',
          '-vn',
          '-loglevel', 'error',
          '-af', Session.AUDIO_FILTER,
          '-acodec', 'pcm_s16le',
          '-f', 's16le',
          '-ar', '48000',
          '-ac', '2',
        ],
      });
      src.on('error', () => ff.destroy());
      src.pipe(ff);
      return voice.createAudioResource(ff, { inputType: voice.StreamType.Raw, inlineVolume: true });
    }
    // Radio / direkte URL -> FFmpeg mit Reconnect
    const transcoder = new prism.FFmpeg({
      args: [
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '5',
        '-thread_queue_size', '4096',
        '-i', track.url,
        '-vn',
        '-loglevel', 'error',
        '-af', Session.AUDIO_FILTER,
        '-acodec', 'pcm_s16le',
        '-f', 's16le',
        '-ar', '48000',
        '-ac', '2',
      ],
    });
    return voice.createAudioResource(transcoder, { inputType: voice.StreamType.Raw, inlineVolume: true });
  }

  /** Opus-Encoder auf die Bitrate des Sprachkanals heben + Fehlerkorrektur gegen Paketverlust. */
  _tuneEncoder() {
    const enc = this.resource?.encoder;
    if (!enc) return;
    try {
      const vc = this.guild.channels.cache.get(this.voiceChannelId);
      const bitrate = Math.min(Math.max(Number(vc?.bitrate) || 96000, 64000), 256000);
      enc.setBitrate(bitrate);
      enc.setFEC?.(true);
      enc.setPLP?.(0.02);
    } catch (err) {
      logger.warn(`[music] Encoder-Tuning: ${err.message}`);
    }
  }

  _announce(text) {
    const ch = this.guild.channels.cache.get(this.textChannelId);
    ch?.send({ content: text, allowedMentions: { parse: [] } }).catch(() => null);
  }

  /** Embed für das Steuer-Panel ("Läuft gerade" + Buttons), das im Textkanal gepostet/aktualisiert wird. */
  _panelEmbed() {
    const c = this.current;
    const link = c.url && /^https?:/.test(c.url) ? ` — [öffnen](${c.url})` : '';
    const e = embeds.brand(c.live ? '🔴 Live' : '🎵 Läuft gerade', `**${c.title}**${link}`);
    if (c.thumbnail) e.setThumbnail(c.thumbnail);
    e.addFields(
      { name: 'Länge', value: c.live ? 'LIVE' : fmtDuration(c.duration), inline: true },
      { name: 'Lautstärke', value: `${Math.round(this.volume * 100)} %`, inline: true },
      { name: 'Loop', value: this.loop ? 'an 🔁' : 'aus', inline: true },
    );
    const footer = [
      c.requestedBy ? `Angefragt von ${c.requestedBy.tag}` : null,
      this.queue.length ? `${this.queue.length} weitere in der Warteschlange` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    if (footer) e.setFooter({ text: footer });
    return e;
  }

  _panelRows() {
    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('music:panel:pause').setEmoji(this.paused ? '▶️' : '⏸️').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('music:panel:skip').setEmoji('⏭️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('music:panel:loop').setEmoji('🔁').setStyle(this.loop ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('music:panel:shuffle').setEmoji('🔀').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('music:panel:stop').setEmoji('⏹️').setStyle(ButtonStyle.Danger),
    );
    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('music:panel:voldown').setEmoji('🔉').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('music:panel:volup').setEmoji('🔊').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('music:panel:queue').setEmoji('📜').setStyle(ButtonStyle.Secondary),
    );
    return [row1, row2];
  }

  /** @returns {{embeds: object[], components: object[]}} */
  panelPayload() {
    return { embeds: [this._panelEmbed()], components: this._panelRows() };
  }

  async _sendOrUpdatePanel() {
    const ch = this.guild.channels.cache.get(this.textChannelId);
    if (!ch) return;
    const payload = this.panelPayload();
    if (this.panelMessageId) {
      try {
        const msg = await ch.messages.fetch(this.panelMessageId);
        await msg.edit(payload);
        return;
      } catch {
        this.panelMessageId = null; // Nachricht wurde wohl gelöscht -> neu senden
      }
    }
    const msg = await ch.send(payload);
    this.panelMessageId = msg.id;
  }

  /** Panel auf einen reinen Text-Zustand setzen (Warteschlange leer / Bot verlässt den Kanal) und Buttons entfernen. */
  async _updatePanelIdle(text) {
    const ch = this.guild.channels.cache.get(this.textChannelId);
    if (this.panelMessageId && ch) {
      try {
        const msg = await ch.messages.fetch(this.panelMessageId);
        await msg.edit({ embeds: [embeds.brand('🎵 Musik', text)], components: [] });
        this.panelMessageId = null;
        return;
      } catch {
        this.panelMessageId = null;
      }
    }
    this._announce(text);
  }

  /** Nach einer Steuer-Aktion (Pause/Lautstärke/Loop/…) das bestehende Panel neu zeichnen. */
  refreshPanel() {
    if (this.current) this._sendOrUpdatePanel().catch((err) => logger.warn(`[music] Panel-Fehler: ${err.message}`));
  }

  enqueue(tracks) {
    const room = MAX_QUEUE - this.queue.length;
    const added = tracks.slice(0, Math.max(0, room));
    this.queue.push(...added);
    this.refreshPanel();
    return added.length;
  }

  async startIfIdle() {
    if (!this.current && this.player.state.status !== voice.AudioPlayerStatus.Playing) {
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
    this.refreshPanel();
    return this.paused;
  }

  resume() {
    const ok = this.player.unpause();
    if (ok) this.paused = false;
    this.refreshPanel();
    return ok;
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1.5, vol));
    this.resource?.volume?.setVolume(this.volume);
    this.refreshPanel();
    return this.volume;
  }

  toggleLoop() {
    this.loop = !this.loop;
    this.refreshPanel();
    return this.loop;
  }

  shuffle() {
    for (let i = this.queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
    }
    this.refreshPanel();
  }

  removeAt(index) {
    if (index < 0 || index >= this.queue.length) return null;
    const removed = this.queue.splice(index, 1)[0];
    this.refreshPanel();
    return removed;
  }

  /** @param {string} [reason] Text fürs Panel/den Kanal beim Beenden (z. B. "Gestoppt."). */
  destroy(reason) {
    if (this.destroyed) return;
    this.destroyed = true;
    this._clearIdle();
    if (reason) this._updatePanelIdle(reason).catch(() => null);
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
  assertMusic();
  let s = sessions.get(guild.id);
  if (!s) {
    s = new Session(guild);
    sessions.set(guild.id, s);
  }
  return s;
}

/**
 * Query auflösen -> Liste von Tracks (+ optional Name der Playlist/des Albums).
 * @returns {Promise<{ tracks: object[], label: string|null }>}
 */
async function resolveTracks(guildId, query, requestedBy) {
  const q = String(query || '').trim();
  if (!q) throw new Error('Bitte einen Suchbegriff oder Link angeben.');
  const noYt = 'YouTube ist auf diesem Server nicht verfügbar (yt-dlp fehlt). Radio-Sender und direkte Stream-URLs funktionieren.';

  // Spotify: Titelliste von Spotify holen, Ton kommt später pro Titel von YouTube
  const sp = spotify.parse(q);
  if (sp) {
    if (!ytdlp.available()) {
      throw new Error('Spotify-Links werden über YouTube abgespielt – dafür fehlt auf diesem Server yt-dlp.');
    }
    const list = await spotify.fetchTracks(sp);
    const tracks = list.tracks.map((t) => ({
      title: t.artist ? `${t.title} – ${t.artist}` : t.title,
      url: t.url,
      source: 'spotify',
      search: `${t.artist} ${t.title}`.trim(),
      duration: t.duration,
      live: false,
      requestedBy,
    }));
    return { tracks, label: sp.type === 'track' ? null : list.name };
  }

  if (/^https?:\/\//i.test(q)) {
    const isYouTube = /(?:youtube\.com|youtu\.be|music\.youtube\.com)/i.test(q);
    if (isYouTube) {
      if (!ytdlp.available()) throw new Error(noYt);
      const isPlaylist = /[?&]list=/.test(q) && !/[?&]v=/.test(q);
      if (isPlaylist) {
        const items = await ytdlp.playlist(q);
        if (!items.length) throw new Error('Playlist ist leer oder nicht abrufbar.');
        return { tracks: items.map((t) => ({ ...t, source: 'youtube', requestedBy })), label: null };
      }
      const v = await ytdlp.info(q);
      return { tracks: [{ ...v, source: 'youtube', requestedBy }], label: null };
    }
    // Nicht-YouTube-URL -> als Stream behandeln
    return { tracks: [{ title: 'Stream', url: q, source: 'url', duration: 0, live: true, requestedBy }], label: null };
  }

  // Radio-Sendername?
  const station = findStation(guildId, q);
  if (station) {
    return {
      tracks: [{ title: `📻 ${station.name}`, url: station.url, source: 'radio', duration: 0, live: true, requestedBy }],
      label: null,
    };
  }

  // YouTube-Suche
  if (!ytdlp.available()) throw new Error(noYt + `\nTipp: „${q}" als Radio-Sendername? Verfügbar: ${allStations(guildId).slice(0, 6).map((s) => s.name).join(', ')} …`);
  const v = await ytdlp.info(q);
  return { tracks: [{ ...v, source: 'youtube', requestedBy }], label: null };
}

/**
 * Hauptfunktion: Titel/Sender zur Warteschlange hinzufügen (und ggf. starten).
 * @returns {{ added: number, first: object|null, startedNow: boolean, label: string|null }}
 */
async function play_(guild, voiceChannel, textChannelId, query, requestedBy) {
  assertMusicAllowed(guild.id);
  const session = getOrCreate(guild);
  await session.connect(voiceChannel, textChannelId);
  const { tracks, label } = await resolveTracks(guild.id, query, requestedBy);
  const wasIdle = !session.current;
  const added = session.enqueue(tracks);
  await session.startIfIdle();
  return { added, first: tracks[0] || null, startedNow: wasIdle, label };
}

async function playStation(guild, voiceChannel, textChannelId, stationQuery, requestedBy) {
  const station = findStation(guild.id, stationQuery);
  if (!station) throw new Error(`Sender „${stationQuery}" nicht gefunden.`);
  return play_(guild, voiceChannel, textChannelId, station.name, requestedBy);
}

/** Bot in einen Sprachkanal holen, ohne etwas abzuspielen. */
async function join(guild, voiceChannel, textChannelId) {
  assertMusicAllowed(guild.id);
  const session = getOrCreate(guild);
  await session.connect(voiceChannel, textChannelId);
  return session;
}

/* ------------------------- Eigene Playlists (pro Server) ------------------------- */

async function _playPlaylistRow(guild, voiceChannel, textChannelId, pl, requestedBy) {
  const rows = playlistsModel.tracks(pl.id);
  if (!rows.length) throw new Error('Diese Playlist ist leer.');
  const session = getOrCreate(guild);
  await session.connect(voiceChannel, textChannelId);
  const tracks = rows.map((t) => ({
    title: t.title,
    url: t.url,
    source: t.source,
    search: t.search || undefined,
    duration: t.duration,
    live: false,
    requestedBy,
  }));
  const wasIdle = !session.current;
  const added = session.enqueue(tracks);
  await session.startIfIdle();
  return { added, first: tracks[0] || null, startedNow: wasIdle, label: pl.name };
}

/** Playlist per Name abspielen (Slash-Command) – nur die des eigenen Servers werden gefunden. */
async function playPlaylist(guild, voiceChannel, textChannelId, name, requestedBy) {
  assertMusicAllowed(guild.id);
  const pl = playlistsModel.getByName(guild.id, name);
  if (!pl) throw new Error(`Playlist „${name}" wurde auf diesem Server nicht gefunden.`);
  return _playPlaylistRow(guild, voiceChannel, textChannelId, pl, requestedBy);
}

/** Playlist per ID abspielen (Dashboard) – die ID wird zwingend gegen die guildId geprüft. */
async function playPlaylistById(guild, voiceChannel, textChannelId, id, requestedBy) {
  assertMusicAllowed(guild.id);
  const pl = playlistsModel.get(guild.id, id);
  if (!pl) throw new Error('Playlist wurde auf diesem Server nicht gefunden.');
  return _playPlaylistRow(guild, voiceChannel, textChannelId, pl, requestedBy);
}

/**
 * Playlist speichern: entweder aus einem Link/Suchbegriff (query) oder – wenn keiner
 * angegeben ist – aus der aktuell laufenden Warteschlange dieses Servers.
 * Wird IMMER an guild.id gebunden gespeichert -> auf keinem anderen Server nutzbar.
 */
async function savePlaylist(guild, name, query, createdBy) {
  assertMusicAllowed(guild.id);
  const n = String(name || '').trim().slice(0, 80);
  if (!n) throw new Error('Bitte einen Namen für die Playlist angeben.');
  if (playlistsModel.getByName(guild.id, n)) {
    throw new Error(`Es gibt auf diesem Server schon eine Playlist namens „${n}". Lösche sie erst oder wähle einen anderen Namen.`);
  }
  if (playlistsModel.count(guild.id) >= MAX_PLAYLISTS) {
    throw new Error(`Maximal ${MAX_PLAYLISTS} Playlists pro Server.`);
  }

  let items;
  if (query) {
    items = (await resolveTracks(guild.id, query, null)).tracks;
  } else {
    const session = getSession(guild.id);
    items = [...(session?.current ? [session.current] : []), ...(session?.queue || [])];
    if (!items.length) {
      throw new Error('Es läuft gerade nichts und die Warteschlange ist leer. Gib einen Link/Suchbegriff an oder starte erst etwas mit /play.');
    }
  }
  const tracks = items.slice(0, MAX_QUEUE).map((t) => ({
    title: t.title,
    url: t.url || null,
    source: t.source,
    search: t.search || null,
    duration: Math.round(t.duration || 0),
  }));
  const pl = playlistsModel.create({ guildId: guild.id, name: n, createdBy, tracks });
  return { name: pl.name, count: tracks.length };
}

function listPlaylists(guildId) {
  return playlistsModel.list(guildId);
}

/** Titel einer Playlist lesen – gibt null zurück, wenn sie nicht diesem Server gehört. */
function getPlaylistTracks(guildId, id) {
  const pl = playlistsModel.get(guildId, id);
  return pl ? playlistsModel.tracks(pl.id) : null;
}

/** Löscht nur, wenn die Playlist wirklich diesem Server gehört. */
function deletePlaylist(guildId, id) {
  return playlistsModel.remove(guildId, id);
}

module.exports = {
  sessions,
  getSession,
  getOrCreate,
  join,
  play: play_,
  playStation,
  resolveTracks,
  allStations,
  findStation,
  fmtDuration,
  savePlaylist,
  playPlaylist,
  playPlaylistById,
  listPlaylists,
  getPlaylistTracks,
  deletePlaylist,
  BUILTIN_STATIONS,
  youtubeAvailable: () => ytdlp.available(),
  musicEnabled,
  musicError: () => MUSIC_ERROR,
};
