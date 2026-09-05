'use strict';

const db = require('../db');

/**
 * Rollen-Panels (Button-/Select-Rollen). Ein Server kann mehrere Panels
 * haben, jedes Panel mehrere Rollen. Analog zu ticket_panels aufgebaut.
 */

function createPanel({ guildId, name, title, description, color, style, mode }) {
  const now = Date.now();
  const info = db
    .prepare(
      `INSERT INTO role_panels
        (guild_id, name, title, description, color, style, mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      guildId,
      name,
      title ?? null,
      description ?? null,
      color ?? null,
      style === 'select' ? 'select' : 'buttons',
      mode === 'single' ? 'single' : 'multi',
      now,
      now,
    );
  return getPanel(info.lastInsertRowid);
}

function getPanel(id) {
  return db.prepare('SELECT * FROM role_panels WHERE id = ?').get(id);
}

function getPanelByMessage(messageId) {
  return db.prepare('SELECT * FROM role_panels WHERE message_id = ?').get(messageId);
}

function listPanels(guildId) {
  return db.prepare('SELECT * FROM role_panels WHERE guild_id = ? ORDER BY id ASC').all(guildId);
}

function updatePanel(id, patch) {
  const allowed = [
    'name', 'title', 'description', 'color', 'style', 'mode',
    'image_url', 'thumbnail_url', 'channel_id', 'message_id',
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
  db.prepare(`UPDATE role_panels SET ${setSql}, updated_at = @updated_at WHERE id = @id`).run(params);
  return getPanel(id);
}

function deletePanel(id) {
  db.prepare('DELETE FROM role_panel_roles WHERE panel_id = ?').run(id);
  db.prepare('DELETE FROM role_panels WHERE id = ?').run(id);
}

/* ---------------- Rollen pro Panel ---------------- */

function listRoles(panelId) {
  return db.prepare('SELECT * FROM role_panel_roles WHERE panel_id = ? ORDER BY position ASC, id ASC').all(panelId);
}

/** Ersetzt die komplette Rollenliste eines Panels (einfacher als granulares Diffing). */
function setRoles(panelId, roles) {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM role_panel_roles WHERE panel_id = ?').run(panelId);
    const insert = db.prepare(
      `INSERT INTO role_panel_roles (panel_id, role_id, label, emoji, button_style, position)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    (roles || []).forEach((r, i) => {
      if (!/^\d{5,25}$/.test(String(r.roleId || ''))) return;
      insert.run(
        panelId,
        String(r.roleId),
        (r.label || '').slice(0, 80) || null,
        r.emoji || null,
        ['primary', 'secondary', 'success', 'danger'].includes(r.buttonStyle) ? r.buttonStyle : 'secondary',
        i,
      );
    });
  });
  tx();
  return listRoles(panelId);
}

module.exports = { createPanel, getPanel, getPanelByMessage, listPanels, updatePanel, deletePanel, listRoles, setRoles };
