'use strict';

const db = require('../db');

/** Regel-Abschnitte: jeder Abschnitt ist ein Button unter der Regel-Nachricht und öffnet seine Regeln. */

const MAX_SECTIONS = 25; // 5 Zeilen à 5 Buttons

function list(guildId) {
  return db.prepare('SELECT * FROM rule_sections WHERE guild_id = ? ORDER BY position, id').all(guildId);
}

function get(id) {
  return db.prepare('SELECT * FROM rule_sections WHERE id = ?').get(id);
}

function count(guildId) {
  return db.prepare('SELECT COUNT(*) AS n FROM rule_sections WHERE guild_id = ?').get(guildId).n;
}

function create(guildId, { label, emoji, title, content }) {
  const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM rule_sections WHERE guild_id = ?').get(guildId).p;
  const info = db
    .prepare('INSERT INTO rule_sections (guild_id, position, label, emoji, title, content) VALUES (?, ?, ?, ?, ?, ?)')
    .run(guildId, pos, label, emoji || null, title || null, content);
  return get(info.lastInsertRowid);
}

function update(id, patch) {
  const allowed = ['label', 'emoji', 'title', 'content'];
  const keys = Object.keys(patch).filter((k) => allowed.includes(k));
  if (!keys.length) return get(id);
  db.prepare(`UPDATE rule_sections SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...patch, id });
  return get(id);
}

function remove(id) {
  db.prepare('DELETE FROM rule_sections WHERE id = ?').run(id);
}

/** Verschiebt einen Abschnitt um eine Stelle nach oben (-1) oder unten (+1). */
function move(guildId, id, dir) {
  const rows = list(guildId);
  const i = rows.findIndex((r) => r.id === id);
  const j = i + (dir < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= rows.length) return;
  [rows[i], rows[j]] = [rows[j], rows[i]];
  const set = db.prepare('UPDATE rule_sections SET position = ? WHERE id = ?');
  db.transaction(() => rows.forEach((r, idx) => set.run(idx, r.id)))();
}

module.exports = { MAX_SECTIONS, list, get, count, create, update, remove, move };
