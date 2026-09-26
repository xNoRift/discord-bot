'use strict';

const { PermissionsBitField } = require('discord.js');
const config = require('../../config/config');
const { L } = require('./i18n');

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

/**
 * Darf Tickets bearbeiten: Support-Rolle, Manager oder – wenn ein Ticket übergeben wird –
 * eine der Rollen, die für die Kategorie dieses Tickets zuständig sind.
 */
function isSupport(member, settings, ticket) {
  if (!member) return false;
  if (isManager(member)) return true;
  const roleId = settings?.ticket_support_role_id;
  if (roleId && member.roles.cache.has(roleId)) return true;
  // Bewerber-Chats werden vom Bewerbungs-Team betreut
  if (ticket?.application_id) {
    const application = require('../database/models/applications').getApplication(ticket.application_id);
    if (isApplicationTeam(member, settings, application)) return true;
  }
  if (ticket?.category_id) {
    const ticketPanels = require('../database/models/ticketPanels');
    const cat = ticketPanels.getCategory(ticket.category_id);
    if (cat) {
      const ids = [cat.support_role_id, ...String(ticketPanels.categoryCfg(cat).supportRoleIds || '').split(',')]
        .map((x) => String(x || '').trim())
        .filter(Boolean);
      if (ids.some((id) => member.roles.cache.has(id))) return true;
    }
  }
  return false;
}

/**
 * Darf Bewerbungen bearbeiten: Team-Rolle, Manager – oder (mit `application`) eine der
 * „Bewerbungs-Manager-Rollen“ dieser Bewerbung.
 */
function isApplicationTeam(member, settings, application) {
  if (!member) return false;
  if (isManager(member)) return true;
  const roleId = settings?.application_team_role_id;
  if (roleId && member.roles.cache.has(roleId)) return true;
  if (application?.type_id) {
    const appModel = require('../database/models/applications');
    const cfg = appModel.typeCfg(appModel.getType(application.type_id));
    return cfg.managerRoleIds.split(',').some((id) => id && member.roles.cache.has(id));
  }
  return false;
}

/**
 * Prueft, ob der Bot eine Rolle technisch vergeben/entfernen darf
 * (Manage Roles + Rollen-Hierarchie).
 * @returns {{ ok: boolean, reason?: string }}
 */
function botCanManageRole(guild, role) {
  const me = guild.members.me;
  if (!me) return { ok: false, reason: L('Bot-Mitglied nicht geladen.', 'Bot member not loaded.') };
  if (!me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    return { ok: false, reason: L('Dem Bot fehlt die Berechtigung „Rollen verwalten“.', 'The bot is missing the “Manage Roles” permission.') };
  }
  if (!role) return { ok: false, reason: L('Rolle nicht gefunden.', 'Role not found.') };
  if (role.managed) return { ok: false, reason: L('Diese Rolle wird von einer Integration verwaltet.', 'This role is managed by an integration.') };
  if (role.comparePositionTo(me.roles.highest) >= 0) {
    return {
      ok: false,
      reason: L('Die Bot-Rolle steht in der Rollenliste nicht über der Zielrolle.', 'The bot role is not above the target role in the role list.'),
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
