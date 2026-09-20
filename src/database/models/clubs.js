'use strict';

const db = require('../db');

/** Club-Management: Clubs mit Leiter, Mitgliedern, optionaler Rolle und Kanal. */

function create({ guildId, name, description, emoji, leaderId, roleId, channelId }) {
  const info = db
    .prepare(
      `INSERT INTO clubs (guild_id, name, description, emoji, leader_id, role_id, channel_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(guildId, name, description ?? null, emoji ?? null, leaderId ?? null, roleId ?? null, channelId ?? null, Date.now());
  return get(info.lastInsertRowid);
}

function get(id) {
  return db.prepare('SELECT * FROM clubs WHERE id = ?').get(id);
}

function list(guildId) {
  return db.prepare('SELECT * FROM clubs WHERE guild_id = ? ORDER BY name COLLATE NOCASE').all(guildId);
}

function update(id, patch) {
  const allowed = ['name', 'description', 'emoji', 'leader_id', 'role_id', 'channel_id'];
  const keys = Object.keys(patch).filter((k) => allowed.includes(k));
  if (!keys.length) return get(id);
  db.prepare(`UPDATE clubs SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...patch, id });
  return get(id);
}

function remove(id) {
  db.prepare('DELETE FROM clubs WHERE id = ?').run(id);
}

function members(clubId) {
  return db
    .prepare(
      `SELECT * FROM club_members WHERE club_id = ?
       ORDER BY CASE rank WHEN 'leader' THEN 0 WHEN 'officer' THEN 1 ELSE 2 END, joined_at`,
    )
    .all(clubId);
}

function getMember(clubId, userId) {
  return db.prepare('SELECT * FROM club_members WHERE club_id = ? AND user_id = ?').get(clubId, userId);
}

function addMember(clubId, userId, rank = 'member') {
  db.prepare(
    `INSERT INTO club_members (club_id, user_id, rank, joined_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(club_id, user_id) DO UPDATE SET rank = excluded.rank`,
  ).run(clubId, userId, rank, Date.now());
}

function removeMember(clubId, userId) {
  db.prepare('DELETE FROM club_members WHERE club_id = ? AND user_id = ?').run(clubId, userId);
}

function ledBy(guildId, userId) {
  return db.prepare('SELECT COUNT(*) AS n FROM clubs WHERE guild_id = ? AND leader_id = ?').get(guildId, userId).n;
}

module.exports = { create, get, list, update, remove, members, getMember, addMember, removeMember, ledBy };
