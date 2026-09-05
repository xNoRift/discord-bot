'use strict';

const db = require('../db');

/**
 * Anti-Raid-Konfiguration: eine Zeile pro Server. Erkennt Join-Spikes
 * (zu viele Beitritte in kurzer Zeit) und optional zu junge Accounts.
 */

const ACTIONS = ['log', 'kick', 'ban'];

function ensureRow(guildId) {
  const now = Date.now();
  db.prepare(
    `INSERT OR IGNORE INTO anti_raid_settings
       (guild_id, enabled, window_seconds, max_joins, min_account_age_hours, action, lockdown, lockdown_minutes, notify_owner, exempt_role_ids, exempt_user_ids, created_at, updated_at)
     VALUES (?, 0, 10, 10, 0, 'log', 0, 10, 1, '[]', '[]', ?, ?)`,
  ).run(guildId, now, now);
}

function get(guildId) {
  ensureRow(guildId);
  return db.prepare('SELECT * FROM anti_raid_settings WHERE guild_id = ?').get(guildId);
}

function cleanIds(ids) {
  return [...new Set((ids || []).filter((id) => /^\d{5,25}$/.test(String(id))))];
}

/**
 * @param {object} patch  Nur vorhandene Schlüssel werden übernommen: enabled,
 *   windowSeconds, maxJoins, minAccountAgeHours, action, lockdown,
 *   lockdownMinutes, notifyOwner, exemptRoleIds, exemptUserIds
 */
function update(guildId, patch) {
  ensureRow(guildId);
  const sets = [];
  const params = { guild_id: guildId };

  if ('enabled' in patch) {
    sets.push('enabled = @enabled');
    params.enabled = patch.enabled ? 1 : 0;
  }
  if ('windowSeconds' in patch) {
    sets.push('window_seconds = @window_seconds');
    params.window_seconds = Math.max(2, Math.min(600, Number.parseInt(patch.windowSeconds, 10) || 10));
  }
  if ('maxJoins' in patch) {
    sets.push('max_joins = @max_joins');
    params.max_joins = Math.max(2, Math.min(1000, Number.parseInt(patch.maxJoins, 10) || 10));
  }
  if ('minAccountAgeHours' in patch) {
    sets.push('min_account_age_hours = @min_account_age_hours');
    params.min_account_age_hours = Math.max(0, Math.min(8760, Number.parseInt(patch.minAccountAgeHours, 10) || 0));
  }
  if ('action' in patch) {
    if (!ACTIONS.includes(patch.action)) throw new Error('Unbekannte Aktion.');
    sets.push('action = @action');
    params.action = patch.action;
  }
  if ('lockdown' in patch) {
    sets.push('lockdown = @lockdown');
    params.lockdown = patch.lockdown ? 1 : 0;
  }
  if ('lockdownMinutes' in patch) {
    sets.push('lockdown_minutes = @lockdown_minutes');
    params.lockdown_minutes = Math.max(1, Math.min(1440, Number.parseInt(patch.lockdownMinutes, 10) || 10));
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
  db.prepare(`UPDATE anti_raid_settings SET ${sets.join(', ')} WHERE guild_id = @guild_id`).run(params);
  return get(guildId);
}

module.exports = { ACTIONS, get, update };
