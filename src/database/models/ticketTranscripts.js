'use strict';

const db = require('../db');

/**
 * Gespeicherte Ticket-Verläufe (ein Eintrag pro Ticket, wird beim erneuten Schließen/Löschen überschrieben).
 */

function save(ticketId, guildId, data) {
  const now = Date.now();
  db.prepare(
    `INSERT INTO ticket_transcripts (ticket_id, guild_id, data, message_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(ticket_id) DO UPDATE SET data = excluded.data, message_count = excluded.message_count, updated_at = excluded.updated_at`,
  ).run(ticketId, guildId, JSON.stringify(data), data.messages?.length ?? 0, now, now);
}

function get(ticketId) {
  const row = db.prepare('SELECT * FROM ticket_transcripts WHERE ticket_id = ?').get(ticketId);
  if (!row) return null;
  try {
    return { ...row, data: JSON.parse(row.data) };
  } catch {
    return null;
  }
}

module.exports = { save, get };
