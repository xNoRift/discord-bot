'use strict';

const db = require('../db');

/**
 * Social-Media-Benachrichtigungen (Twitch / YouTube / TikTok).
 * Eine Zeile = "Wenn Account X auf Plattform P etwas Neues macht, poste in Kanal Y".
 */

const PLATFORMS = ['twitch', 'youtube', 'tiktok', 'rss'];

function list(guildId) {
  return db
    .prepare('SELECT * FROM social_subscriptions WHERE guild_id = ? ORDER BY platform, id')
    .all(guildId);
}

function get(id) {
  return db.prepare('SELECT * FROM social_subscriptions WHERE id = ?').get(id);
}

/** Alle aktiven Abos einer Plattform – über alle Server (für den Poller). */
function listActiveByPlatform(platform) {
  return db
    .prepare('SELECT * FROM social_subscriptions WHERE platform = ? AND enabled = 1')
    .all(platform);
}

function create({ guildId, platform, account, accountLabel, channelId, mention, message, embed }) {
  const now = Date.now();
  const info = db
    .prepare(
      `INSERT INTO social_subscriptions
        (guild_id, platform, account, account_label, channel_id, mention, message, embed, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      guildId,
      platform,
      account,
      accountLabel ?? account,
      channelId,
      mention ?? null,
      message ?? null,
      embed === 0 || embed === false ? 0 : 1,
      now,
      now,
    );
  return get(info.lastInsertRowid);
}

const EDITABLE = ['account', 'account_label', 'channel_id', 'mention', 'message', 'embed', 'enabled'];

function update(id, patch) {
  const keys = Object.keys(patch).filter((k) => EDITABLE.includes(k));
  if (!keys.length) return get(id);
  const setSql = keys.map((k) => `${k} = @${k}`).join(', ');
  const params = { id, updated_at: Date.now() };
  for (const k of keys) {
    let v = patch[k];
    if (typeof v === 'boolean') v = v ? 1 : 0;
    if (v === '' || v === undefined) v = null;
    params[k] = v;
  }
  db.prepare(`UPDATE social_subscriptions SET ${setSql}, updated_at = @updated_at WHERE id = @id`).run(params);
  return get(id);
}

/** Nur vom Poller: Status/Fortschritt fortschreiben (keine Nutzerdaten). */
function setState(id, { isLive, lastItemId, lastAnnouncedAt, lastCheckedAt, failCount }) {
  const fields = [];
  const params = { id };
  if (isLive !== undefined) { fields.push('is_live = @is_live'); params.is_live = isLive ? 1 : 0; }
  if (lastItemId !== undefined) { fields.push('last_item_id = @last_item_id'); params.last_item_id = lastItemId; }
  if (lastAnnouncedAt !== undefined) { fields.push('last_announced_at = @last_announced_at'); params.last_announced_at = lastAnnouncedAt; }
  if (lastCheckedAt !== undefined) { fields.push('last_checked_at = @last_checked_at'); params.last_checked_at = lastCheckedAt; }
  if (failCount !== undefined) { fields.push('fail_count = @fail_count'); params.fail_count = failCount; }
  if (!fields.length) return get(id);
  db.prepare(`UPDATE social_subscriptions SET ${fields.join(', ')} WHERE id = @id`).run(params);
  return get(id);
}

function remove(id) {
  return db.prepare('DELETE FROM social_subscriptions WHERE id = ?').run(id).changes > 0;
}

function countByGuild(guildId) {
  return db.prepare('SELECT COUNT(*) AS n FROM social_subscriptions WHERE guild_id = ?').get(guildId).n;
}

module.exports = {
  PLATFORMS,
  list,
  get,
  listActiveByPlatform,
  create,
  update,
  setState,
  remove,
  countByGuild,
};
