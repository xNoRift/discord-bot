'use strict';

const db = require('../db');

/**
 * Welche Discord-Rollen dürfen (zusätzlich zu Administrator/"Server
 * verwalten"/Bot-Besitzer) welchen Dashboard-Bereich sehen.
 *
 * WICHTIG: Diese Tabelle steuert aktuell nur einen ZUSÄTZLICHEN Check
 * innerhalb der Moderations-Routen (requireScope in middleware/auth.js).
 * Der grundsätzliche Zugriff aufs Dashboard (loadGuild) verlangt weiterhin
 * Administrator/"Server verwalten" – ein reines Rollen-Mitglied ohne diese
 * Discord-Rechte kommt damit noch nicht ins Dashboard rein. Das Auflösen
 * dieser Einschränkung ist ein bewusst separater, eigener Schritt (siehe
 * Plan), damit nicht in einem Rutsch jede Route im Dashboard neu geprüft
 * werden muss.
 */

const SCOPES = ['moderation', 'tickets', 'giveaways', 'applications', 'settings'];

function listForGuild(guildId) {
  return db.prepare('SELECT * FROM guild_dashboard_roles WHERE guild_id = ?').all(guildId);
}

function getRolesForScope(guildId, scope) {
  return db
    .prepare('SELECT role_id FROM guild_dashboard_roles WHERE guild_id = ? AND scope = ?')
    .all(guildId, scope)
    .map((r) => r.role_id);
}

/** Ersetzt die Rollenliste für einen Bereich komplett (leeres Array = Bereich hat keine Extra-Rollen). */
function setRolesForScope(guildId, scope, roleIds) {
  if (!SCOPES.includes(scope)) throw new Error('Unbekannter Bereich.');
  const clean = [...new Set((roleIds || []).filter((r) => /^\d{5,25}$/.test(String(r))))];
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM guild_dashboard_roles WHERE guild_id = ? AND scope = ?').run(guildId, scope);
    const insert = db.prepare('INSERT INTO guild_dashboard_roles (guild_id, scope, role_id) VALUES (?, ?, ?)');
    for (const roleId of clean) insert.run(guildId, scope, roleId);
  });
  tx();
  return clean;
}

/** Hält dieses Mitglied eine der für `scope` freigeschalteten Rollen? */
function memberHasScope(member, guildId, scope) {
  const roleIds = getRolesForScope(guildId, scope);
  return roleIds.some((rid) => member.roles.cache.has(rid));
}

module.exports = { SCOPES, listForGuild, getRolesForScope, setRolesForScope, memberHasScope };
