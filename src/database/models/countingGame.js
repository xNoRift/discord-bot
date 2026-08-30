'use strict';

const db = require('../db');

/**
 * Zustand des Zähl-Spiels pro Server (genau eine Zeile je Guild).
 */

const ensureStmt = db.prepare(
  `INSERT OR IGNORE INTO game_counting (guild_id, updated_at) VALUES (?, ?)`,
);

function ensure(guildId) {
  ensureStmt.run(guildId, Date.now());
  return get(guildId);
}

function get(guildId) {
  return db.prepare('SELECT * FROM game_counting WHERE guild_id = ?').get(guildId) ?? ensure(guildId);
}

const EDITABLE = ['enabled', 'channel_id', 'allow_same_user', 'reset_on_fail', 'react_emoji'];

function update(guildId, patch) {
  ensure(guildId);
  const keys = Object.keys(patch).filter((k) => EDITABLE.includes(k));
  if (!keys.length) return get(guildId);
  const setSql = keys.map((k) => `${k} = @${k}`).join(', ');
  const params = { guild_id: guildId, updated_at: Date.now() };
  for (const k of keys) {
    let v = patch[k];
    if (typeof v === 'boolean') v = v ? 1 : 0;
    if (v === '' || v === undefined) v = null;
    params[k] = v;
  }
  db.prepare(`UPDATE game_counting SET ${setSql}, updated_at = @updated_at WHERE guild_id = @guild_id`).run(params);
  return get(guildId);
}

/** Korrekt gezählt: Zahl + Zähler hochsetzen, ggf. Rekord aktualisieren. */
function recordCorrect(guildId, number, userId) {
  db.prepare(
    `UPDATE game_counting
       SET current = @number,
           last_user_id = @userId,
           total_counts = total_counts + 1,
           best = MAX(best, @number),
           updated_at = @now
     WHERE guild_id = @guildId`,
  ).run({ guildId, number, userId, now: Date.now() });
  return get(guildId);
}

/** Kette zurücksetzen (nach Fehler oder manuell). */
function resetCount(guildId) {
  db.prepare(
    `UPDATE game_counting SET current = 0, last_user_id = NULL, updated_at = ? WHERE guild_id = ?`,
  ).run(Date.now(), guildId);
  return get(guildId);
}

module.exports = { ensure, get, update, recordCorrect, resetCount };
