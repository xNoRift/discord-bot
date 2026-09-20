'use strict';

const db = require('../db');

/** Beteiligungs-Belohnungen: XP, Level, Level-Rollen. */

// XP, die für den Aufstieg von Level n auf n+1 nötig sind.
function xpForNext(level) {
  return 5 * level * level + 50 * level + 100;
}

function levelFromXp(totalXp) {
  let level = 0;
  let rest = totalXp;
  while (rest >= xpForNext(level)) {
    rest -= xpForNext(level);
    level++;
  }
  return { level, into: rest, needed: xpForNext(level) };
}

function get(guildId, userId) {
  return db.prepare('SELECT * FROM user_levels WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
}

/** @returns {{xp:number, level:number, leveledUp:boolean, oldLevel:number}} */
function addXp(guildId, userId, amount, { messages = 0, voiceMinutes = 0 } = {}) {
  const row = get(guildId, userId);
  const xp = (row?.xp ?? 0) + amount;
  const oldLevel = row?.level ?? 0;
  const { level } = levelFromXp(xp);
  db.prepare(
    `INSERT INTO user_levels (guild_id, user_id, xp, level, messages, voice_minutes, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(guild_id, user_id) DO UPDATE SET
       xp = excluded.xp, level = excluded.level,
       messages = messages + ?, voice_minutes = voice_minutes + ?, updated_at = excluded.updated_at`,
  ).run(guildId, userId, xp, level, messages, voiceMinutes, Date.now(), messages, voiceMinutes);
  return { xp, level, oldLevel, leveledUp: level > oldLevel };
}

function top(guildId, limit = 20, offset = 0) {
  return db
    .prepare('SELECT * FROM user_levels WHERE guild_id = ? ORDER BY xp DESC LIMIT ? OFFSET ?')
    .all(guildId, limit, offset);
}

function rankOf(guildId, userId) {
  const row = get(guildId, userId);
  if (!row) return null;
  return 1 + db.prepare('SELECT COUNT(*) AS n FROM user_levels WHERE guild_id = ? AND xp > ?').get(guildId, row.xp).n;
}

function count(guildId) {
  return db.prepare('SELECT COUNT(*) AS n FROM user_levels WHERE guild_id = ?').get(guildId).n;
}

function resetUser(guildId, userId) {
  db.prepare('DELETE FROM user_levels WHERE guild_id = ? AND user_id = ?').run(guildId, userId);
}

function resetAll(guildId) {
  db.prepare('DELETE FROM user_levels WHERE guild_id = ?').run(guildId);
}

function listRewards(guildId) {
  return db.prepare('SELECT * FROM level_rewards WHERE guild_id = ? ORDER BY level ASC').all(guildId);
}

function addReward(guildId, level, roleId) {
  db.prepare('INSERT OR IGNORE INTO level_rewards (guild_id, level, role_id) VALUES (?, ?, ?)').run(guildId, level, roleId);
}

function getReward(id) {
  return db.prepare('SELECT * FROM level_rewards WHERE id = ?').get(id);
}

function removeReward(id) {
  db.prepare('DELETE FROM level_rewards WHERE id = ?').run(id);
}

module.exports = {
  xpForNext, levelFromXp, get, addXp, top, rankOf, count,
  resetUser, resetAll, listRewards, addReward, getReward, removeReward,
};
