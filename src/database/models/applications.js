'use strict';

const db = require('../db');

/**
 * Bewerbungssystem: Bewerbungsarten, Fragen und eingereichte Bewerbungen.
 */

/* ---------------- Bewerbungsarten ---------------- */

function createType({ guildId, name, emoji, description, acceptRoleId }) {
  const maxPos = db
    .prepare('SELECT COALESCE(MAX(position), -1) AS p FROM application_types WHERE guild_id = ?')
    .get(guildId).p;
  const info = db
    .prepare(
      `INSERT INTO application_types (guild_id, name, emoji, description, accept_role_id, enabled, position, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(guildId, name, emoji ?? null, description ?? null, acceptRoleId ?? null, maxPos + 1, Date.now());
  return getType(info.lastInsertRowid);
}

function getType(id) {
  return db.prepare('SELECT * FROM application_types WHERE id = ?').get(id);
}

function listTypes(guildId, { onlyEnabled = false } = {}) {
  const sql = onlyEnabled
    ? 'SELECT * FROM application_types WHERE guild_id = ? AND enabled = 1 ORDER BY position ASC, id ASC'
    : 'SELECT * FROM application_types WHERE guild_id = ? ORDER BY position ASC, id ASC';
  return db.prepare(sql).all(guildId);
}

function updateType(id, patch) {
  const allowed = ['name', 'emoji', 'description', 'accept_role_id', 'enabled', 'position'];
  const keys = Object.keys(patch).filter((k) => allowed.includes(k));
  if (!keys.length) return getType(id);
  const setSql = keys.map((k) => `${k} = @${k}`).join(', ');
  const params = { id };
  for (const k of keys) {
    let v = patch[k];
    if (typeof v === 'boolean') v = v ? 1 : 0;
    params[k] = v === '' ? null : v;
  }
  db.prepare(`UPDATE application_types SET ${setSql} WHERE id = @id`).run(params);
  return getType(id);
}

function deleteType(id) {
  db.prepare('DELETE FROM application_types WHERE id = ?').run(id);
}

/* ---------------- Fragen ---------------- */

function listQuestions(typeId) {
  return db
    .prepare('SELECT * FROM application_questions WHERE type_id = ? ORDER BY position ASC, id ASC')
    .all(typeId);
}

function getQuestion(id) {
  return db.prepare('SELECT * FROM application_questions WHERE id = ?').get(id);
}

function addQuestion({ typeId, label, style = 'short', required = true, minLength = 0, maxLength = 400 }) {
  const maxPos = db
    .prepare('SELECT COALESCE(MAX(position), -1) AS p FROM application_questions WHERE type_id = ?')
    .get(typeId).p;
  const info = db
    .prepare(
      `INSERT INTO application_questions (type_id, label, style, required, min_length, max_length, position)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(typeId, label, style, required ? 1 : 0, minLength, maxLength, maxPos + 1);
  return db.prepare('SELECT * FROM application_questions WHERE id = ?').get(info.lastInsertRowid);
}

function updateQuestion(id, patch) {
  const allowed = ['label', 'style', 'required', 'min_length', 'max_length', 'position'];
  const keys = Object.keys(patch).filter((k) => allowed.includes(k));
  if (!keys.length) return db.prepare('SELECT * FROM application_questions WHERE id = ?').get(id);
  const setSql = keys.map((k) => `${k} = @${k}`).join(', ');
  const params = { id };
  for (const k of keys) {
    let v = patch[k];
    if (typeof v === 'boolean') v = v ? 1 : 0;
    params[k] = v;
  }
  db.prepare(`UPDATE application_questions SET ${setSql} WHERE id = @id`).run(params);
  return db.prepare('SELECT * FROM application_questions WHERE id = ?').get(id);
}

function deleteQuestion(id) {
  db.prepare('DELETE FROM application_questions WHERE id = ?').run(id);
}

function countQuestions(typeId) {
  return db
    .prepare('SELECT COUNT(*) AS n FROM application_questions WHERE type_id = ?')
    .get(typeId).n;
}

/* ---------------- Bewerbungen ---------------- */

function createApplication({ guildId, typeId, typeName, userId, userTag, answers }) {
  const info = db
    .prepare(
      `INSERT INTO applications (guild_id, type_id, type_name, user_id, user_tag, answers_json, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
    )
    .run(guildId, typeId ?? null, typeName ?? null, userId, userTag ?? null, JSON.stringify(answers ?? []), Date.now());
  return getApplication(info.lastInsertRowid);
}

function getApplication(id) {
  return db.prepare('SELECT * FROM applications WHERE id = ?').get(id);
}

function setApplicationMessage(id, channelId, messageId) {
  db.prepare('UPDATE applications SET channel_id = ?, message_id = ? WHERE id = ?').run(
    channelId,
    messageId,
    id,
  );
}

function listApplications(guildId, { status, limit = 50 } = {}) {
  if (status) {
    return db
      .prepare(
        'SELECT * FROM applications WHERE guild_id = ? AND status = ? ORDER BY id DESC LIMIT ?',
      )
      .all(guildId, status, limit);
  }
  return db
    .prepare('SELECT * FROM applications WHERE guild_id = ? ORDER BY id DESC LIMIT ?')
    .all(guildId, limit);
}

function reviewApplication(id, { status, reviewerId, note }) {
  db.prepare(
    'UPDATE applications SET status = ?, reviewer_id = ?, review_note = ?, reviewed_at = ? WHERE id = ?',
  ).run(status, reviewerId, note ?? null, Date.now(), id);
  return getApplication(id);
}

function hasPending(guildId, userId, typeId) {
  return Boolean(
    db
      .prepare(
        "SELECT 1 FROM applications WHERE guild_id = ? AND user_id = ? AND type_id = ? AND status = 'pending'",
      )
      .get(guildId, userId, typeId),
  );
}

function stats(guildId) {
  const row = db
    .prepare(
      `SELECT
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END)  AS pending,
        SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) AS accepted,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
        COUNT(*) AS total
       FROM applications WHERE guild_id = ?`,
    )
    .get(guildId);
  return {
    pending: row.pending ?? 0,
    accepted: row.accepted ?? 0,
    rejected: row.rejected ?? 0,
    total: row.total ?? 0,
  };
}

module.exports = {
  createType,
  getType,
  listTypes,
  updateType,
  deleteType,
  listQuestions,
  addQuestion,
  getQuestion,
  updateQuestion,
  deleteQuestion,
  countQuestions,
  createApplication,
  getApplication,
  setApplicationMessage,
  listApplications,
  reviewApplication,
  hasPending,
  stats,
};
