'use strict';

const db = require('../db');

/**
 * Ticket-Datensaetze.
 */

function create({ guildId, channelId, number, openerId, subject, panelId, categoryId, categoryLabel }) {
  const info = db
    .prepare(
      `INSERT INTO tickets
        (guild_id, channel_id, number, opener_id, subject, panel_id, category_id, category_label, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
    )
    .run(
      guildId,
      channelId,
      number,
      openerId,
      subject ?? null,
      panelId ?? null,
      categoryId ?? null,
      categoryLabel ?? null,
      Date.now(),
    );
  return get(info.lastInsertRowid);
}

function get(id) {
  return db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
}

function getByChannel(channelId) {
  return db.prepare('SELECT * FROM tickets WHERE channel_id = ?').get(channelId);
}

/** Aktivitätszeitstempel aktualisieren (für Auto-Close). */
function touch(id) {
  db.prepare('UPDATE tickets SET last_activity_at = ? WHERE id = ?').run(Date.now(), id);
}
function touchByChannel(channelId) {
  db.prepare('UPDATE tickets SET last_activity_at = ? WHERE channel_id = ?').run(Date.now(), channelId);
}

/** Offene Tickets, deren letzte Aktivität älter als `beforeTs` ist. */
function listStaleOpen(beforeTs) {
  return db
    .prepare(
      "SELECT * FROM tickets WHERE status = 'open' AND panel_id IS NOT NULL AND COALESCE(last_activity_at, created_at) < ?",
    )
    .all(beforeTs);
}

function countOpenByUser(guildId, userId) {
  return db
    .prepare(
      "SELECT COUNT(*) AS n FROM tickets WHERE guild_id = ? AND opener_id = ? AND status IN ('open','closed')",
    )
    .get(guildId, userId).n;
}

function listOpenByUser(guildId, userId) {
  return db
    .prepare("SELECT * FROM tickets WHERE guild_id = ? AND opener_id = ? AND status = 'open'")
    .all(guildId, userId);
}

function listByGuild(guildId, { status, limit = 100 } = {}) {
  if (status) {
    return db
      .prepare('SELECT * FROM tickets WHERE guild_id = ? AND status = ? ORDER BY id DESC LIMIT ?')
      .all(guildId, status, limit);
  }
  return db
    .prepare('SELECT * FROM tickets WHERE guild_id = ? ORDER BY id DESC LIMIT ?')
    .all(guildId, limit);
}

function stats(guildId) {
  const row = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END)   AS open,
         SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) AS closed,
         SUM(CASE WHEN status = 'deleted' THEN 1 ELSE 0 END) AS deleted,
         COUNT(*) AS total
       FROM tickets WHERE guild_id = ?`,
    )
    .get(guildId);
  return {
    open: row.open ?? 0,
    closed: row.closed ?? 0,
    deleted: row.deleted ?? 0,
    total: row.total ?? 0,
  };
}

function claim(id, userId) {
  db.prepare('UPDATE tickets SET claimed_by = ?, claimed_at = ? WHERE id = ?').run(
    userId,
    Date.now(),
    id,
  );
  return get(id);
}

function close(id, userId) {
  db.prepare(
    "UPDATE tickets SET status = 'closed', closed_by = ?, closed_at = ? WHERE id = ?",
  ).run(userId, Date.now(), id);
  return get(id);
}

function reopen(id) {
  db.prepare(
    "UPDATE tickets SET status = 'open', reopened_at = ?, closed_at = NULL, closed_by = NULL WHERE id = ?",
  ).run(Date.now(), id);
  return get(id);
}

function markDeleted(id, userId) {
  db.prepare(
    "UPDATE tickets SET status = 'deleted', deleted_by = ?, deleted_at = ? WHERE id = ?",
  ).run(userId, Date.now(), id);
  return get(id);
}

module.exports = {
  create,
  get,
  getByChannel,
  touch,
  touchByChannel,
  listStaleOpen,
  countOpenByUser,
  listByGuild,
  stats,
  claim,
  close,
  reopen,
  markDeleted,
};
