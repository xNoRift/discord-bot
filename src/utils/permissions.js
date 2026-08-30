'use strict';

const { PermissionsBitField } = require('discord.js');
const config = require('../../config/config');

/**
 * Zentrale Berechtigungs-Checks fuer Bot-Interaktionen.
 * Alle Funktionen erwarten ein GuildMember-Objekt (discord.js).
 */

function isOwnerConfigured(userId) {
  return config.ownerIds.includes(String(userId));
}

/** Server-Administrator oder "Server verwalten"-Recht. */
function isManager(member) {
  if (!member) return false;
  if (isOwnerConfigured(member.id)) return true;
  return (
    member.permissions.has(PermissionsBitField.Flags.Administrator) ||
    member.permissions.has(PermissionsBitField.Flags.ManageGuild)
  );
}

/** Darf Tickets bearbeiten: Support-Rolle oder Manager. */
function isSupport(member, settings) {
  if (!member) return false;
  if (isManager(member)) return true;
  const roleId = settings?.ticket_support_role_id;
  return Boolean(roleId && member.roles.cache.has(roleId));
}

/** Darf Bewerbungen bearbeiten: Team-Rolle oder Manager. */
function isApplicationTeam(member, settings) {
  if (!member) return false;
  if (isManager(member)) return true;
  const roleId = settings?.application_team_role_id;
  return Boolean(roleId && member.roles.cache.has(roleId));
}

/**
 * Prueft, ob der Bot eine Rolle technisch vergeben/entfernen darf
 * (Manage Roles + Rollen-Hierarchie).
 * @returns {{ ok: boolean, reason?: string }}
 */
function botCanManageRole(guild, role) {
  const me = guild.members.me;
  if (!me) return { ok: false, reason: 'Bot-Member nicht geladen.' };
  if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    return { ok: false, reason: 'Dem Bot fehlt die Berechtigung "Rollen verwalten".' };
  }
  if (!role) return { ok: false, reason: 'Rolle nicht gefunden.' };
  if (role.managed) return { ok: false, reason: 'Diese Rolle wird von einer Integration verwaltet.' };
  if (role.comparePositionTo(me.roles.highest) >= 0) {
    return {
      ok: false,
      reason: 'Die Bot-Rolle steht in der Rollenliste nicht über der Zielrolle.',
    };
  }
  return { ok: true };
}

module.exports = {
  isOwnerConfigured,
  isManager,
  isSupport,
  isApplicationTeam,
  botCanManageRole,
};
