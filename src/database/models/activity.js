'use strict';

const db = require('../db');

/**
 * Allgemeines Aktivitaets-Log (fuer Dashboard-Anzeige, unabhaengig von den Discord-Log-Channels).
 */

function add({ guildId, category, type, actorId, targetId, message, meta }) {
  db.prepare(
    `INSERT INTO activity_log (guild_id, category, type, actor_id, target_id, message, meta_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    guildId ?? null,
    category ?? null,
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

/**
 * Gefilterte Abfrage fürs Dashboard-Logs-Seite (und die Moderationshistorie).
 * @param {string} guildId
 * @param {{category?:string, actorId?:string, targetId?:string, from?:number, to?:number, limit?:number}} [opts]
 */
function query(guildId, opts = {}) {
  const clauses = ['guild_id = @guildId'];
  const params = { guildId, limit: Math.min(200, Math.max(1, opts.limit || 60)) };

  if (opts.category) {
    clauses.push('category = @category');
    params.category = opts.category;
  }
  if (opts.actorId && /^\d{5,25}$/.test(String(opts.actorId))) {
    clauses.push('actor_id = @actorId');
    params.actorId = String(opts.actorId);
  }
  if (opts.targetId && /^\d{5,25}$/.test(String(opts.targetId))) {
    clauses.push('target_id = @targetId');
    params.targetId = String(opts.targetId);
  }
  if (opts.from) {
    clauses.push('created_at >= @from');
    params.from = Number(opts.from);
  }
  if (opts.to) {
    clauses.push('created_at <= @to');
    params.to = Number(opts.to);
  }

  return db
    .prepare(`SELECT * FROM activity_log WHERE ${clauses.join(' AND ')} ORDER BY id DESC LIMIT @limit`)
    .all(params);
}

module.exports = { add, recent, query };
