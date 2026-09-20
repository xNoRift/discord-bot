'use strict';

const db = require('../db');
const secretBox = require('../../utils/secretBox');

/**
 * Persistente Speicherung der ueber OAuth2 angemeldeten Dashboard-Nutzer.
 * Tokens werden nur serverseitig gespeichert und nie ans Frontend gegeben.
 */

function upsert({ userId, username, globalName, avatar, accessToken, refreshToken, expiresInSec }) {
  const now = Date.now();
  db.prepare(
    `INSERT INTO dashboard_users
      (user_id, username, global_name, avatar, access_token, refresh_token, token_expires_at, last_login)
     VALUES (@user_id, @username, @global_name, @avatar, @access_token, @refresh_token, @token_expires_at, @last_login)
     ON CONFLICT(user_id) DO UPDATE SET
       username = excluded.username,
       global_name = excluded.global_name,
       avatar = excluded.avatar,
       access_token = excluded.access_token,
       refresh_token = excluded.refresh_token,
       token_expires_at = excluded.token_expires_at,
       last_login = excluded.last_login`,
  ).run({
    user_id: userId,
    username,
    global_name: globalName ?? null,
    avatar: avatar ?? null,
    access_token: secretBox.encrypt(accessToken),
    refresh_token: secretBox.encrypt(refreshToken),
    token_expires_at: now + (expiresInSec ?? 3600) * 1000,
    last_login: now,
  });
}

function get(userId) {
  const row = db.prepare('SELECT * FROM dashboard_users WHERE user_id = ?').get(userId);
  if (!row) return row;
  return { ...row, access_token: secretBox.decrypt(row.access_token), refresh_token: secretBox.decrypt(row.refresh_token) };
}

function saveGuildCache(userId, guilds) {
  db.prepare('UPDATE dashboard_users SET guilds_json = ?, guilds_cached_at = ? WHERE user_id = ?').run(
    JSON.stringify(guilds ?? []),
    Date.now(),
    userId,
  );
}

function getGuildCache(userId) {
  const row = get(userId);
  if (!row || !row.guilds_json) return null;
  try {
    return {
      guilds: JSON.parse(row.guilds_json),
      cachedAt: row.guilds_cached_at ?? 0,
    };
  } catch {
    return null;
  }
}

function updateTokens(userId, { accessToken, refreshToken, expiresInSec }) {
  db.prepare(
    'UPDATE dashboard_users SET access_token = ?, refresh_token = ?, token_expires_at = ? WHERE user_id = ?',
  ).run(secretBox.encrypt(accessToken), secretBox.encrypt(refreshToken), Date.now() + (expiresInSec ?? 3600) * 1000, userId);
}

/** Verschlüsselt beim Start alle noch im Klartext gespeicherten Tokens (einmalige Migration). */
function encryptLegacyTokens() {
  const rows = db.prepare('SELECT user_id, access_token, refresh_token FROM dashboard_users').all();
  const upd = db.prepare('UPDATE dashboard_users SET access_token = ?, refresh_token = ? WHERE user_id = ?');
  let n = 0;
  for (const r of rows) {
    if (secretBox.isEncrypted(r.access_token) && secretBox.isEncrypted(r.refresh_token)) continue;
    upd.run(secretBox.encrypt(r.access_token), secretBox.encrypt(r.refresh_token), r.user_id);
    n++;
  }
  return n;
}

/** Löscht Tokens + Server-Cache von Nutzern, die sich lange nicht mehr eingeloggt haben. */
function purgeInactive(maxAgeMs) {
  return db
    .prepare('UPDATE dashboard_users SET access_token = NULL, refresh_token = NULL, guilds_json = NULL WHERE last_login < ? AND (access_token IS NOT NULL OR refresh_token IS NOT NULL OR guilds_json IS NOT NULL)')
    .run(Date.now() - maxAgeMs).changes;
}

module.exports = { upsert, get, saveGuildCache, getGuildCache, updateTokens, encryptLegacyTokens, purgeInactive };
