'use strict';

const db = require('../db');

/**
 * Einstellungen der neuen Module (Guild Protection, Belohnungen, Neuigkeiten, Clubs).
 * Pro Server und Modul ein JSON-Objekt. Nur Felder aus dem SCHEMA werden gespeichert
 * und typgeprüft; fehlende Felder fallen auf den Standardwert zurück.
 *
 * Feldtypen: bool | int:min:max | text:maxLen | enum:a|b|c
 */

const SCHEMAS = {
  protection: {
    enabled: [false, 'bool'],
    minAccountAgeDays: [0, 'int:0:365'],
    accountAgeAction: ['kick', 'enum:kick|timeout'],
    raidEnabled: [false, 'bool'],
    raidJoins: [5, 'int:2:50'],
    raidSeconds: [10, 'int:3:120'],
    raidAction: ['kick', 'enum:kick|timeout'],
    blockInvites: [false, 'bool'],
    blockLinks: [false, 'bool'],
    linkWhitelist: ['', 'text:500'],
    spamEnabled: [false, 'bool'],
    spamMessages: [6, 'int:3:30'],
    spamSeconds: [5, 'int:2:60'],
    spamTimeoutMinutes: [10, 'int:1:1440'],
    exemptRoleIds: ['', 'text:400'],
    logChannelId: ['', 'text:32'],
  },
  levels: {
    enabled: [false, 'bool'],
    xpMin: [15, 'int:1:200'],
    xpMax: [25, 'int:1:400'],
    cooldownSec: [60, 'int:0:3600'],
    voiceXp: [false, 'bool'],
    voiceXpPerMinute: [5, 'int:1:100'],
    announceChannelId: ['', 'text:32'],
    announceMessage: ['🎉 {user} ist jetzt **Level {level}**!', 'text:300'],
    noXpChannelIds: ['', 'text:400'],
  },
  news: {
    defaultChannelId: ['', 'text:32'],
  },
  clubs: {
    enabled: [false, 'bool'],
    createRole: [true, 'bool'],
    createChannel: [true, 'bool'],
    categoryId: ['', 'text:32'],
    maxClubsPerUser: [1, 'int:1:10'],
  },
};

function defaults(module) {
  const out = {};
  for (const [k, [def]] of Object.entries(SCHEMAS[module] || {})) out[k] = def;
  return out;
}

function coerce(spec, value) {
  const [def, type] = spec;
  if (type === 'bool') return value === true || value === 1 || value === 'true' || value === '1';
  if (type.startsWith('int:')) {
    const [, min, max] = type.split(':').map(Number);
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
  }
  if (type.startsWith('enum:')) {
    return type.slice(5).split('|').includes(String(value)) ? String(value) : def;
  }
  if (type.startsWith('text:')) {
    return String(value ?? '').trim().slice(0, Number(type.split(':')[1]));
  }
  return def;
}

function get(guildId, module) {
  const row = db.prepare('SELECT data FROM module_settings WHERE guild_id = ? AND module = ?').get(guildId, module);
  let stored = {};
  try { stored = row ? JSON.parse(row.data) : {}; } catch { stored = {}; }
  const out = defaults(module);
  for (const [k, spec] of Object.entries(SCHEMAS[module] || {})) {
    if (k in stored) out[k] = coerce(spec, stored[k]);
  }
  return out;
}

function update(guildId, module, patch) {
  const schema = SCHEMAS[module];
  if (!schema) throw new Error('Unbekanntes Modul.');
  const current = get(guildId, module);
  for (const [k, spec] of Object.entries(schema)) {
    if (patch && k in patch) current[k] = coerce(spec, patch[k]);
  }
  db.prepare(
    `INSERT INTO module_settings (guild_id, module, data, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(guild_id, module) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
  ).run(guildId, module, JSON.stringify(current), Date.now());
  return current;
}

module.exports = { get, update, defaults, SCHEMAS };
