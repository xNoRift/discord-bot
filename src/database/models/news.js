'use strict';

const db = require('../db');

/**
 * Über das Dashboard gesendete Bot-Nachrichten (Seite „Nachrichten“ → „Gesendete Nachrichten“).
 * Tabelle heißt historisch news_posts (früher Modul „Neuigkeiten“).
 */

function add({ guildId, channelId, messageId, title, body, authorId, asEmbed = true, color = null, imageUrl = null }) {
  const info = db
    .prepare(
      'INSERT INTO news_posts (guild_id, channel_id, message_id, title, body, author_id, as_embed, color, image_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(guildId, channelId, messageId, title || null, body || null, authorId ?? null, asEmbed ? 1 : 0, color || null, imageUrl || null, Date.now());
  return get(info.lastInsertRowid);
}

function get(id) {
  return db.prepare('SELECT * FROM news_posts WHERE id = ?').get(id);
}

function getByMessage(guildId, messageId) {
  return db.prepare('SELECT * FROM news_posts WHERE guild_id = ? AND message_id = ?').get(guildId, messageId);
}

function update(id, { title, body, asEmbed, color, imageUrl }) {
  db.prepare('UPDATE news_posts SET title = ?, body = ?, as_embed = ?, color = ?, image_url = ? WHERE id = ?').run(
    title || null,
    body || null,
    asEmbed ? 1 : 0,
    color || null,
    imageUrl || null,
    id,
  );
  return get(id);
}

function list(guildId, limit = 30) {
  return db.prepare('SELECT * FROM news_posts WHERE guild_id = ? ORDER BY id DESC LIMIT ?').all(guildId, limit);
}

function remove(id) {
  db.prepare('DELETE FROM news_posts WHERE id = ?').run(id);
}

module.exports = { add, get, getByMessage, update, list, remove };
