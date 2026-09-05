'use strict';

const db = require('../db');

/**
 * Allgemeines Aktivitaets-Log (fuer Dashboard-Anzeige, unabhaengig von den Discord-Log-Channels).
 */

function add({ guildId, type, actorId, targetId, message, meta }) {
  db.prepare(
    `INSERT INTO activity_log (guild_id, type, actor_id, target_id, message, meta_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    guildId ?? null,
    type,
    actorId ?? null,
    targetId ?? null,
    message ?? null,
    meta ? JSON.stringify(meta) : null,
    Date.now(),
  );
}

function recent(guildId, limit = 30) {
  return db
    .prepare('SELECT * FROM activity_log WHERE guild_id = ? ORDER BY id DESC LIMIT ?')
    .all(guildId, limit);
}

module.exports = { add, recent };
