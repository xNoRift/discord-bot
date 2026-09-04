'use strict';

const db = require('../db');

/**
 * Verwarnungen pro Mitglied. Zurückgezogene Verwarnungen werden nicht
 * gelöscht (active=0), damit die Moderationshistorie erhalten bleibt.
 */

function add({ guildId, userId, moderatorId, moderatorTag, reason }) {
  const info = db
    .prepare(
      `INSERT INTO moderation_warnings (guild_id, user_id, moderator_id, moderator_tag, reason, active, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
    )
    .run(guildId, userId, moderatorId ?? null, moderatorTag ?? null, reason ?? null, Date.now());
  return getById(info.lastInsertRowid);
}

function getById(id) {
  return db.prepare('SELECT * FROM moderation_warnings WHERE id = ?').get(id);
}

/** Alle Verwarnungen (aktiv + zurückgezogen) eines Mitglieds, neueste zuerst. */
function listForUser(guildId, userId) {
  return db
    .prepare('SELECT * FROM moderation_warnings WHERE guild_id = ? AND user_id = ? ORDER BY id DESC')
    .all(guildId, userId);
}

/** Letzte Verwarnungen serverweit (für eine Übersicht ohne bestimmten Nutzer). */
function listRecent(guildId, limit = 30) {
  return db
    .prepare('SELECT * FROM moderation_warnings WHERE guild_id = ? ORDER BY id DESC LIMIT ?')
    .all(guildId, Math.min(100, Math.max(1, limit)));
}

function countActive(guildId, userId) {
  return db
    .prepare('SELECT COUNT(*) AS n FROM moderation_warnings WHERE guild_id = ? AND user_id = ? AND active = 1')
    .get(guildId, userId).n;
}

/** Zurückziehen – nur innerhalb der eigenen Guild erlaubt (IDOR-Schutz). */
function remove(guildId, id) {
  const row = getById(id);
  if (!row || row.guild_id !== guildId) return null;
  db.prepare('UPDATE moderation_warnings SET active = 0, removed_at = ? WHERE id = ?').run(Date.now(), id);
  return getById(id);
}

module.exports = { add, getById, listForUser, listRecent, countActive, remove };
