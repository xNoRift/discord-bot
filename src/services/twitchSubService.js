'use strict';

const crypto = require('node:crypto');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const client = require('../core/client');
const config = require('../../config/config');
const twitchSubs = require('../database/models/twitchSubs');
const moduleSettings = require('../database/models/moduleSettings');
const buttonEmojis = require('../utils/buttonEmojis');
const i18n = require('../utils/i18n');
const logger = require('../utils/logger');
const { L, D } = i18n;

/**
 * Twitch-Sub-Rollen.
 * 1. Ein Admin verbindet im Dashboard den Twitch-Kanal des Servers (Scope channel:read:subscriptions).
 * 2. Mitglieder verknüpfen ihr Twitch-Konto über den Button im Discord (Twitch-Login ohne Rechte –
 *    gespeichert wird nur die Twitch-ID/-Name, das Token wird sofort wieder widerrufen).
 * 3. Der Bot gleicht alle 10 Minuten die Abonnenten-Liste ab und vergibt/entfernt die Rollen
 *    für Stufe 1, 2 und 3 (+ optional eine Rolle für "jede Stufe").
 */

const BROADCASTER_SCOPES = ['channel:read:subscriptions'];
const LINK_TOKEN_TTL = 15 * 60_000;
const SYNC_INTERVAL = 10 * 60_000;

function configured() {
  return Boolean(config.social.twitchClientId && config.social.twitchClientSecret);
}

function redirectUri() {
  return `${config.dashboard.url}/twitch/callback`;
}

/* ------------------------------------------------------------------ *
 *  Twitch-OAuth / API
 * ------------------------------------------------------------------ */

async function twitchFetch(url, opts = {}) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(10_000) });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  if (!res.ok) {
    const err = new Error(json?.message || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

function authorizeUrl(state, scopes = []) {
  const params = new URLSearchParams({
    client_id: config.social.twitchClientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: scopes.join(' '),
    state,
    force_verify: 'true',
  });
  return `https://id.twitch.tv/oauth2/authorize?${params}`;
}

function exchangeCode(code) {
  const body = new URLSearchParams({
    client_id: config.social.twitchClientId,
    client_secret: config.social.twitchClientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri(),
  });
  return twitchFetch('https://id.twitch.tv/oauth2/token', { method: 'POST', body });
}

async function fetchSelf(accessToken) {
  const json = await twitchFetch('https://api.twitch.tv/helix/users', {
    headers: { 'Client-Id': config.social.twitchClientId, Authorization: `Bearer ${accessToken}` },
  });
  const u = json?.data?.[0];
  if (!u) throw new Error('Twitch-Konto konnte nicht gelesen werden.');
  return { id: u.id, login: u.login, name: u.display_name || u.login };
}

async function revokeToken(token) {
  if (!token) return;
  const body = new URLSearchParams({ client_id: config.social.twitchClientId, token });
  await fetch('https://id.twitch.tv/oauth2/revoke', { method: 'POST', body, signal: AbortSignal.timeout(8000) }).catch(() => null);
}

async function refreshBroadcaster(b) {
  if (!b.refresh_token) throw new Error('Verbindung abgelaufen – bitte den Twitch-Kanal im Dashboard neu verbinden.');
  const body = new URLSearchParams({
    client_id: config.social.twitchClientId,
    client_secret: config.social.twitchClientSecret,
    grant_type: 'refresh_token',
    refresh_token: b.refresh_token,
  });
  let json;
  try {
    json = await twitchFetch('https://id.twitch.tv/oauth2/token', { method: 'POST', body });
  } catch (err) {
    if (err.status === 400 || err.status === 401) throw new Error('Verbindung abgelaufen – bitte den Twitch-Kanal im Dashboard neu verbinden.');
    throw err;
  }
  twitchSubs.updateTokens(b.guild_id, json.access_token, json.refresh_token, json.expires_in);
  b.access_token = json.access_token;
  b.refresh_token = json.refresh_token;
  b.expires_at = Date.now() + (json.expires_in || 3600) * 1000;
}

/** Helix-Aufruf mit dem Token des Streamers; erneuert das Token bei Bedarf automatisch. */
async function broadcasterApi(b, path, params) {
  if (!b.access_token || (b.expires_at && Date.now() > b.expires_at - 60_000)) await refreshBroadcaster(b);
  const call = () => twitchFetch(`https://api.twitch.tv/helix/${path}?${new URLSearchParams(params)}`, {
    headers: { 'Client-Id': config.social.twitchClientId, Authorization: `Bearer ${b.access_token}` },
  });
  try {
    return await call();
  } catch (err) {
    if (err.status !== 401) throw err;
    await refreshBroadcaster(b);
    return call();
  }
}

const tierOf = (raw) => ({ 1000: 1, 2000: 2, 3000: 3 })[String(raw)] || 1;

/** Alle Abonnenten des Kanals: Map twitchUserId -> Stufe (1–3). */
async function fetchAllSubs(b) {
  const subs = new Map();
  let cursor = null;
  for (let page = 0; page < 500; page++) {
    const params = [['broadcaster_id', b.twitch_user_id], ['first', '100']];
    if (cursor) params.push(['after', cursor]);
    const json = await broadcasterApi(b, 'subscriptions', params);
    for (const s of json?.data || []) subs.set(s.user_id, Math.max(subs.get(s.user_id) || 0, tierOf(s.tier)));
    cursor = json?.pagination?.cursor;
    if (!cursor || !json?.data?.length) break;
  }
  return subs;
}

/** Sub-Stufe eines einzelnen Twitch-Nutzers (0 = kein Sub). */
async function fetchUserTier(b, twitchUserId) {
  const json = await broadcasterApi(b, 'subscriptions', [['broadcaster_id', b.twitch_user_id], ['user_id', twitchUserId]]);
  const s = json?.data?.[0];
  return s ? tierOf(s.tier) : 0;
}

/* ------------------------------------------------------------------ *
 *  Signierter Verknüpfungs-Link (aus dem Discord-Button)
 * ------------------------------------------------------------------ */

function sign(data) {
  return crypto.createHmac('sha256', config.dashboard.sessionSecret).update(`twitch-link:${data}`).digest('base64url');
}

function makeLinkToken(userId, guildId) {
  const data = Buffer.from(JSON.stringify({ u: userId, g: guildId, e: Date.now() + LINK_TOKEN_TTL })).toString('base64url');
  return `${data}.${sign(data)}`;
}

function verifyLinkToken(token) {
  const [data, sig] = String(token || '').split('.');
  if (!data || !sig) return null;
  const expected = sign(data);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const p = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (!p.u || !p.e || Date.now() > p.e) return null;
    return { userId: String(p.u), guildId: p.g ? String(p.g) : null };
  } catch {
    return null;
  }
}

function linkUrl(userId, guildId) {
  return `${config.dashboard.url}/twitch/link?t=${makeLinkToken(userId, guildId)}`;
}

/* ------------------------------------------------------------------ *
 *  Rollen
 * ------------------------------------------------------------------ */

function tierRoles(cfg) {
  return { 1: cfg.tier1RoleId, 2: cfg.tier2RoleId, 3: cfg.tier3RoleId };
}

/** Alle Rollen, die der Bot für dieses Modul verwaltet. */
function managedRoleIds(guild, cfg) {
  return [...new Set([cfg.tier1RoleId, cfg.tier2RoleId, cfg.tier3RoleId, cfg.anyRoleId].filter((id) => id && guild.roles.cache.has(id)))];
}

/** Welche Rollen soll ein Mitglied mit dieser Stufe haben? */
function desiredRoleIds(guild, cfg, tier) {
  const out = new Set();
  if (!tier) return out;
  const roles = tierRoles(cfg);
  if (cfg.stackRoles) {
    for (let t = 1; t <= tier; t++) if (roles[t]) out.add(roles[t]);
  } else {
    // Höchste eingestellte Rolle bis zur eigenen Stufe (z. B. nur T1-Rolle gesetzt -> T3-Subs bekommen die auch)
    for (let t = tier; t >= 1; t--) if (roles[t]) { out.add(roles[t]); break; }
  }
  if (cfg.anyRoleId) out.add(cfg.anyRoleId);
  return new Set([...out].filter((id) => guild.roles.cache.has(id)));
}

async function applyRoles(member, cfg, tier) {
  const guild = member.guild;
  const managed = managedRoleIds(guild, cfg);
  const want = desiredRoleIds(guild, cfg, tier);
  const add = [...want].filter((id) => !member.roles.cache.has(id));
  const remove = managed.filter((id) => !want.has(id) && member.roles.cache.has(id));
  const reason = 'Twitch-Sub-Rollen';
  let failed = 0;
  for (const id of add) await member.roles.add(id, reason).catch(() => { failed++; });
  for (const id of remove) await member.roles.remove(id, reason).catch(() => { failed++; });
  return { added: add.length, removed: remove.length, failed };
}

/* ------------------------------------------------------------------ *
 *  Abgleich
 * ------------------------------------------------------------------ */

/** Kompletter Abgleich eines Servers (alle verknüpften Mitglieder + alle Rollen-Inhaber). */
async function syncGuild(guildId) {
  const guild = client.guilds.cache.get(guildId);
  const b = twitchSubs.getBroadcaster(guildId);
  if (!guild || !b || !configured()) return null;
  const cfg = moduleSettings.get(guildId, 'twitchsubs');
  if (!cfg.enabled) return null;

  return i18n.runFor(guildId, async () => {
    let subs;
    try {
      subs = await fetchAllSubs(b);
    } catch (err) {
      // Bei API-Fehlern NICHTS entfernen – sonst verliert jeder seine Rolle
      twitchSubs.setSyncResult(guildId, { error: err.message });
      throw err;
    }
    if (config.discord.intentGuildMembers) await guild.members.fetch().catch(() => null);

    const byDiscord = new Map(twitchSubs.listLinks().map((l) => [l.discord_user_id, l]));
    const managed = managedRoleIds(guild, cfg);
    const stats = { members: 0, added: 0, removed: 0, failed: 0 };

    // Verknüpfte Mitglieder + alle, die gerade eine der Rollen haben
    const userIds = new Set([...byDiscord.keys()].filter((id) => guild.members.cache.has(id)));
    for (const roleId of managed) for (const id of guild.roles.cache.get(roleId)?.members.keys() || []) userIds.add(id);

    for (const userId of userIds) {
      const member = guild.members.cache.get(userId) || (await guild.members.fetch(userId).catch(() => null));
      if (!member || member.user.bot) continue;
      const link = byDiscord.get(userId);
      const tier = link ? subs.get(link.twitch_user_id) || 0 : 0;
      if (link) twitchSubs.setStatus(guildId, userId, tier);
      const r = await applyRoles(member, cfg, tier);
      stats.members++;
      stats.added += r.added;
      stats.removed += r.removed;
      stats.failed += r.failed;
    }
    twitchSubs.setSyncResult(guildId, { subCount: subs.size });
    if (stats.failed) twitchSubs.setSyncResult(guildId, { error: `${stats.failed} Rollen-Änderung(en) fehlgeschlagen – die Bot-Rolle muss über den Sub-Rollen stehen und „Rollen verwalten" haben.` });
    return { ...stats, subs: subs.size };
  });
}

/** Sofort-Abgleich eines Nutzers auf allen Servern mit aktivem Modul. Liefert [{ guildName, tier }]. */
async function syncUser(userId) {
  const link = twitchSubs.getLink(userId);
  const out = [];
  for (const b of twitchSubs.listBroadcasters()) {
    const guild = client.guilds.cache.get(b.guild_id);
    if (!guild) continue;
    const cfg = moduleSettings.get(guild.id, 'twitchsubs');
    if (!cfg.enabled) continue;
    const member = guild.members.cache.get(userId) || (await guild.members.fetch(userId).catch(() => null));
    if (!member) continue;
    try {
      const tier = link ? await fetchUserTier(b, link.twitch_user_id) : 0;
      twitchSubs.setStatus(guild.id, userId, link ? tier : 0);
      await applyRoles(member, cfg, tier);
      out.push({ guildId: guild.id, guildName: guild.name, tier, channel: b.twitch_name || b.twitch_login });
    } catch (err) {
      logger.warn(`[twitchsubs] Nutzer-Abgleich ${userId} @ ${guild.id}:`, err.message);
      out.push({ guildId: guild.id, guildName: guild.name, tier: null, channel: b.twitch_name || b.twitch_login, error: err.message });
    }
  }
  return out;
}

/** Verknüpfung speichern + sofort abgleichen. Ein vorher verknüpftes anderes Discord-Konto verliert seine Rollen. */
async function linkAccount(discordUserId, twitchUser) {
  const previous = twitchSubs.saveLink({ discordUserId, twitchUserId: twitchUser.id, login: twitchUser.login, name: twitchUser.name });
  if (previous) await syncUser(previous).catch(() => null);
  return syncUser(discordUserId);
}

/** Verknüpfung lösen und die Sub-Rollen überall abnehmen. */
async function unlinkAccount(discordUserId) {
  twitchSubs.deleteLink(discordUserId);
  await syncUser(discordUserId).catch(() => null);
}

/** Streamer-Verbindung eines Servers trennen (Token widerrufen). */
async function disconnectBroadcaster(guildId) {
  const b = twitchSubs.getBroadcaster(guildId);
  if (b) await revokeToken(b.refresh_token || b.access_token);
  twitchSubs.deleteBroadcaster(guildId);
}

/** Neues Mitglied: ist es schon verknüpft, sofort die passende Rolle geben. */
async function onMemberJoin(member) {
  if (member.user.bot || !twitchSubs.getLink(member.id)) return;
  const b = twitchSubs.getBroadcaster(member.guild.id);
  if (!b || !configured() || !moduleSettings.get(member.guild.id, 'twitchsubs').enabled) return;
  await syncUser(member.id);
}

let lastSweep = 0;
let running = false;
async function sweep() {
  if (!configured() || running || Date.now() - lastSweep < SYNC_INTERVAL - 5000) return;
  lastSweep = Date.now();
  running = true;
  try {
    for (const b of twitchSubs.listBroadcasters()) {
      await syncGuild(b.guild_id).catch((err) => logger.warn(`[twitchsubs] Abgleich ${b.guild_id}:`, err.message));
    }
  } finally {
    running = false;
  }
}

/**
 * Erstellt die fehlenden Sub-Rollen (nur für leere/gelöschte Felder) und trägt sie ein.
 * Reihenfolge Stufe 3 → 2 → 1 → alle Subs, damit Stufe 3 in der Rollenliste oben steht.
 */
async function createRoles(guild, { any = false } = {}) {
  if (!guild) throw new Error('Der Bot ist nicht auf diesem Server.');
  const cfg = moduleSettings.get(guild.id, 'twitchsubs');
  const me = guild.members.me ?? (await guild.members.fetchMe());
  if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    throw new Error('Dem Bot fehlt die Berechtigung „Rollen verwalten“.');
  }
  const missing = (id) => !id || !guild.roles.cache.has(id);
  const plan = [
    ['tier3RoleId', L('Twitch Sub · Stufe 3', 'Twitch Sub · Tier 3'), 0x6441a5],
    ['tier2RoleId', L('Twitch Sub · Stufe 2', 'Twitch Sub · Tier 2'), 0x9146ff],
    ['tier1RoleId', L('Twitch Sub · Stufe 1', 'Twitch Sub · Tier 1'), 0xb18cff],
  ];
  if (any) plan.push(['anyRoleId', L('Twitch Sub', 'Twitch Sub'), 0xa970ff]);
  const patch = {};
  const created = [];
  for (const [field, name, color] of plan) {
    if (!missing(cfg[field])) continue;
    const role = await guild.roles.create({ name, colors: { primaryColor: color }, reason: 'Twitch-Sub-Rollen' });
    patch[field] = role.id;
    created.push(role.name);
  }
  if (created.length) moduleSettings.update(guild.id, 'twitchsubs', patch);
  return created;
}

/* ------------------------------------------------------------------ *
 *  Nachricht mit Buttons
 * ------------------------------------------------------------------ */

async function postPanel(guild) {
  const cfg = moduleSettings.get(guild.id, 'twitchsubs');
  const channel = guild.channels.cache.get(cfg.channelId);
  if (!channel || !channel.isTextBased()) throw new Error('Bitte einen Kanal wählen und speichern.');
  const me = guild.members.me ?? (await guild.members.fetchMe());
  const perms = channel.permissionsFor(me);
  if (!perms?.has(PermissionFlagsBits.SendMessages) || !perms?.has(PermissionFlagsBits.EmbedLinks)) {
    throw new Error('Dem Bot fehlt „Nachrichten senden" / „Links einbetten" in diesem Kanal.');
  }
  const e = buttonEmojis.forGuild(guild.id, 'twitchsubs');
  const payload = await i18n.runFor(guild.id, async () => ({
    embeds: [new EmbedBuilder().setColor(0x9146ff).setTitle(D(cfg.title) || 'Twitch').setDescription(D(cfg.message) || '​')],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('twitchsub:link').setLabel(D(cfg.buttonLabel) || L('Twitch verknüpfen', 'Link Twitch')).setEmoji(e('link')).setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('twitchsub:check').setLabel(L('Status prüfen', 'Check status')).setEmoji(e('check')).setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('twitchsub:unlink').setLabel(L('Verknüpfung lösen', 'Unlink')).setEmoji(e('unlink')).setStyle(ButtonStyle.Secondary),
    )],
  }));
  let msg = null;
  if (cfg.messageId) msg = await channel.messages.fetch(cfg.messageId).catch(() => null);
  msg = msg ? await msg.edit(payload) : await channel.send(payload);
  moduleSettings.update(guild.id, 'twitchsubs', { messageId: msg.id });
  return msg;
}

module.exports = {
  BROADCASTER_SCOPES,
  configured,
  redirectUri,
  authorizeUrl,
  exchangeCode,
  fetchSelf,
  revokeToken,
  verifyLinkToken,
  linkUrl,
  syncGuild,
  syncUser,
  linkAccount,
  unlinkAccount,
  disconnectBroadcaster,
  onMemberJoin,
  sweep,
  postPanel,
  createRoles,
};
