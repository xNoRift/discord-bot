'use strict';

const db = require('../db');

/** Eigene Radio-Sender pro Server. */

function list(guildId) {
  return db.prepare('SELECT * FROM music_stations WHERE guild_id = ? ORDER BY name COLLATE NOCASE').all(guildId);
}

function add({ guildId, name, url, addedBy }) {
  const info = db
    .prepare('INSERT INTO music_stations (guild_id, name, url, added_by, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(guildId, name, url, addedBy ?? null, Date.now());
  return db.prepare('SELECT * FROM music_stations WHERE id = ?').get(info.lastInsertRowid);
}

function remove(guildId, id) {
  db.prepare('DELETE FROM music_stations WHERE id = ? AND guild_id = ?').run(id, guildId);
}

function count(guildId) {
  return db.prepare('SELECT COUNT(*) AS n FROM music_stations WHERE guild_id = ?').get(guildId).n;
}

module.exports = { list, add, remove, count };
