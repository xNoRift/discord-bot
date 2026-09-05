'use strict';

const db = require('../db');

/**
 * AutoMod-Konfiguration: eine feste Regel pro (Server, Filtertyp). Keine
 * frei definierbaren Regeln ("Rule-Engine"), sondern sechs eingebaute
 * Filtertypen, die man an/aus schalten und konfigurieren kann.
 */

const TYPES = ['spam', 'caps', 'links', 'invites', 'mention_spam', 'wordlist'];
const ACTIONS = ['none', 'warn', 'timeout', 'kick', 'ban'];

function getRule(guildId, type) {
  return db.prepare('SELECT * FROM automod_rules WHERE guild_id = ? AND type = ?').get(guildId, type);
}

function listForGuild(guildId) {
  return db.prepare('SELECT * FROM automod_rules WHERE guild_id = ? ORDER BY type').all(guildId);
}

/** Nur aktivierte Regeln – für die Laufzeit-Prüfung bei jeder Nachricht. */
function listEnabled(guildId) {
  return db.prepare('SELECT * FROM automod_rules WHERE guild_id = ? AND enabled = 1').all(guildId);
}

function cleanIds(ids) {
  return [...new Set((ids || []).filter((id) => /^\d{5,25}$/.test(String(id))))];
}

function ensureRule(guildId, type) {
  const existing = getRule(guildId, type);
  if (existing) return existing;
  const now = Date.now();
  db.prepare(
    `INSERT OR IGNORE INTO automod_rules
       (guild_id, type, enabled, config_json, action, timeout_minutes, except_role_ids, except_channel_ids, created_at, updated_at)
     VALUES (?, ?, 0, '{}', 'none', 10, '[]', '[]', ?, ?)`,
  ).run(guildId, type, now, now);
  return getRule(guildId, type);
}

/** Legt alle sechs Regelzeilen (deaktiviert) an, falls sie fehlen, und gibt alle zurück. */
function listAllForGuild(guildId) {
  return TYPES.map((type) => ensureRule(guildId, type));
}

/**
 * @param {object} patch  Nur vorhandene Schlüssel werden übernommen:
 *   enabled, config, action, timeoutMinutes, exceptRoleIds, exceptChannelIds
 */
function upsertRule(guildId, type, patch) {
  if (!TYPES.includes(type)) throw new Error('Unbekannter AutoMod-Typ.');
  ensureRule(guildId, type);

  const sets = [];
  const params = { guild_id: guildId, type };

  if ('enabled' in patch) {
    sets.push('enabled = @enabled');
    params.enabled = patch.enabled ? 1 : 0;
  }
  if ('config' in patch) {
    sets.push('config_json = @config_json');
    params.config_json = JSON.stringify(patch.config && typeof patch.config === 'object' ? patch.config : {});
  }
  if ('action' in patch) {
    if (!ACTIONS.includes(patch.action)) throw new Error('Unbekannte Aktion.');
    sets.push('action = @action');
    params.action = patch.action;
  }
  if ('timeoutMinutes' in patch) {
    sets.push('timeout_minutes = @timeout_minutes');
    params.timeout_minutes = Math.max(1, Math.min(40320, Number.parseInt(patch.timeoutMinutes, 10) || 10));
  }
  if ('exceptRoleIds' in patch) {
    sets.push('except_role_ids = @except_role_ids');
    params.except_role_ids = JSON.stringify(cleanIds(patch.exceptRoleIds));
  }
  if ('exceptChannelIds' in patch) {
    sets.push('except_channel_ids = @except_channel_ids');
    params.except_channel_ids = JSON.stringify(cleanIds(patch.exceptChannelIds));
  }
  if (!sets.length) return getRule(guildId, type);

  sets.push('updated_at = @updated_at');
  params.updated_at = Date.now();
  db.prepare(`UPDATE automod_rules SET ${sets.join(', ')} WHERE guild_id = @guild_id AND type = @type`).run(params);
  return getRule(guildId, type);
}

module.exports = { TYPES, ACTIONS, getRule, listForGuild, listEnabled, listAllForGuild, upsertRule };
