'use strict';

const db = require('../db');
const secretBox = require('../../utils/secretBox');

/**
 * Twitch-Sub-Rollen: verbundener Streamer-Kanal pro Server, Konto-Verknüpfungen
 * der Mitglieder (global) und die zuletzt erkannte Sub-Stufe pro Server.
 */

/* ---------------- Streamer-Kanal ---------------- */

function getBroadcaster(guildId) {
  const row = db.prepare('SELECT * FROM twitch_broadcasters WHERE guild_id = ?').get(guildId);
  if (!row) return null;
  return { ...row, access_token: secretBox.decrypt(row.access_token), refresh_token: secretBox.decrypt(row.refresh_token) };
}

function listBroadcasters() {
  return db.prepare('SELECT guild_id FROM twitch_broadcasters').all().map((r) => getBroadcaster(r.guild_id));
}

function saveBroadcaster({ guildId, twitchUserId, login, name, accessToken, refreshToken, expiresInSec, connectedBy }) {
  db.prepare(
    `INSERT INTO twitch_broadcasters (guild_id, twitch_user_id, twitch_login, twitch_name, access_token, refresh_token, expires_at, connected_by, connected_at, last_error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(guild_id) DO UPDATE SET twitch_user_id = excluded.twitch_user_id, twitch_login = excluded.twitch_login,
       twitch_name = excluded.twitch_name, access_token = excluded.access_token, refresh_token = excluded.refresh_token,
       expires_at = excluded.expires_at, connected_by = excluded.connected_by, connected_at = excluded.connected_at, last_error = NULL`,
  ).run(guildId, twitchUserId, login, name, secretBox.encrypt(accessToken), secretBox.encrypt(refreshToken),
    Date.now() + (expiresInSec || 3600) * 1000, connectedBy, Date.now());
}

function updateTokens(guildId, accessToken, refreshToken, expiresInSec) {
  db.prepare('UPDATE twitch_broadcasters SET access_token = ?, refresh_token = ?, expires_at = ? WHERE guild_id = ?')
    .run(secretBox.encrypt(accessToken), secretBox.encrypt(refreshToken), Date.now() + (expiresInSec || 3600) * 1000, guildId);
}

function setSyncResult(guildId, { error = null, subCount = null } = {}) {
  if (error) db.prepare('UPDATE twitch_broadcasters SET last_error = ? WHERE guild_id = ?').run(String(error).slice(0, 300), guildId);
  else db.prepare('UPDATE twitch_broadcasters SET last_error = NULL, last_sync_at = ?, sub_count = ? WHERE guild_id = ?').run(Date.now(), subCount, guildId);
}

function deleteBroadcaster(guildId) {
  db.prepare('DELETE FROM twitch_broadcasters WHERE guild_id = ?').run(guildId);
  db.prepare('DELETE FROM twitch_sub_status WHERE guild_id = ?').run(guildId);
}

/* ---------------- Konto-Verknüpfungen ---------------- */

function getLink(discordUserId) {
  return db.prepare('SELECT * FROM twitch_links WHERE discord_user_id = ?').get(discordUserId) || null;
}

function listLinks() {
  return db.prepare('SELECT * FROM twitch_links').all();
}

/** Speichert die Verknüpfung. Ein Twitch-Konto gehört immer nur zu EINEM Discord-Konto – eine alte Zuordnung wird ersetzt. Liefert die ID des vorherigen Discord-Kontos (falls umgehängt). */
function saveLink({ discordUserId, twitchUserId, login, name }) {
  const previous = db.prepare('SELECT discord_user_id FROM twitch_links WHERE twitch_user_id = ? AND discord_user_id != ?').get(twitchUserId, discordUserId);
  db.transaction(() => {
    db.prepare('DELETE FROM twitch_links WHERE twitch_user_id = ?').run(twitchUserId);
    db.prepare(
      `INSERT INTO twitch_links (discord_user_id, twitch_user_id, twitch_login, twitch_name, linked_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(discord_user_id) DO UPDATE SET twitch_user_id = excluded.twitch_user_id, twitch_login = excluded.twitch_login,
         twitch_name = excluded.twitch_name, linked_at = excluded.linked_at`,
    ).run(discordUserId, twitchUserId, login, name, Date.now());
  })();
  return previous?.discord_user_id || null;
}

function deleteLink(discordUserId) {
  db.prepare('DELETE FROM twitch_links WHERE discord_user_id = ?').run(discordUserId);
}

/* ---------------- Sub-Status ---------------- */

function setStatus(guildId, userId, tier) {
  if (!tier) return db.prepare('DELETE FROM twitch_sub_status WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
  db.prepare(
    `INSERT INTO twitch_sub_status (guild_id, user_id, tier, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(guild_id, user_id) DO UPDATE SET tier = excluded.tier, updated_at = excluded.updated_at`,
  ).run(guildId, userId, tier, Date.now());
}

/** Verknüpfte Mitglieder mit ihrer Sub-Stufe auf diesem Server (fürs Dashboard). */
function listStatus(guildId) {
  return db.prepare(
    `SELECT l.discord_user_id AS user_id, l.twitch_login, l.twitch_name, l.linked_at, COALESCE(s.tier, 0) AS tier, s.updated_at
     FROM twitch_links l LEFT JOIN twitch_sub_status s ON s.guild_id = ? AND s.user_id = l.discord_user_id`,
  ).all(guildId);
}

module.exports = {
  getBroadcaster, listBroadcasters, saveBroadcaster, updateTokens, setSyncResult, deleteBroadcaster,
  getLink, listLinks, saveLink, deleteLink,
  setStatus, listStatus,
};
