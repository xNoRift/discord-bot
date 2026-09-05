'use strict';

const db = require('../db');

/**
 * Custom Commands: eigene Text-/Embed-Befehle pro Server (z. B. !socials).
 * Namen werden immer klein gespeichert; eindeutig pro Server.
 */

const RESPONSE_TYPES = ['text', 'embed'];

function normalizeName(name) {
  return String(name || '').trim().toLowerCase().replace(/^[!/.]+/, '').slice(0, 32);
}

function isValidName(name) {
  return /^[a-z0-9][a-z0-9_-]{0,31}$/.test(name);
}

function listForGuild(guildId) {
  return db.prepare('SELECT * FROM custom_commands WHERE guild_id = ? ORDER BY name ASC').all(guildId);
}

function get(id) {
  return db.prepare('SELECT * FROM custom_commands WHERE id = ?').get(id);
}

function getByName(guildId, name) {
  return db.prepare('SELECT * FROM custom_commands WHERE guild_id = ? AND name = ?').get(guildId, normalizeName(name));
}

function create({ guildId, name, responseType, content }) {
  const clean = normalizeName(name);
  if (!isValidName(clean)) throw new Error('Ungültiger Command-Name (nur a-z, 0-9, - und _).');
  if (getByName(guildId, clean)) throw new Error('Ein Command mit diesem Namen existiert bereits.');
  const now = Date.now();
  const info = db
    .prepare(
      `INSERT INTO custom_commands (guild_id, name, response_type, content, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(guildId, clean, RESPONSE_TYPES.includes(responseType) ? responseType : 'text', content ?? null, now, now);
  return get(info.lastInsertRowid);
}

function update(id, patch) {
  const allowed = [
    'name', 'enabled', 'response_type', 'content', 'embed_title', 'embed_color',
    'embed_image_url', 'embed_thumbnail_url', 'buttons_json', 'delete_invocation',
  ];
  const keys = Object.keys(patch).filter((k) => allowed.includes(k));
  if (!keys.length) return get(id);

  const row = get(id);
  if (!row) return null;

  if (patch.name !== undefined) {
    patch.name = normalizeName(patch.name);
    if (!isValidName(patch.name)) throw new Error('Ungültiger Command-Name (nur a-z, 0-9, - und _).');
    const clash = getByName(row.guild_id, patch.name);
    if (clash && clash.id !== id) throw new Error('Ein Command mit diesem Namen existiert bereits.');
  }
  if (patch.response_type !== undefined && !RESPONSE_TYPES.includes(patch.response_type)) {
    throw new Error('Unbekannter Antwort-Typ.');
  }

  const setSql = keys.map((k) => `${k} = @${k}`).join(', ');
  const params = { id, updated_at: Date.now() };
  for (const k of keys) {
    let v = patch[k];
    if (typeof v === 'boolean') v = v ? 1 : 0;
    params[k] = v === '' ? null : v;
  }
  db.prepare(`UPDATE custom_commands SET ${setSql}, updated_at = @updated_at WHERE id = @id`).run(params);
  return get(id);
}

function remove(id) {
  db.prepare('DELETE FROM custom_commands WHERE id = ?').run(id);
}

module.exports = { RESPONSE_TYPES, normalizeName, isValidName, listForGuild, get, getByName, create, update, remove };
