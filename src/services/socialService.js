'use strict';

const { EmbedBuilder } = require('discord.js');
const client = require('../core/client');
const config = require('../../config/config');
const social = require('../database/models/social');
const logger = require('../utils/logger');

/**
 * Social-Media-Benachrichtigungen (Twitch live, neue YouTube-Videos).
 * Läuft im 60-Sekunden-Sweep des schedulerService, jede Plattform mit eigenem
 * Intervall. Es werden KEINE Nutzerdaten gespeichert – nur der zuletzt gemeldete
 * Stream/Video pro Abo, damit nichts doppelt gepostet wird.
 */

const INTERVALS = {
  twitch: 60_000, // Twitch-API verträgt das locker
  youtube: 300_000, // RSS – alle 5 Min reicht
  tiktok: 900_000,
};
const lastRun = { twitch: 0, youtube: 0, tiktok: 0 };

const UA = 'Mozilla/5.0 (compatible; NoRiftBot/1.0; +https://noriftbot.de)';
const MAX_FAILS = 8; // danach Abo automatisch pausieren

/* ------------------------------------------------------------------ *
 *  HTTP-Helfer
 * ------------------------------------------------------------------ */

async function httpText(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, ...(opts.headers || {}) },
    signal: AbortSignal.timeout(opts.timeout ?? 9000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} für ${url}`);
  return res.text();
}

async function httpJson(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json', ...(opts.headers || {}) },
    method: opts.method || 'GET',
    body: opts.body,
    signal: AbortSignal.timeout(opts.timeout ?? 9000),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  if (!res.ok) {
    const msg = json?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

/* ------------------------------------------------------------------ *
 *  Twitch
 * ------------------------------------------------------------------ */

let twitchToken = { value: null, expiresAt: 0 };

function twitchConfigured() {
  return Boolean(config.social.twitchClientId && config.social.twitchClientSecret);
}

async function twitchAppToken() {
  if (twitchToken.value && Date.now() < twitchToken.expiresAt - 60_000) return twitchToken.value;
  const params = new URLSearchParams({
    client_id: config.social.twitchClientId,
    client_secret: config.social.twitchClientSecret,
    grant_type: 'client_credentials',
  });
  const json = await httpJson(`https://id.twitch.tv/oauth2/token?${params}`, { method: 'POST' });
  twitchToken = { value: json.access_token, expiresAt: Date.now() + (json.expires_in || 3600) * 1000 };
  return twitchToken.value;
}

async function twitchApi(path, searchParams) {
  const token = await twitchAppToken();
  const qs = new URLSearchParams(searchParams).toString();
  return httpJson(`https://api.twitch.tv/helix/${path}${qs ? '?' + qs : ''}`, {
    headers: { 'Client-Id': config.social.twitchClientId, Authorization: `Bearer ${token}` },
  });
}

/** Prüft, ob es den Twitch-Kanal gibt, und liefert den Anzeigenamen. */
async function twitchResolve(login) {
  if (!twitchConfigured()) return { account: login, label: login };
  const json = await twitchApi('users', { login });
  const u = json.data?.[0];
  if (!u) throw new Error(`Twitch-Kanal „${login}" wurde nicht gefunden.`);
  return { account: u.login, label: u.display_name || u.login };
}

async function pollTwitch() {
  if (!twitchConfigured()) return;
  const subs = social.listActiveByPlatform('twitch');
  if (!subs.length) return;

  // eindeutige Logins, in 100er-Blöcken abfragen
  const logins = [...new Set(subs.map((s) => s.account))];
  const liveByLogin = new Map();
  for (let i = 0; i < logins.length; i += 100) {
    const batch = logins.slice(i, i + 100);
    const json = await twitchApi('streams', batch.map((l) => ['user_login', l])).catch((err) => {
      logger.warn('[social] Twitch streams:', err.message);
      return null;
    });
    if (!json) continue;
    for (const stream of json.data || []) liveByLogin.set(stream.user_login.toLowerCase(), stream);
  }

  for (const sub of subs) {
    const stream = liveByLogin.get(sub.account.toLowerCase());
    const now = Date.now();
    try {
      if (stream) {
        const newStream = String(stream.id) !== String(sub.last_item_id || '');
        if (!sub.is_live || newStream) {
          await announce(sub, {
            kind: 'twitch',
            title: stream.title || `${sub.account_label} ist LIVE`,
            url: `https://twitch.tv/${sub.account}`,
            name: sub.account_label || sub.account,
            extra: stream.game_name ? `Spielt: ${stream.game_name}` : null,
            image: stream.thumbnail_url
              ? stream.thumbnail_url.replace('{width}', '1280').replace('{height}', '720') + `?t=${now}`
              : null,
          });
          social.setState(sub.id, { isLive: true, lastItemId: stream.id, lastAnnouncedAt: now, lastCheckedAt: now, failCount: 0 });
        } else {
          social.setState(sub.id, { lastCheckedAt: now, failCount: 0 });
        }
      } else if (sub.is_live) {
        social.setState(sub.id, { isLive: false, lastCheckedAt: now, failCount: 0 });
      } else {
        social.setState(sub.id, { lastCheckedAt: now });
      }
    } catch (err) {
      logger.warn(`[social] Twitch #${sub.id}:`, err.message);
    }
  }
}

/* ------------------------------------------------------------------ *
 *  YouTube (RSS – kein API-Key nötig)
 * ------------------------------------------------------------------ */

const YT_CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/;

/** Nimmt Channel-ID, /channel/UC…-Link, @handle oder /c/-Link und liefert die UC-Channel-ID. */
async function youtubeResolve(input) {
  const raw = String(input || '').trim();
  if (YT_CHANNEL_ID_RE.test(raw)) {
    const label = await youtubeChannelTitle(raw).catch(() => raw);
    return { account: raw, label };
  }

  let url = raw;
  const chanMatch = raw.match(/youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})/);
  if (chanMatch) {
    const label = await youtubeChannelTitle(chanMatch[1]).catch(() => chanMatch[1]);
    return { account: chanMatch[1], label };
  }
  if (/^@[\w.-]+$/.test(raw)) url = `https://www.youtube.com/${raw}`;
  else if (!/^https?:\/\//.test(raw)) url = `https://www.youtube.com/@${raw}`;

  const html = await httpText(url).catch(() => {
    throw new Error('YouTube-Kanal konnte nicht aufgelöst werden. Nutze am besten die Kanal-ID (UC…).');
  });
  // Reihenfolge wichtig: canonical/og:url/externalId sind der KANAL SELBST,
  // ein blankes "channelId" kann ein empfohlener Fremd-Kanal sein.
  const idMatch =
    html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})">/) ||
    html.match(/<meta property="og:url" content="https:\/\/www\.youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})">/) ||
    html.match(/"externalId":"(UC[A-Za-z0-9_-]{22})"/) ||
    html.match(/"channelId":"(UC[A-Za-z0-9_-]{22})"/);
  if (!idMatch) throw new Error('YouTube-Kanal-ID nicht gefunden. Nutze die Kanal-ID (UC…).');
  const titleMatch = html.match(/<meta property="og:title" content="([^"]+)"/) || html.match(/<title>([^<]+)<\/title>/);
  const label = titleMatch ? decodeEntities(titleMatch[1]).replace(/ - YouTube$/, '') : idMatch[1];
  return { account: idMatch[1], label };
}

async function youtubeChannelTitle(channelId) {
  const xml = await httpText(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
  const m = xml.match(/<title>([^<]+)<\/title>/);
  return m ? decodeEntities(m[1]) : channelId;
}

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function parseLatestYouTube(xml) {
  const entry = xml.match(/<entry>([\s\S]*?)<\/entry>/);
  if (!entry) return null;
  const block = entry[1];
  const id = block.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1];
  const title = block.match(/<title>([^<]+)<\/title>/)?.[1];
  const published = block.match(/<published>([^<]+)<\/published>/)?.[1];
  const author = block.match(/<author>\s*<name>([^<]+)<\/name>/)?.[1];
  if (!id) return null;
  return {
    id,
    title: title ? decodeEntities(title) : 'Neues Video',
    url: `https://www.youtube.com/watch?v=${id}`,
    author: author ? decodeEntities(author) : null,
    publishedAt: published ? Date.parse(published) : null,
    thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  };
}

async function pollYouTube() {
  const subs = social.listActiveByPlatform('youtube');
  for (const sub of subs) {
    const now = Date.now();
    try {
      const xml = await httpText(`https://www.youtube.com/feeds/videos.xml?channel_id=${sub.account}`);
      const latest = parseLatestYouTube(xml);
      if (!latest) { social.setState(sub.id, { lastCheckedAt: now, failCount: 0 }); continue; }

      if (String(latest.id) === String(sub.last_item_id || '')) {
        social.setState(sub.id, { lastCheckedAt: now, failCount: 0 });
        continue;
      }

      const firstRun = !sub.last_item_id;
      const fresh = latest.publishedAt ? now - latest.publishedAt < 48 * 3600_000 : true;
      if (!firstRun && fresh) {
        await announce(sub, {
          kind: 'youtube',
          title: latest.title,
          url: latest.url,
          name: sub.account_label || latest.author || 'YouTube',
          extra: null,
          image: latest.thumbnail,
        });
        social.setState(sub.id, { lastItemId: latest.id, lastAnnouncedAt: now, lastCheckedAt: now, failCount: 0 });
      } else {
        // Erstlauf oder altes Video -> nur merken, nicht posten
        social.setState(sub.id, { lastItemId: latest.id, lastCheckedAt: now, failCount: 0 });
      }
    } catch (err) {
      const fails = (sub.fail_count || 0) + 1;
      social.setState(sub.id, { lastCheckedAt: now, failCount: fails });
      if (fails === 1 || fails % 4 === 0) logger.warn(`[social] YouTube #${sub.id} (${sub.account}):`, err.message);
      if (fails >= MAX_FAILS) {
        social.update(sub.id, { enabled: 0 });
        logger.warn(`[social] YouTube-Abo #${sub.id} nach ${fails} Fehlern pausiert.`);
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 *  Ausgabe
 * ------------------------------------------------------------------ */

const PLATFORM_META = {
  twitch: { color: 0x9146ff, tag: 'Twitch', verb: 'ist jetzt LIVE auf Twitch' },
  youtube: { color: 0xff0000, tag: 'YouTube', verb: 'hat ein neues Video hochgeladen' },
  tiktok: { color: 0x000000, tag: 'TikTok', verb: 'hat ein neues TikTok gepostet' },
};

function renderTemplate(tpl, sub, data, mentionText) {
  return String(tpl)
    .replaceAll('{name}', data.name || sub.account_label || sub.account)
    .replaceAll('{url}', data.url)
    .replaceAll('{title}', data.title || '')
    .replaceAll('{mention}', mentionText || '')
    .trim();
}

async function announce(sub, data) {
  const channel =
    client.channels.cache.get(sub.channel_id) ??
    (await client.channels.fetch(sub.channel_id).catch(() => null));
  if (!channel || !channel.isTextBased?.()) {
    logger.warn(`[social] Abo #${sub.id}: Kanal ${sub.channel_id} nicht gefunden/kein Textkanal.`);
    return;
  }

  const meta = PLATFORM_META[sub.platform];
  let mentionText = '';
  if (sub.mention === '@everyone' || sub.mention === '@here') mentionText = sub.mention;
  else if (sub.mention) mentionText = sub.mention; // <@&ID>

  const defaultMsg = `${mentionText ? mentionText + ' ' : ''}**${data.name}** ${meta.verb}!`;
  const content = (sub.message ? renderTemplate(sub.message, sub, data, mentionText) : defaultMsg).slice(0, 1900)
    + (sub.embed ? '' : `\n${data.url}`);

  const payload = {
    content: content || data.url,
    allowedMentions: {
      parse: sub.mention === '@everyone' || sub.mention === '@here' ? ['everyone'] : [],
      roles: sub.mention && sub.mention.startsWith('<@&') ? [sub.mention.replace(/\D/g, '')] : [],
    },
  };

  if (sub.embed) {
    const embed = new EmbedBuilder()
      .setColor(meta.color)
      .setAuthor({ name: `${data.name} • ${meta.tag}` })
      .setTitle((data.title || meta.verb).slice(0, 256))
      .setURL(data.url)
      .setTimestamp();
    if (data.extra) embed.setDescription(data.extra);
    if (data.image) embed.setImage(data.image);
    payload.embeds = [embed];
  }

  await channel.send(payload).catch((err) => logger.warn(`[social] senden Abo #${sub.id}:`, err.message));
}

/* ------------------------------------------------------------------ *
 *  Öffentliche API
 * ------------------------------------------------------------------ */

/** Von den Dashboard-Routen: Eingabe validieren + Anzeigenamen auflösen. */
async function resolveAccount(platform, input) {
  const value = String(input || '').trim();
  if (!value) throw new Error('Bitte einen Account / Link angeben.');
  if (platform === 'twitch') {
    const login = value.replace(/^https?:\/\/(www\.)?twitch\.tv\//i, '').replace(/[/?].*$/, '').toLowerCase();
    if (!/^[a-z0-9_]{2,30}$/.test(login)) throw new Error('Ungültiger Twitch-Name.');
    return twitchResolve(login);
  }
  if (platform === 'youtube') return youtubeResolve(value);
  if (platform === 'tiktok') {
    const name = value.replace(/^https?:\/\/(www\.)?tiktok\.com\//i, '').replace(/^@/, '').replace(/[/?].*$/, '').toLowerCase();
    if (!/^[a-z0-9._]{2,30}$/.test(name)) throw new Error('Ungültiger TikTok-Name.');
    return { account: name, label: '@' + name };
  }
  throw new Error('Unbekannte Plattform.');
}

/** Sofort-Test einer Meldung (Dashboard „Testen"-Button). */
async function sendTest(sub) {
  const meta = PLATFORM_META[sub.platform];
  await announce(sub, {
    kind: sub.platform,
    title: `Test – ${sub.account_label || sub.account}`,
    url:
      sub.platform === 'twitch'
        ? `https://twitch.tv/${sub.account}`
        : sub.platform === 'youtube'
          ? `https://www.youtube.com/channel/${sub.account}`
          : `https://www.tiktok.com/@${sub.account}`,
    name: sub.account_label || sub.account,
    extra: `Dies ist eine Testmeldung für ${meta.tag}.`,
    image: null,
  });
}

async function sweep() {
  const now = Date.now();
  if (now - lastRun.twitch >= INTERVALS.twitch) {
    lastRun.twitch = now;
    await pollTwitch().catch((err) => logger.error('[social] pollTwitch:', err.message));
  }
  if (now - lastRun.youtube >= INTERVALS.youtube) {
    lastRun.youtube = now;
    await pollYouTube().catch((err) => logger.error('[social] pollYouTube:', err.message));
  }
}

module.exports = { sweep, resolveAccount, sendTest, twitchConfigured };
