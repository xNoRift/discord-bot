'use strict';

const db = require('../db');

/**
 * Eigene Playlists pro Server.
 * Jede Abfrage filtert zwingend nach guild_id, damit eine Playlist NUR auf dem
 * Server nutzbar ist, auf dem sie gespeichert wurde – nicht serverübergreifend,
 * auch wenn der Bot auf mehreren Servern läuft.
 */

function list(guildId) {
  return db
    .prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM music_playlist_tracks t WHERE t.playlist_id = p.id) AS track_count
       FROM music_playlists p WHERE p.guild_id = ? ORDER BY p.name COLLATE NOCASE`,
    )
    .all(guildId);
}

function get(guildId, id) {
  return db.prepare('SELECT * FROM music_playlists WHERE id = ? AND guild_id = ?').get(id, guildId);
}

function getByName(guildId, name) {
  return db.prepare('SELECT * FROM music_playlists WHERE guild_id = ? AND name = ? COLLATE NOCASE').get(guildId, name);
}

function tracks(playlistId) {
  return db.prepare('SELECT * FROM music_playlist_tracks WHERE playlist_id = ? ORDER BY position').all(playlistId);
}

function count(guildId) {
  return db.prepare('SELECT COUNT(*) AS n FROM music_playlists WHERE guild_id = ?').get(guildId).n;
}

/** @param {{guildId:string,name:string,createdBy:?string,tracks:Array<{title:string,url:?string,source:string,search:?string,duration:number}>}} */
function create({ guildId, name, createdBy, tracks: items }) {
  const insert = db.transaction(() => {
    const info = db
      .prepare('INSERT INTO music_playlists (guild_id, name, created_by, created_at) VALUES (?, ?, ?, ?)')
      .run(guildId, name, createdBy ?? null, Date.now());
    const playlistId = info.lastInsertRowid;
    const stmt = db.prepare(
      'INSERT INTO music_playlist_tracks (playlist_id, position, title, url, source, search, duration) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    items.forEach((t, i) => {
      stmt.run(playlistId, i, t.title, t.url ?? null, t.source || 'youtube', t.search ?? null, Math.round(t.duration || 0));
    });
    return playlistId;
  });
  return get(guildId, insert());
}

/** Löscht nur, wenn die Playlist wirklich diesem Server gehört. */
function remove(guildId, id) {
  return db.prepare('DELETE FROM music_playlists WHERE id = ? AND guild_id = ?').run(id, guildId).changes > 0;
}

module.exports = { list, get, getByName, tracks, count, create, remove };
