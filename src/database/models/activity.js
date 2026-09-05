'use strict';

const db = require('../db');

/**
 * Allgemeines Aktivitaets-Log (fuer Dashboard-Anzeige, unabhaengig von den Discord-Log-Channels).
 */

function add({ guildId, category, type, actorId, targetId, message, meta, oldValue, newValue }) {
  db.prepare(
    `INSERT INTO activity_log (guild_id, category, type, actor_id, target_id, message, meta_json, old_value, new_value, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    guildId ?? null,
    category ?? null,
    type,
    actorId ?? null,
    targetId ?? null,
    message ?? null,
    meta ? JSON.stringify(meta) : null,
    oldValue !== undefined ? (typeof oldValue === 'string' ? oldValue : JSON.stringify(oldValue)) : null,
    newValue !== undefined ? (typeof newValue === 'string' ? newValue : JSON.stringify(newValue)) : null,
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
 * @param {{category?:string, categories?:string[], actorId?:string, targetId?:string, from?:number, to?:number, limit?:number}} [opts]
 *   `categories` (mehrere, ODER-verknüpft) ist für interne Zwecke wie die
 *   "komplette Moderationshistorie" (moderation + automod zusammen) gedacht;
 *   die normale Logs-Seite nutzt weiterhin das einzelne `category`.
 */
function query(guildId, opts = {}) {
  const clauses = ['guild_id = @guildId'];
  const params = { guildId, limit: Math.min(200, Math.max(1, opts.limit || 60)) };

  if (opts.categories && opts.categories.length) {
    const names = opts.categories.map((c, i) => `@cat${i}`);
    opts.categories.forEach((c, i) => {
      params[`cat${i}`] = c;
    });
    clauses.push(`category IN (${names.join(', ')})`);
  } else if (opts.category) {
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
