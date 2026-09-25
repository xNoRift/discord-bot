'use strict';

const db = require('../db');
const optionEmbeds = require('../../utils/optionEmbeds');

/* ---------------- Erweiterte Einstellungen (JSON) ---------------- */

const SHOW_VALUES = ['creator', 'category', 'time'];
const NULLABLE = new Set(['claimCategoryEnabled']);

const embedDefaults = () => ({ title: '', description: '', color: '', imageUrl: '', thumbnailUrl: '', footer: '' });
const autoDefaults = () => ({
  autoClose: { enabled: false, hours: 24 },
  autoAlert: { enabled: false, hours: 12 },
  autoTeamAlert: { enabled: false, hours: 12 },
  autoUnclaim: { enabled: false, hours: 12 },
  closeUnresponsive: { enabled: false, hours: 12 },
  autoClaim: false,
  closeAfterRequest: false,
});
const panelCfgDefaults = () => ({
  allowUserAdd: false,
  nameFormat: '',
  showLoad: false,
  openEmbed: embedDefaults(),
  ratingPublicChannelId: '',
  ratingShow: [...SHOW_VALUES],
  logEnabled: true,
  transcripts: false,
  claimCategoryEnabled: null, // null = automatisch (aktiv, sobald eine Claim-Kategorie gesetzt ist)
  auto: autoDefaults(),
});
const categoryCfgDefaults = () => ({
  onBehalf: false,
  supportRoleIds: '',
  openEmbedOverride: false,
  openEmbed: embedDefaults(),
  autoOverride: false,
  auto: autoDefaults(),
});

function coerceLike(key, def, value) {
  if (NULLABLE.has(key)) {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    return null;
  }
  if (typeof def === 'boolean') return value === true || value === 'true' || value === 1 || value === '1';
  if (typeof def === 'number') {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? Math.min(720, Math.max(1, n)) : def;
  }
  if (Array.isArray(def)) return Array.isArray(value) ? value.filter((x) => SHOW_VALUES.includes(x)) : def;
  if (def && typeof def === 'object') return applyPatch(def, value);
  return String(value ?? '').trim().slice(0, 4000);
}

/** Übernimmt nur Schlüssel, die im Standard-Objekt vorkommen, und prüft deren Typ. */
function applyPatch(base, patch) {
  const out = {};
  for (const [k, def] of Object.entries(base)) {
    const has = patch && typeof patch === 'object' && Object.prototype.hasOwnProperty.call(patch, k);
    out[k] = has ? coerceLike(k, def, patch[k]) : def;
  }
  return out;
}

function parseCfg(factory, raw) {
  let parsed = {};
  if (raw && typeof raw === 'object') parsed = raw;
  else if (typeof raw === 'string' && raw) {
    try { parsed = JSON.parse(raw); } catch { parsed = {}; }
  }
  return applyPatch(factory(), parsed);
}

/** Führt ein Teil-Update in die bestehenden Einstellungen ein und liefert den JSON-String zum Speichern. */
function mergeCfg(factory, currentRaw, patch) {
  return JSON.stringify(applyPatch(parseCfg(factory, currentRaw), patch));
}

const panelCfg = (panel) => parseCfg(panelCfgDefaults, panel?.cfg);
const categoryCfg = (cat) => parseCfg(categoryCfgDefaults, cat?.cfg);
const mergePanelCfg = (panel, patch) => mergeCfg(panelCfgDefaults, panel?.cfg, patch);
const mergeCategoryCfg = (cat, patch) => mergeCfg(categoryCfgDefaults, cat?.cfg, patch);

/** Wirksame Automationen: Kategorie-Überschreibung > Panel; altes Feld autoclose_hours bleibt gültig. */
function effectiveAuto(panel, cat) {
  const pc = panelCfg(panel);
  const cc = categoryCfg(cat);
  const auto = JSON.parse(JSON.stringify(cc.autoOverride ? cc.auto : pc.auto));
  if (!cc.autoOverride && !auto.autoClose.enabled && Number(panel?.autoclose_hours) > 0) {
    auto.autoClose = { enabled: true, hours: Number(panel.autoclose_hours) };
  }
  return auto;
}

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
    'name', 'title', 'description', 'color', 'use_select', 'panel_layout', 'button_label',
    'channel_id', 'message_id', 'log_channel_id', 'rating_enabled',
    'rating_channel_id', 'claim_category_id', 'autoclose_hours',
    'image_url', 'thumbnail_url', 'cfg',
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
    'cfg',
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

const FORMS = ['open', 'close', 'rating'];

/** Optionen (JSON) einer Frage als Array bereitstellen. */
function parseQuestion(q) {
  if (!q) return q;
  let options = [];
  try { options = q.options ? JSON.parse(q.options) : []; } catch { options = []; }
  return { ...q, form: q.form || 'open', options: Array.isArray(options) ? options : [], optionEmbeds: optionEmbeds.parse(q.option_embeds) };
}

/** Felder eines Formulars ('open' | 'close' | 'rating') einer Kategorie. */
function listQuestions(categoryId, form = 'open') {
  return db
    .prepare(
      "SELECT * FROM ticket_category_questions WHERE category_id = ? AND COALESCE(form, 'open') = ? ORDER BY position ASC, id ASC",
    )
    .all(categoryId, form)
    .map(parseQuestion);
}

function listAllQuestions(categoryId) {
  return db
    .prepare('SELECT * FROM ticket_category_questions WHERE category_id = ? ORDER BY position ASC, id ASC')
    .all(categoryId)
    .map(parseQuestion);
}

function getQuestion(id) {
  return parseQuestion(db.prepare('SELECT * FROM ticket_category_questions WHERE id = ?').get(id));
}

function countQuestions(categoryId, form = 'open') {
  return db
    .prepare("SELECT COUNT(*) AS n FROM ticket_category_questions WHERE category_id = ? AND COALESCE(form, 'open') = ?")
    .get(categoryId, form).n;
}

function addQuestion({ categoryId, label, style = 'short', placeholder = null, required = true, minLength = 0, maxLength = 400, form = 'open', options = null, description = null }) {
  const maxPos = db
    .prepare('SELECT COALESCE(MAX(position), -1) AS p FROM ticket_category_questions WHERE category_id = ?')
    .get(categoryId).p;
  const info = db
    .prepare(
      `INSERT INTO ticket_category_questions (category_id, label, style, placeholder, required, min_length, max_length, position, form, options, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      categoryId, label, style, placeholder, required ? 1 : 0, minLength, maxLength, maxPos + 1,
      FORMS.includes(form) ? form : 'open', options ? JSON.stringify(options) : null, description,
    );
  return getQuestion(info.lastInsertRowid);
}

function updateQuestion(id, patch) {
  const allowed = ['label', 'style', 'placeholder', 'required', 'min_length', 'max_length', 'position', 'options', 'description', 'option_embeds'];
  const keys = Object.keys(patch).filter((k) => allowed.includes(k));
  if (!keys.length) return getQuestion(id);
  const setSql = keys.map((k) => `${k} = @${k}`).join(', ');
  const params = { id };
  for (const k of keys) {
    let v = patch[k];
    if (typeof v === 'boolean') v = v ? 1 : 0;
    if (k === 'options' && Array.isArray(v)) v = JSON.stringify(v);
    if (k === 'option_embeds' && v && typeof v === 'object') v = Object.keys(v).length ? JSON.stringify(v) : null;
    params[k] = v === '' ? null : v;
  }
  db.prepare(`UPDATE ticket_category_questions SET ${setSql} WHERE id = @id`).run(params);
  return getQuestion(id);
}

function deleteQuestion(id) {
  db.prepare('DELETE FROM ticket_category_questions WHERE id = ?').run(id);
}

function categoryWithQuestions(id) {
  const c = getCategory(id);
  return c ? { ...c, cfg: categoryCfg(c), questions: listAllQuestions(id) } : null;
}

const forDashboardPanel = (p) => ({ ...p, cfg: panelCfg(p) });
const forDashboardCategory = (c) => ({ ...c, cfg: categoryCfg(c), questions: listAllQuestions(c.id) });

/** Panel inklusive Kategorien (mit Formularfeldern) für Dashboard-Ausgabe. */
function panelWithCategories(id) {
  const panel = getPanel(id);
  if (!panel) return null;
  return { ...forDashboardPanel(panel), categories: listCategories(id).map(forDashboardCategory) };
}

function listPanelsWithCategories(guildId) {
  return listPanels(guildId).map((p) => ({
    ...forDashboardPanel(p),
    categories: listCategories(p.id).map(forDashboardCategory),
  }));
}

module.exports = {
  panelCfg,
  categoryCfg,
  mergePanelCfg,
  mergeCategoryCfg,
  effectiveAuto,
  listAllQuestions,
  FORMS,
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
  getQuestion,
  updateQuestion,
  deleteQuestion,
  categoryWithQuestions,
  panelWithCategories,
  listPanelsWithCategories,
};
