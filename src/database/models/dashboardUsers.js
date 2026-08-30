'use strict';

const db = require('../db');

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
    access_token: accessToken,
    refresh_token: refreshToken,
    token_expires_at: now + (expiresInSec ?? 3600) * 1000,
    last_login: now,
  });
}

function get(userId) {
  return db.prepare('SELECT * FROM dashboard_users WHERE user_id = ?').get(userId);
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
  ).run(accessToken, refreshToken, Date.now() + (expiresInSec ?? 3600) * 1000, userId);
}

module.exports = { upsert, get, saveGuildCache, getGuildCache, updateTokens };
