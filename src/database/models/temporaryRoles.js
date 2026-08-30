'use strict';

const db = require('../db');

/**
 * Temporaere Rollen (z.B. Giveaway-Gewinnerrolle fuer 24h).
 * Der Ablaufzeitpunkt wird persistiert, damit ein Bot-Neustart die
 * Rollenentfernung nicht "vergisst".
 */

function create({ userId, guildId, roleId, giveawayId, durationMs, reason = 'giveaway' }) {
  const now = Date.now();
  const info = db
    .prepare(
      `INSERT INTO temporary_roles
        (user_id, guild_id, role_id, giveaway_id, reason, granted_at, expires_at, removed)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
    )
    .run(userId, guildId, roleId, giveawayId ?? null, reason, now, now + durationMs);
  return get(info.lastInsertRowid);
}

function get(id) {
  return db.prepare('SELECT * FROM temporary_roles WHERE id = ?').get(id);
}

/** Aktiver (noch nicht entfernter) Eintrag fuer genau diese User/Guild/Rolle. */
function findActive(guildId, userId, roleId) {
  return db
    .prepare(
      'SELECT * FROM temporary_roles WHERE guild_id = ? AND user_id = ? AND role_id = ? AND removed = 0 ORDER BY expires_at DESC LIMIT 1',
    )
    .get(guildId, userId, roleId);
}

/** Alle noch aktiven Eintraege (fuer das Wiederherstellen nach Neustart). */
function listActive() {
  return db.prepare('SELECT * FROM temporary_roles WHERE removed = 0 ORDER BY expires_at ASC').all();
}

function listActiveByGuild(guildId) {
  return db
    .prepare('SELECT * FROM temporary_roles WHERE guild_id = ? AND removed = 0 ORDER BY expires_at ASC')
    .all(guildId);
}

/** Verlaengert einen bestehenden Eintrag (falls User mehrfach gewinnt). */
function extend(id, newExpiresAt) {
  db.prepare('UPDATE temporary_roles SET expires_at = ? WHERE id = ?').run(newExpiresAt, id);
  return get(id);
}

function markRemoved(id) {
  db.prepare('UPDATE temporary_roles SET removed = 1, removed_at = ? WHERE id = ?').run(
    Date.now(),
    id,
  );
  return get(id);
}

/**
 * Gibt es noch einen ANDEREN aktiven Eintrag fuer dieselbe Rolle/User?
 * Wird gebraucht, um zu entscheiden, ob die Rolle wirklich entfernt werden darf.
 */
function otherActiveExists(id, guildId, userId, roleId) {
  return Boolean(
    db
      .prepare(
        'SELECT 1 FROM temporary_roles WHERE id != ? AND guild_id = ? AND user_id = ? AND role_id = ? AND removed = 0',
      )
      .get(id, guildId, userId, roleId),
  );
}

module.exports = {
  create,
  get,
  findActive,
  listActive,
  listActiveByGuild,
  extend,
  markRemoved,
  otherActiveExists,
};
