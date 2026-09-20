'use strict';

const db = require('../db');

/** Beteiligungs-Belohnungen: XP, Level, Level-Rollen. */

const MAX_XP = 100_000_000;
const MAX_CURVE_LEVELS = 200;

// XP, die für den Aufstieg von Level n auf n+1 nötig sind (Standard-Formel).
function xpForNext(level) {
  return 5 * level * level + 50 * level + 100;
}

/** Standard-Kurve als Gesamt-XP-Schwellen: [Level 1, Level 2, …]. */
function defaultCurve(levelCount = 20) {
  const out = [];
  let total = 0;
  for (let l = 0; l < levelCount; l++) {
    total += xpForNext(l);
    out.push(total);
  }
  return out;
}

/**
 * Level zu einer Gesamt-XP-Zahl.
 * curve = null → Standard-Formel (unbegrenzt). Sonst ist curve[i] die Gesamt-XP für Level i+1,
 * das letzte Level ist dann das Höchstlevel (needed = 0).
 */
function levelFromXp(totalXp, curve = null) {
  if (curve?.length) {
    let level = 0;
    while (level < curve.length && totalXp >= curve[level]) level++;
    const start = level === 0 ? 0 : curve[level - 1];
    const needed = level >= curve.length ? 0 : curve[level] - start;
    return { level, into: totalXp - start, needed };
  }
  let level = 0;
  let rest = totalXp;
  while (rest >= xpForNext(level)) {
    rest -= xpForNext(level);
    level++;
  }
  return { level, into: rest, needed: xpForNext(level) };
}

/* ---- Eigene Level-Stufen (pro Server, im Speicher zwischengespeichert) ---- */

const curveCache = new Map(); // guildId -> number[] | null

/** @returns {number[]|null} null = Standard-Formel */
function getCurve(guildId) {
  if (curveCache.has(guildId)) return curveCache.get(guildId);
  const rows = db.prepare('SELECT xp FROM level_thresholds WHERE guild_id = ? ORDER BY level ASC').all(guildId);
  const curve = rows.length ? rows.map((r) => r.xp) : null;
  curveCache.set(guildId, curve);
  return curve;
}

/** Level-Infos für einen Server (berücksichtigt eigene Stufen). */
function levelInfo(guildId, totalXp) {
  return levelFromXp(totalXp, getCurve(guildId));
}

/** Speichert die gespeicherten Level aller Mitglieder nach einer Kurven-Änderung neu. */
function recalcLevels(guildId) {
  const curve = getCurve(guildId);
  const rows = db.prepare('SELECT user_id, xp, level FROM user_levels WHERE guild_id = ?').all(guildId);
  const upd = db.prepare('UPDATE user_levels SET level = ? WHERE guild_id = ? AND user_id = ?');
  db.transaction(() => {
    for (const r of rows) {
      const level = levelFromXp(r.xp, curve).level;
      if (level !== r.level) upd.run(level, guildId, r.user_id);
    }
  })();
}

/** Ersetzt die Kurve (null/leer = zurück zur Standard-Formel). Die Werte müssen vorab geprüft sein. */
function setCurve(guildId, curve) {
  db.transaction(() => {
    db.prepare('DELETE FROM level_thresholds WHERE guild_id = ?').run(guildId);
    const ins = db.prepare('INSERT INTO level_thresholds (guild_id, level, xp) VALUES (?, ?, ?)');
    (curve || []).forEach((xp, i) => ins.run(guildId, i + 1, xp));
  })();
  curveCache.delete(guildId);
  recalcLevels(guildId);
}

/* ---- XP ---- */

function get(guildId, userId) {
  return db.prepare('SELECT * FROM user_levels WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
}

/** @returns {{xp:number, level:number, leveledUp:boolean, oldLevel:number}} */
function addXp(guildId, userId, amount, { messages = 0, voiceMinutes = 0 } = {}) {
  const row = get(guildId, userId);
  const xp = (row?.xp ?? 0) + amount;
  const oldLevel = row?.level ?? 0;
  const { level } = levelInfo(guildId, xp);
  db.prepare(
    `INSERT INTO user_levels (guild_id, user_id, xp, level, messages, voice_minutes, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(guild_id, user_id) DO UPDATE SET
       xp = excluded.xp, level = excluded.level,
       messages = messages + ?, voice_minutes = voice_minutes + ?, updated_at = excluded.updated_at`,
  ).run(guildId, userId, xp, level, messages, voiceMinutes, Date.now(), messages, voiceMinutes);
  return { xp, level, oldLevel, leveledUp: level > oldLevel };
}

/** Setzt die Gesamt-XP direkt (manuelle Verwaltung), begrenzt auf 0…MAX_XP. */
function setXp(guildId, userId, xp) {
  const row = get(guildId, userId);
  const oldLevel = row?.level ?? 0;
  const total = Math.max(0, Math.min(MAX_XP, Math.round(xp)));
  const { level } = levelInfo(guildId, total);
  db.prepare(
    `INSERT INTO user_levels (guild_id, user_id, xp, level, messages, voice_minutes, updated_at)
     VALUES (?, ?, ?, ?, 0, 0, ?)
     ON CONFLICT(guild_id, user_id) DO UPDATE SET
       xp = excluded.xp, level = excluded.level, updated_at = excluded.updated_at`,
  ).run(guildId, userId, total, level, Date.now());
  return { xp: total, level, oldLevel };
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
  MAX_XP, MAX_CURVE_LEVELS,
  xpForNext, defaultCurve, levelFromXp, levelInfo, getCurve, setCurve,
  get, addXp, setXp, top, rankOf, count,
  resetUser, resetAll, listRewards, addReward, getReward, removeReward,
};
