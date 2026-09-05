'use strict';

const db = require('../db');

/**
 * Anti-Nuke-Konfiguration: eine Zeile pro Server. Überwacht gefährliche
 * Aktionen (Channels/Rollen löschen/erstellen, gefährliche Rechteänderungen,
 * Massenban/-kick, Webhooks, Bot-Additions) über Zähler pro Aktionstyp+Täter
 * und bestraft bei Überschreiten eines Limits.
 */

const ACTIONS = ['strip_roles', 'kick', 'ban'];

const TYPES = [
  'channel_delete',
  'channel_create',
  'role_delete',
  'role_create',
  'role_dangerous_permission',
  'ban',
  'kick',
  'webhook_create',
  'webhook_delete',
  'bot_add',
];

const DEFAULT_LIMITS = {
  channel_delete: { max: 3, windowSeconds: 10 },
  channel_create: { max: 5, windowSeconds: 10 },
  role_delete: { max: 3, windowSeconds: 10 },
  role_create: { max: 5, windowSeconds: 10 },
  role_dangerous_permission: { max: 2, windowSeconds: 10 },
  ban: { max: 5, windowSeconds: 10 },
  kick: { max: 5, windowSeconds: 10 },
  webhook_create: { max: 3, windowSeconds: 10 },
  webhook_delete: { max: 3, windowSeconds: 10 },
  bot_add: { max: 1, windowSeconds: 10 },
};

function ensureRow(guildId) {
  const now = Date.now();
  db.prepare(
    `INSERT OR IGNORE INTO anti_nuke_settings
       (guild_id, enabled, limits_json, action, revert, notify_owner, exempt_role_ids, exempt_user_ids, created_at, updated_at)
     VALUES (?, 0, '{}', 'strip_roles', 1, 1, '[]', '[]', ?, ?)`,
  ).run(guildId, now, now);
}

function get(guildId) {
  ensureRow(guildId);
  return db.prepare('SELECT * FROM anti_nuke_settings WHERE guild_id = ?').get(guildId);
}

/** Effektives Limit für einen Typ: konfigurierter Wert, sonst eingebauter Standard. */
function limitFor(settings, type) {
  let overrides = {};
  try {
    overrides = JSON.parse(settings.limits_json || '{}');
  } catch {
    overrides = {};
  }
  const base = DEFAULT_LIMITS[type] || { max: 5, windowSeconds: 10 };
  const o = overrides[type] || {};
  return {
    max: Math.max(1, Math.min(1000, Number.parseInt(o.max, 10) || base.max)),
    windowSeconds: Math.max(2, Math.min(600, Number.parseInt(o.windowSeconds, 10) || base.windowSeconds)),
  };
}

function cleanIds(ids) {
  return [...new Set((ids || []).filter((id) => /^\d{5,25}$/.test(String(id))))];
}

/**
 * @param {object} patch  Nur vorhandene Schlüssel: enabled, limits (Objekt
 *   {type: {max, windowSeconds}}), action, revert, notifyOwner,
 *   exemptRoleIds, exemptUserIds
 */
function update(guildId, patch) {
  ensureRow(guildId);
  const sets = [];
  const params = { guild_id: guildId };

  if ('enabled' in patch) {
    sets.push('enabled = @enabled');
    params.enabled = patch.enabled ? 1 : 0;
  }
  if ('limits' in patch) {
    const clean = {};
    if (patch.limits && typeof patch.limits === 'object') {
      for (const type of TYPES) {
        const v = patch.limits[type];
        if (!v) continue;
        clean[type] = {
          max: Math.max(1, Math.min(1000, Number.parseInt(v.max, 10) || DEFAULT_LIMITS[type].max)),
          windowSeconds: Math.max(2, Math.min(600, Number.parseInt(v.windowSeconds, 10) || DEFAULT_LIMITS[type].windowSeconds)),
        };
      }
    }
    sets.push('limits_json = @limits_json');
    params.limits_json = JSON.stringify(clean);
  }
  if ('action' in patch) {
    if (!ACTIONS.includes(patch.action)) throw new Error('Unbekannte Aktion.');
    sets.push('action = @action');
    params.action = patch.action;
  }
  if ('revert' in patch) {
    sets.push('revert = @revert');
    params.revert = patch.revert ? 1 : 0;
  }
  if ('notifyOwner' in patch) {
    sets.push('notify_owner = @notify_owner');
    params.notify_owner = patch.notifyOwner ? 1 : 0;
  }
  if ('exemptRoleIds' in patch) {
    sets.push('exempt_role_ids = @exempt_role_ids');
    params.exempt_role_ids = JSON.stringify(cleanIds(patch.exemptRoleIds));
  }
  if ('exemptUserIds' in patch) {
    sets.push('exempt_user_ids = @exempt_user_ids');
    params.exempt_user_ids = JSON.stringify(cleanIds(patch.exemptUserIds));
  }
  if (!sets.length) return get(guildId);

  sets.push('updated_at = @updated_at');
  params.updated_at = Date.now();
  db.prepare(`UPDATE anti_nuke_settings SET ${sets.join(', ')} WHERE guild_id = @guild_id`).run(params);
  return get(guildId);
}

module.exports = { ACTIONS, TYPES, DEFAULT_LIMITS, get, limitFor, update };
