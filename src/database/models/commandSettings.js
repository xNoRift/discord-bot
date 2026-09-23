'use strict';

const db = require('../db');

/**
 * Pro-Server Ein/Aus + Kanal-Beschränkung für jeden Slash-Befehl.
 * Nutzt die bestehende generische module_settings-Tabelle (module = 'commands'),
 * Wert ist ein JSON-Objekt { [commandName]: { enabled: bool, channel_ids: 'id1,id2' } }.
 * Kein Eintrag für einen Befehl = deaktiviert (bewusst: alles startet aus).
 */

function get(guildId) {
  const row = db.prepare('SELECT data FROM module_settings WHERE guild_id = ? AND module = ?').get(guildId, 'commands');
  if (!row) return {};
  try {
    const parsed = JSON.parse(row.data);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Einstellungen eines einzelnen Befehls, mit sicheren Standardwerten. */
function forCommand(guildId, name) {
  const c = get(guildId)[name];
  return { enabled: !!c?.enabled, channel_ids: c?.channel_ids || '' };
}

/** Ersetzt die komplette Befehls-Map eines Servers (Speichern der ganzen Seite auf einmal). */
function setAll(guildId, map) {
  const clean = {};
  for (const [name, cfg] of Object.entries(map || {})) {
    if (!name) continue;
    clean[name] = {
      enabled: !!cfg?.enabled,
      channel_ids: String(cfg?.channel_ids || '').split(',').map((s) => s.trim()).filter(Boolean).join(','),
    };
  }
  db.prepare(
    `INSERT INTO module_settings (guild_id, module, data, updated_at) VALUES (?, 'commands', ?, ?)
     ON CONFLICT(guild_id, module) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
  ).run(guildId, JSON.stringify(clean), Date.now());
  return clean;
}

module.exports = { get, forCommand, setAll };
