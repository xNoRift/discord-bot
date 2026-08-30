'use strict';

const db = require('../db');

/**
 * Guild-Datensaetze (Server, auf denen der Bot ist / war).
 */

const upsertStmt = db.prepare(`
  INSERT INTO guilds (guild_id, name, icon, owner_id, member_count, bot_present, joined_at, updated_at)
  VALUES (@guild_id, @name, @icon, @owner_id, @member_count, 1, @now, @now)
  ON CONFLICT(guild_id) DO UPDATE SET
    name = excluded.name,
    icon = excluded.icon,
    owner_id = excluded.owner_id,
    member_count = excluded.member_count,
    bot_present = 1,
    updated_at = excluded.updated_at
`);

function upsertFromGuild(guild) {
  const now = Date.now();
  upsertStmt.run({
    guild_id: guild.id,
    name: guild.name,
    icon: guild.icon ?? null,
    owner_id: guild.ownerId ?? null,
    member_count: guild.memberCount ?? 0,
    now,
  });
}

function markLeft(guildId) {
  db.prepare('UPDATE guilds SET bot_present = 0, updated_at = ? WHERE guild_id = ?').run(
    Date.now(),
    guildId,
  );
}

function get(guildId) {
  return db.prepare('SELECT * FROM guilds WHERE guild_id = ?').get(guildId);
}

function all() {
  return db.prepare('SELECT * FROM guilds ORDER BY name COLLATE NOCASE').all();
}

module.exports = { upsertFromGuild, markLeft, get, all };
