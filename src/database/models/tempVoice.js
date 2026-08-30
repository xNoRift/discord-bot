'use strict';

const db = require('../db');

/**
 * Aktive temporäre Sprachkanäle (Temp-Voice / "Join to Create").
 * Werden gelöscht, sobald der Kanal leer ist bzw. beim Bot-Neustart aufgeräumt.
 */

function add({ channelId, guildId, ownerId }) {
  db.prepare(
    `INSERT OR REPLACE INTO temp_voice_channels (channel_id, guild_id, owner_id, locked, hidden, created_at)
     VALUES (?, ?, ?, 0, 0, ?)`,
  ).run(channelId, guildId, ownerId, Date.now());
  return get(channelId);
}

function get(channelId) {
  return db.prepare('SELECT * FROM temp_voice_channels WHERE channel_id = ?').get(channelId);
}

function isTemp(channelId) {
  return Boolean(get(channelId));
}

function listByGuild(guildId) {
  return db.prepare('SELECT * FROM temp_voice_channels WHERE guild_id = ?').all(guildId);
}

function listAll() {
  return db.prepare('SELECT * FROM temp_voice_channels').all();
}

function setOwner(channelId, ownerId) {
  db.prepare('UPDATE temp_voice_channels SET owner_id = ? WHERE channel_id = ?').run(ownerId, channelId);
  return get(channelId);
}

function setFlags(channelId, patch) {
  const cur = get(channelId);
  if (!cur) return null;
  const locked = patch.locked === undefined ? cur.locked : patch.locked ? 1 : 0;
  const hidden = patch.hidden === undefined ? cur.hidden : patch.hidden ? 1 : 0;
  db.prepare('UPDATE temp_voice_channels SET locked = ?, hidden = ? WHERE channel_id = ?').run(
    locked,
    hidden,
    channelId,
  );
  return get(channelId);
}

function remove(channelId) {
  db.prepare('DELETE FROM temp_voice_channels WHERE channel_id = ?').run(channelId);
}

module.exports = { add, get, isTemp, listByGuild, listAll, setOwner, setFlags, remove };
