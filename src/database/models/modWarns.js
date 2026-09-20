'use strict';

const db = require('../db');

function add(guildId, userId, moderatorId, reason) {
  db.prepare('INSERT INTO mod_warns (guild_id, user_id, moderator_id, reason, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(guildId, userId, moderatorId ?? null, reason ?? null, Date.now());
  return count(guildId, userId);
}

function count(guildId, userId) {
  return db.prepare('SELECT COUNT(*) AS n FROM mod_warns WHERE guild_id = ? AND user_id = ?').get(guildId, userId).n;
}

function list(guildId, userId) {
  return db.prepare('SELECT * FROM mod_warns WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 25').all(guildId, userId);
}

function clear(guildId, userId) {
  return db.prepare('DELETE FROM mod_warns WHERE guild_id = ? AND user_id = ?').run(guildId, userId).changes;
}

module.exports = { add, count, list, clear };
