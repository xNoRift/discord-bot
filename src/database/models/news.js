'use strict';

const db = require('../db');

function add({ guildId, channelId, messageId, title, body, authorId }) {
  const info = db
    .prepare(
      'INSERT INTO news_posts (guild_id, channel_id, message_id, title, body, author_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(guildId, channelId, messageId, title ?? null, body ?? null, authorId ?? null, Date.now());
  return get(info.lastInsertRowid);
}

function get(id) {
  return db.prepare('SELECT * FROM news_posts WHERE id = ?').get(id);
}

function list(guildId, limit = 30) {
  return db.prepare('SELECT * FROM news_posts WHERE guild_id = ? ORDER BY id DESC LIMIT ?').all(guildId, limit);
}

function remove(id) {
  db.prepare('DELETE FROM news_posts WHERE id = ?').run(id);
}

module.exports = { add, get, list, remove };
