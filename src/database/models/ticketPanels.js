'use strict';

const db = require('../db');

/**
 * Ticket-Panels und ihre Kategorien.
 * Ein Server kann mehrere Panels haben, jedes Panel mehrere Kategorien
 * (jede Kategorie mit eigener Discord-Kategorie, Support-Rolle, Begrüßung …).
 */

/* ---------------- Panels ---------------- */

function createPanel({ guildId, name, title, description, color, useSelect, buttonLabel }) {
  const now = Date.now();
  const info = db
    .prepare(
      `INSERT INTO ticket_panels
        (guild_id, name, title, description, color, use_select, button_label, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      guildId,
      name,
      title ?? null,
      description ?? null,
      color ?? null,
      useSelect ? 1 : 0,
      buttonLabel ?? null,
      now,
      now,
    );
  return getPanel(info.lastInsertRowid);
}

function getPanel(id) {
  return db.prepare('SELECT * FROM ticket_panels WHERE id = ?').get(id);
}

function getPanelByMessage(messageId) {
  return db.prepare('SELECT * FROM ticket_panels WHERE message_id = ?').get(messageId);
}

function listPanels(guildId) {
  return db
    .prepare('SELECT * FROM ticket_panels WHERE guild_id = ? ORDER BY id ASC')
    .all(guildId);
}

function updatePanel(id, patch) {
  const allowed = [
    'name', 'title', 'description', 'color', 'use_select', 'button_label',
    'channel_id', 'message_id', 'log_channel_id', 'rating_enabled',
    'rating_channel_id', 'claim_category_id', 'autoclose_hours',
    'image_url', 'thumbnail_url',
  ];
  const keys = Object.keys(patch).filter((k) => allowed.includes(k));
  if (!keys.length) return getPanel(id);
  const setSql = keys.map((k) => `${k} = @${k}`).join(', ');
  const params = { id, updated_at: Date.now() };
  for (const k of keys) {
    let v = patch[k];
    if (typeof v === 'boolean') v = v ? 1 : 0;
    params[k] = v === '' ? null : v;
  }
  db.prepare(`UPDATE ticket_panels SET ${setSql}, updated_at = @updated_at WHERE id = @id`).run(params);
  return getPanel(id);
}

function deletePanel(id) {
  db.prepare('DELETE FROM ticket_panels WHERE id = ?').run(id);
}

/* ---------------- Kategorien ---------------- */

function createCategory({ panelId, guildId, label, emoji, description }) {
  const maxPos = db
    .prepare('SELECT COALESCE(MAX(position), -1) AS p FROM ticket_categories WHERE panel_id = ?')
    .get(panelId).p;
  const info = db
    .prepare(
      `INSERT INTO ticket_categories (panel_id, guild_id, label, emoji, description, position, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(panelId, guildId, label, emoji ?? null, description ?? null, maxPos + 1, Date.now());
  return getCategory(info.lastInsertRowid);
}

function getCategory(id) {
  return db.prepare('SELECT * FROM ticket_categories WHERE id = ?').get(id);
}

function listCategories(panelId) {
  return db
    .prepare('SELECT * FROM ticket_categories WHERE panel_id = ? ORDER BY position ASC, id ASC')
    .all(panelId);
}

function countCategories(panelId) {
  return db.prepare('SELECT COUNT(*) AS n FROM ticket_categories WHERE panel_id = ?').get(panelId).n;
}

function updateCategory(id, patch) {
  const allowed = [
    'label',
    'emoji',
    'description',
    'enabled',
    'prefix',
    'max_open',
    'discord_category_id',
    'support_role_id',
    'ping_role_id',
    'welcome_message',
    'name_format',
    'position',
  ];
  const keys = Object.keys(patch).filter((k) => allowed.includes(k));
  if (!keys.length) return getCategory(id);
  const setSql = keys.map((k) => `${k} = @${k}`).join(', ');
  const params = { id };
  for (const k of keys) params[k] = patch[k] === '' ? null : patch[k];
  db.prepare(`UPDATE ticket_categories SET ${setSql} WHERE id = @id`).run(params);
  return getCategory(id);
}

function deleteCategory(id) {
  db.prepare('DELETE FROM ticket_categories WHERE id = ?').run(id);
}

/* ---------------- Formularfelder pro Kategorie ---------------- */

function listQuestions(categoryId) {
  return db
    .prepare('SELECT * FROM ticket_category_questions WHERE category_id = ? ORDER BY position ASC, id ASC')
    .all(categoryId);
}

function countQuestions(categoryId) {
  return db
    .prepare('SELECT COUNT(*) AS n FROM ticket_category_questions WHERE category_id = ?')
    .get(categoryId).n;
}

function addQuestion({ categoryId, label, style = 'short', placeholder = null, required = true, minLength = 0, maxLength = 400 }) {
  const maxPos = db
    .prepare('SELECT COALESCE(MAX(position), -1) AS p FROM ticket_category_questions WHERE category_id = ?')
    .get(categoryId).p;
  const info = db
    .prepare(
      `INSERT INTO ticket_category_questions (category_id, label, style, placeholder, required, min_length, max_length, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(categoryId, label, style, placeholder, required ? 1 : 0, minLength, maxLength, maxPos + 1);
  return db.prepare('SELECT * FROM ticket_category_questions WHERE id = ?').get(info.lastInsertRowid);
}

function updateQuestion(id, patch) {
  const allowed = ['label', 'style', 'placeholder', 'required', 'min_length', 'max_length', 'position'];
  const keys = Object.keys(patch).filter((k) => allowed.includes(k));
  if (!keys.length) return db.prepare('SELECT * FROM ticket_category_questions WHERE id = ?').get(id);
  const setSql = keys.map((k) => `${k} = @${k}`).join(', ');
  const params = { id };
  for (const k of keys) {
    let v = patch[k];
    if (typeof v === 'boolean') v = v ? 1 : 0;
    params[k] = v === '' ? null : v;
  }
  db.prepare(`UPDATE ticket_category_questions SET ${setSql} WHERE id = @id`).run(params);
  return db.prepare('SELECT * FROM ticket_category_questions WHERE id = ?').get(id);
}

function deleteQuestion(id) {
  db.prepare('DELETE FROM ticket_category_questions WHERE id = ?').run(id);
}

function categoryWithQuestions(id) {
  const c = getCategory(id);
  return c ? { ...c, questions: listQuestions(id) } : null;
}

/** Panel inklusive Kategorien (mit Formularfeldern) für Dashboard-Ausgabe. */
function panelWithCategories(id) {
  const panel = getPanel(id);
  if (!panel) return null;
  return { ...panel, categories: listCategories(id).map((c) => ({ ...c, questions: listQuestions(c.id) })) };
}

function listPanelsWithCategories(guildId) {
  return listPanels(guildId).map((p) => ({
    ...p,
    categories: listCategories(p.id).map((c) => ({ ...c, questions: listQuestions(c.id) })),
  }));
}

module.exports = {
  createPanel,
  getPanel,
  getPanelByMessage,
  listPanels,
  updatePanel,
  deletePanel,
  createCategory,
  getCategory,
  listCategories,
  countCategories,
  updateCategory,
  deleteCategory,
  listQuestions,
  countQuestions,
  addQuestion,
  updateQuestion,
  deleteQuestion,
  categoryWithQuestions,
  panelWithCategories,
  listPanelsWithCategories,
};
