'use strict';

const db = require('../db');

/**
 * Globale Bot-Konfiguration (Status / Aktivität). Genau eine Zeile (id = 1).
 */

db.prepare(
  `INSERT OR IGNORE INTO bot_config (id, presence_status, activity_type, activity_text, updated_at)
   VALUES (1, 'online', 'watching', '/help • Dashboard', ?)`,
).run(Date.now());

function get() {
  return db.prepare('SELECT * FROM bot_config WHERE id = 1').get();
}

const ALLOWED = ['presence_status', 'activity_type', 'activity_text', 'activity_url'];

function update(patch) {
  const keys = Object.keys(patch).filter((k) => ALLOWED.includes(k));
  if (!keys.length) return get();
  const setSql = keys.map((k) => `${k} = @${k}`).join(', ');
  const params = { updated_at: Date.now() };
  for (const k of keys) params[k] = patch[k] === '' ? null : patch[k];
  db.prepare(`UPDATE bot_config SET ${setSql}, updated_at = @updated_at WHERE id = 1`).run(params);
  return get();
}

module.exports = { get, update };
