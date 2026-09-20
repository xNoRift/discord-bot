'use strict';

const db = require('../db');

/**
 * Bewerbungssystem (Appy-Aufbau):
 *  - application_types     = eine Bewerbung (Formular) mit Einstellungen (cfg-JSON) und Fragen
 *  - application_questions = Fragen (style: short | paragraph | choice | number)
 *  - application_panels    = Nachricht mit Buttons/Auswahlmenü, verknüpft mit Bewerbungen
 *  - applications          = Einreichungen
 *  - application_sessions  = laufende Bewerbungen per Direktnachricht
 */

/* ---------------- Hilfen ---------------- */

function parseJson(text, fallback) {
  try {
    const v = JSON.parse(text);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

const ID_RE = /^\d{5,25}$/;
const idOnly = (v) => (ID_RE.test(String(v ?? '').trim()) ? String(v).trim() : '');
const idList = (v) =>
  [...new Set(String(v ?? '').split(',').map((x) => x.trim()).filter((x) => ID_RE.test(x)))].slice(0, 250).join(',');
const text = (v, max) => String(v ?? '').slice(0, max);
const int = (v, min, max, fallback) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const bool = (v, fallback) => (v === undefined || v === null ? fallback : v === true || v === 1 || v === '1' || v === 'true');

/* ---------------- Einstellungen einer Bewerbung (cfg) ---------------- */

const ROLE_KEYS = [
  'restrictedRoleIds', 'requiredRoleIds', 'acceptedRoleIds', 'deniedRoleIds', 'pingRoleIds',
  'acceptedRemovalRoleIds', 'deniedRemovalRoleIds', 'pendingRoleIds', 'submitRemovalRoleIds', 'managerRoleIds',
];

const TYPE_CFG_DEFAULTS = {
  pendingChannelId: '',
  acceptedChannelId: '',
  deniedChannelId: '',
  acceptedMessage: 'Deine Bewerbung für `{applicationName}` wurde von {user} angenommen.',
  deniedMessage: 'Deine Bewerbung für `{applicationName}` wurde von {user} abgelehnt.',
  confirmationMessage: '',
  completionMessage: 'Deine Bewerbung wurde eingereicht.',
  showStats: true,
  hideAnswers: false,
  restrictedMode: 'all',
  requiredMode: 'all',
  ...Object.fromEntries(ROLE_KEYS.map((k) => [k, ''])),
  staffThreads: false,
  cooldownMin: 0,
  onLeave: 'nothing', // nothing | deny | delete
  timeLimitMin: 180,
};

function sanitizeTypeCfg(input) {
  const i = input && typeof input === 'object' ? input : {};
  const out = {};
  for (const k of ['pendingChannelId', 'acceptedChannelId', 'deniedChannelId']) if (k in i) out[k] = idOnly(i[k]);
  for (const k of ['acceptedMessage', 'deniedMessage', 'completionMessage']) if (k in i) out[k] = text(i[k], 1000);
  if ('confirmationMessage' in i) out.confirmationMessage = text(i.confirmationMessage, 1500);
  for (const k of ['showStats', 'hideAnswers', 'staffThreads']) if (k in i) out[k] = bool(i[k], TYPE_CFG_DEFAULTS[k]);
  for (const k of ['restrictedMode', 'requiredMode']) if (k in i) out[k] = i[k] === 'any' ? 'any' : 'all';
  for (const k of ROLE_KEYS) if (k in i) out[k] = idList(i[k]);
  if ('cooldownMin' in i) out.cooldownMin = int(i.cooldownMin, 0, 525600, 0);
  if ('timeLimitMin' in i) out.timeLimitMin = int(i.timeLimitMin, 1, 10080, 180);
  if ('onLeave' in i) out.onLeave = ['nothing', 'deny', 'delete'].includes(i.onLeave) ? i.onLeave : 'nothing';
  return out;
}

/** Wirksame Einstellungen einer Bewerbung (Standardwerte + gespeicherte). */
function typeCfg(type) {
  return { ...TYPE_CFG_DEFAULTS, ...sanitizeTypeCfg(parseJson(type?.cfg, {})) };
}

/** Gespeicherte Einstellungen mit einem Teil-Update zusammenführen -> JSON-Text. */
function mergeTypeCfg(type, patch) {
  return JSON.stringify({ ...sanitizeTypeCfg(parseJson(type?.cfg, {})), ...sanitizeTypeCfg(patch) });
}

/* ---------------- Bewerbungen (Formulare) ---------------- */

function createType({ guildId, name, emoji, description, method }) {
  const maxPos = db
    .prepare('SELECT COALESCE(MAX(position), -1) AS p FROM application_types WHERE guild_id = ?')
    .get(guildId).p;
  const info = db
    .prepare(
      `INSERT INTO application_types (guild_id, name, emoji, description, method, enabled, position, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(guildId, name, emoji ?? null, description ?? null, method === 'modal' ? 'modal' : 'dm', maxPos + 1, Date.now());
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
  const allowed = ['name', 'emoji', 'description', 'enabled', 'position', 'chat_category_id', 'auto_chat', 'method', 'cfg'];
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

/** Kopie einer Bewerbung samt Fragen. */
function duplicateType(id) {
  const t = getType(id);
  if (!t) return null;
  const copy = createType({ guildId: t.guild_id, name: `${t.name} (Kopie)`.slice(0, 80), emoji: t.emoji, description: t.description, method: t.method });
  updateType(copy.id, { cfg: t.cfg, chat_category_id: t.chat_category_id, auto_chat: t.auto_chat, enabled: t.enabled });
  for (const q of listQuestions(id)) {
    addQuestion({ typeId: copy.id, label: q.label, style: q.style, required: q.required, minLength: q.min_length, maxLength: q.max_length, options: q.options, description: q.description });
  }
  return getType(copy.id);
}

/* ---------------- Fragen ---------------- */

const QUESTION_STYLES = ['short', 'paragraph', 'choice', 'number'];

function normQ(q) {
  if (!q) return q;
  return { ...q, options: parseJson(q.options, []).filter((o) => typeof o === 'string' && o).slice(0, 25) };
}

function listQuestions(typeId) {
  return db
    .prepare('SELECT * FROM application_questions WHERE type_id = ? ORDER BY position ASC, id ASC')
    .all(typeId)
    .map(normQ);
}

function getQuestion(id) {
  return normQ(db.prepare('SELECT * FROM application_questions WHERE id = ?').get(id));
}

function cleanOptions(options) {
  const list = Array.isArray(options) ? options : String(options ?? '').split('\n');
  return [...new Set(list.map((o) => String(o).trim().slice(0, 100)).filter(Boolean))].slice(0, 25);
}

function addQuestion({ typeId, label, style = 'short', required = true, minLength = 0, maxLength = 400, options, description }) {
  const maxPos = db
    .prepare('SELECT COALESCE(MAX(position), -1) AS p FROM application_questions WHERE type_id = ?')
    .get(typeId).p;
  const info = db
    .prepare(
      `INSERT INTO application_questions (type_id, label, style, required, min_length, max_length, position, options, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      typeId,
      label,
      QUESTION_STYLES.includes(style) ? style : 'short',
      required ? 1 : 0,
      minLength,
      style === 'number' && maxLength === 400 ? 0 : maxLength,
      maxPos + 1,
      JSON.stringify(cleanOptions(options)),
      description ? String(description).slice(0, 100) : null,
    );
  return getQuestion(info.lastInsertRowid);
}

function updateQuestion(id, patch) {
  const allowed = ['label', 'style', 'required', 'min_length', 'max_length', 'position', 'options', 'description'];
  const keys = Object.keys(patch).filter((k) => allowed.includes(k));
  if (!keys.length) return getQuestion(id);
  const setSql = keys.map((k) => `${k} = @${k}`).join(', ');
  const params = { id };
  for (const k of keys) {
    let v = patch[k];
    if (typeof v === 'boolean') v = v ? 1 : 0;
    if (k === 'options') v = JSON.stringify(cleanOptions(v));
    if (k === 'description') v = v ? String(v).slice(0, 100) : null;
    params[k] = v;
  }
  db.prepare(`UPDATE application_questions SET ${setSql} WHERE id = @id`).run(params);
  return getQuestion(id);
}

function deleteQuestion(id) {
  db.prepare('DELETE FROM application_questions WHERE id = ?').run(id);
}

function countQuestions(typeId) {
  return db
    .prepare('SELECT COUNT(*) AS n FROM application_questions WHERE type_id = ?')
    .get(typeId).n;
}

/* ---------------- Einreichungen ---------------- */

function createApplication({ guildId, typeId, typeName, userId, userTag, answers, durationMs, source }) {
  const info = db
    .prepare(
      `INSERT INTO applications (guild_id, type_id, type_name, user_id, user_tag, answers_json, status, created_at, duration_ms, source)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    )
    .run(guildId, typeId ?? null, typeName ?? null, userId, userTag ?? null, JSON.stringify(answers ?? []), Date.now(), durationMs ?? null, source ?? null);
  return getApplication(info.lastInsertRowid);
}

function getApplication(id) {
  return db.prepare('SELECT * FROM applications WHERE id = ?').get(id);
}

function setApplicationMessage(id, channelId, messageId) {
  db.prepare('UPDATE applications SET channel_id = ?, message_id = ? WHERE id = ?').run(channelId, messageId, id);
}

function setThread(id, threadId) {
  db.prepare('UPDATE applications SET thread_id = ? WHERE id = ?').run(threadId, id);
}

function deleteApplication(id) {
  db.prepare('DELETE FROM applications WHERE id = ?').run(id);
}

function listApplications(guildId, { status, limit = 50 } = {}) {
  return listSubmissions(guildId, { status, limit }).items;
}

/** Einreichungen mit Filtern und Seiten: { items, total }. */
function listSubmissions(guildId, { status, typeId, userId, order = 'newest', limit = 20, offset = 0 } = {}) {
  const where = ['guild_id = @guildId'];
  const params = { guildId };
  if (status) { where.push('status = @status'); params.status = status; }
  if (typeId) { where.push('type_id = @typeId'); params.typeId = typeId; }
  if (userId) { where.push('user_id = @userId'); params.userId = userId; }
  const w = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS n FROM applications WHERE ${w}`).get(params).n;
  const items = db
    .prepare(`SELECT * FROM applications WHERE ${w} ORDER BY id ${order === 'oldest' ? 'ASC' : 'DESC'} LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit, offset });
  return { items, total };
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
      .prepare("SELECT 1 FROM applications WHERE guild_id = ? AND user_id = ? AND type_id = ? AND status = 'pending'")
      .get(guildId, userId, typeId),
  );
}

function listPendingByUser(guildId, userId) {
  return db.prepare("SELECT * FROM applications WHERE guild_id = ? AND user_id = ? AND status = 'pending'").all(guildId, userId);
}

/** Zeitpunkt der letzten Einreichung des Nutzers für diese Bewerbung (für die Wartezeit). */
function lastSubmissionAt(guildId, userId, typeId) {
  return db
    .prepare('SELECT MAX(created_at) AS t FROM applications WHERE guild_id = ? AND user_id = ? AND type_id = ?')
    .get(guildId, userId, typeId).t;
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

/* ---------------- Panels ---------------- */

const PANEL_CFG_DEFAULTS = { title: '', description: '', footer: '', color: '', imageUrl: '', thumbnailUrl: '' };

function sanitizePanelCfg(input) {
  const i = input && typeof input === 'object' ? input : {};
  const out = {};
  if ('title' in i) out.title = text(i.title, 256);
  if ('description' in i) out.description = text(i.description, 4000);
  if ('footer' in i) out.footer = text(i.footer, 2048);
  if ('color' in i) out.color = /^#?[0-9a-fA-F]{6}$/.test(String(i.color)) ? String(i.color).replace('#', '') : '';
  for (const k of ['imageUrl', 'thumbnailUrl']) if (k in i) out[k] = /^https:\/\//i.test(String(i[k])) ? text(i[k], 500) : '';
  return out;
}

function panelCfg(panel) {
  return { ...PANEL_CFG_DEFAULTS, ...sanitizePanelCfg(parseJson(panel?.cfg, {})) };
}

function panelTypeIds(panel) {
  const ids = parseJson(panel?.type_ids, []);
  return Array.isArray(ids) ? ids.map(Number).filter(Number.isFinite) : [];
}

function createPanel({ guildId, name }) {
  const info = db
    .prepare('INSERT INTO application_panels (guild_id, name, type_ids, panel_type, cfg, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(guildId, name, '[]', 'buttons', '{}', Date.now());
  return getPanel(info.lastInsertRowid);
}

function getPanel(id) {
  return db.prepare('SELECT * FROM application_panels WHERE id = ?').get(id);
}

function getPanelByMessage(messageId) {
  return db.prepare('SELECT * FROM application_panels WHERE message_id = ?').get(messageId);
}

function listPanels(guildId) {
  return db.prepare('SELECT * FROM application_panels WHERE guild_id = ? ORDER BY id ASC').all(guildId);
}

function updatePanel(id, patch) {
  const allowed = ['name', 'channel_id', 'message_id', 'type_ids', 'panel_type', 'cfg'];
  const keys = Object.keys(patch).filter((k) => allowed.includes(k));
  if (!keys.length) return getPanel(id);
  const setSql = keys.map((k) => `${k} = @${k}`).join(', ');
  const params = { id };
  for (const k of keys) params[k] = patch[k] === '' ? null : patch[k];
  db.prepare(`UPDATE application_panels SET ${setSql} WHERE id = @id`).run(params);
  return getPanel(id);
}

function deletePanel(id) {
  db.prepare('DELETE FROM application_panels WHERE id = ?').run(id);
}

function duplicatePanel(id) {
  const p = getPanel(id);
  if (!p) return null;
  const copy = createPanel({ guildId: p.guild_id, name: `${p.name} (Kopie)`.slice(0, 80) });
  return updatePanel(copy.id, { type_ids: p.type_ids, panel_type: p.panel_type, cfg: p.cfg });
}

/* ---------------- Laufende DM-Bewerbungen ---------------- */

function getSessionByUser(userId) {
  return db.prepare('SELECT * FROM application_sessions WHERE user_id = ?').get(userId);
}

function getSession(id) {
  return db.prepare('SELECT * FROM application_sessions WHERE id = ?').get(id);
}

function createSession({ guildId, typeId, userId, timeLimitMin }) {
  const now = Date.now();
  const info = db
    .prepare('INSERT INTO application_sessions (guild_id, type_id, user_id, step, answers_json, started_at, expires_at) VALUES (?, ?, ?, 0, ?, ?, ?)')
    .run(guildId, typeId, userId, '[]', now, now + (timeLimitMin ?? 180) * 60_000);
  return getSession(info.lastInsertRowid);
}

function updateSession(id, { step, answers }) {
  db.prepare('UPDATE application_sessions SET step = ?, answers_json = ? WHERE id = ?').run(step, JSON.stringify(answers), id);
  return getSession(id);
}

function deleteSession(id) {
  db.prepare('DELETE FROM application_sessions WHERE id = ?').run(id);
}

function listExpiredSessions(now = Date.now()) {
  return db.prepare('SELECT * FROM application_sessions WHERE expires_at < ?').all(now);
}

module.exports = {
  TYPE_CFG_DEFAULTS,
  ROLE_KEYS,
  QUESTION_STYLES,
  typeCfg,
  mergeTypeCfg,
  createType,
  getType,
  listTypes,
  updateType,
  deleteType,
  duplicateType,
  listQuestions,
  addQuestion,
  getQuestion,
  updateQuestion,
  deleteQuestion,
  countQuestions,
  createApplication,
  getApplication,
  setApplicationMessage,
  setThread,
  deleteApplication,
  listApplications,
  listSubmissions,
  reviewApplication,
  hasPending,
  listPendingByUser,
  lastSubmissionAt,
  stats,
  panelCfg,
  sanitizePanelCfg,
  panelTypeIds,
  createPanel,
  getPanel,
  getPanelByMessage,
  listPanels,
  updatePanel,
  deletePanel,
  duplicatePanel,
  getSessionByUser,
  getSession,
  createSession,
  updateSession,
  deleteSession,
  listExpiredSessions,
};
