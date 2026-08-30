'use strict';

const db = require('../db');

/**
 * Giveaways, Teilnahmen und Gewinner.
 */

function create(data) {
  const info = db
    .prepare(
      `INSERT INTO giveaways
        (guild_id, channel_id, message_id, prize, description, winner_count, required_role_id,
         host_id, created_at, ends_at, ended, cancelled, winner_role_id, winner_role_duration_ms)
       VALUES
        (@guild_id, @channel_id, @message_id, @prize, @description, @winner_count, @required_role_id,
         @host_id, @created_at, @ends_at, 0, 0, @winner_role_id, @winner_role_duration_ms)`,
    )
    .run({
      guild_id: data.guildId,
      channel_id: data.channelId,
      message_id: data.messageId ?? null,
      prize: data.prize,
      description: data.description ?? null,
      winner_count: data.winnerCount ?? 1,
      required_role_id: data.requiredRoleId ?? null,
      host_id: data.hostId ?? null,
      created_at: Date.now(),
      ends_at: data.endsAt,
      winner_role_id: data.winnerRoleId ?? null,
      winner_role_duration_ms: data.winnerRoleDurationMs ?? null,
    });
  return get(info.lastInsertRowid);
}

function get(id) {
  return db.prepare('SELECT * FROM giveaways WHERE id = ?').get(id);
}

function getByMessage(messageId) {
  return db.prepare('SELECT * FROM giveaways WHERE message_id = ?').get(messageId);
}

function setMessageId(id, messageId) {
  db.prepare('UPDATE giveaways SET message_id = ? WHERE id = ?').run(messageId, id);
}

function update(id, patch) {
  const allowed = [
    'prize',
    'description',
    'winner_count',
    'required_role_id',
    'ends_at',
    'winner_role_id',
    'winner_role_duration_ms',
    'channel_id',
    'message_id',
  ];
  const keys = Object.keys(patch).filter((k) => allowed.includes(k));
  if (!keys.length) return get(id);
  const setSql = keys.map((k) => `${k} = @${k}`).join(', ');
  const params = { id };
  for (const k of keys) params[k] = patch[k] === '' ? null : patch[k];
  db.prepare(`UPDATE giveaways SET ${setSql} WHERE id = @id`).run(params);
  return get(id);
}

function listActive(guildId) {
  return db
    .prepare(
      'SELECT * FROM giveaways WHERE guild_id = ? AND ended = 0 AND cancelled = 0 ORDER BY ends_at ASC',
    )
    .all(guildId);
}

function listAllActive() {
  return db.prepare('SELECT * FROM giveaways WHERE ended = 0 AND cancelled = 0').all();
}

function listEnded(guildId, limit = 50) {
  return db
    .prepare(
      'SELECT * FROM giveaways WHERE guild_id = ? AND (ended = 1 OR cancelled = 1) ORDER BY ends_at DESC LIMIT ?',
    )
    .all(guildId, limit);
}

function markEnded(id, winnerIds) {
  db.prepare('UPDATE giveaways SET ended = 1, winners_json = ? WHERE id = ?').run(
    JSON.stringify(winnerIds ?? []),
    id,
  );
  return get(id);
}

function markCancelled(id) {
  db.prepare('UPDATE giveaways SET cancelled = 1, ended = 1 WHERE id = ?').run(id);
  return get(id);
}

function setWinners(id, winnerIds) {
  db.prepare('UPDATE giveaways SET winners_json = ? WHERE id = ?').run(
    JSON.stringify(winnerIds ?? []),
    id,
  );
  return get(id);
}

/* ---------- Teilnahmen ---------- */

function addEntry(giveawayId, userId) {
  db.prepare(
    'INSERT OR IGNORE INTO giveaway_entries (giveaway_id, user_id, entered_at) VALUES (?, ?, ?)',
  ).run(giveawayId, userId, Date.now());
}

function removeEntry(giveawayId, userId) {
  db.prepare('DELETE FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?').run(
    giveawayId,
    userId,
  );
}

function hasEntry(giveawayId, userId) {
  return Boolean(
    db
      .prepare('SELECT 1 FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?')
      .get(giveawayId, userId),
  );
}

function getEntries(giveawayId) {
  return db
    .prepare('SELECT user_id FROM giveaway_entries WHERE giveaway_id = ?')
    .all(giveawayId)
    .map((r) => r.user_id);
}

function countEntries(giveawayId) {
  return db
    .prepare('SELECT COUNT(*) AS n FROM giveaway_entries WHERE giveaway_id = ?')
    .get(giveawayId).n;
}

/* ---------- Gewinner-Historie ---------- */

function recordWinners(giveawayId, userIds, { isReroll = false } = {}) {
  const insert = db.prepare(
    'INSERT INTO giveaway_winners (giveaway_id, user_id, drawn_at, is_reroll) VALUES (?, ?, ?, ?)',
  );
  const now = Date.now();
  const tx = db.transaction((ids) => {
    for (const id of ids) insert.run(giveawayId, id, now, isReroll ? 1 : 0);
  });
  tx(userIds);
}

function getWinnerHistory(giveawayId) {
  return db
    .prepare('SELECT * FROM giveaway_winners WHERE giveaway_id = ? ORDER BY drawn_at ASC')
    .all(giveawayId);
}

function stats(guildId) {
  const active = db
    .prepare(
      'SELECT COUNT(*) AS n FROM giveaways WHERE guild_id = ? AND ended = 0 AND cancelled = 0',
    )
    .get(guildId).n;
  const total = db
    .prepare('SELECT COUNT(*) AS n FROM giveaways WHERE guild_id = ?')
    .get(guildId).n;
  return { active, total };
}

module.exports = {
  create,
  get,
  getByMessage,
  setMessageId,
  update,
  listActive,
  listAllActive,
  listEnded,
  markEnded,
  markCancelled,
  setWinners,
  addEntry,
  removeEntry,
  hasEntry,
  getEntries,
  countEntries,
  recordWinners,
  getWinnerHistory,
  stats,
};
