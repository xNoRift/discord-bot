'use strict';

const settingsModel = require('../database/models/settings');
const { botCanManageRole } = require('../utils/permissions');
const logService = require('./logService');
const logger = require('../utils/logger');
const config = require('../../config/config');

/**
 * Auto-Rolle: vergibt neuen Mitgliedern automatisch konfigurierte Rollen.
 * Benötigt den privilegierten "Server Members"-Intent.
 */

function idsFor(settings, isBot) {
  const raw = isBot ? settings.autorole_bot_ids : settings.autorole_ids;
  return String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * @param {import('discord.js').GuildMember} member
 */
async function applyOnJoin(member) {
  if (member.pending) return; // wartet noch auf Regelzustimmung -> beim "guildMemberUpdate" erneut
  const settings = settingsModel.get(member.guild.id);
  const roleIds = idsFor(settings, member.user.bot);
  if (!roleIds.length) return;

  const added = [];
  for (const roleId of roleIds) {
    const role = member.guild.roles.cache.get(roleId);
    if (!role) continue;
    if (member.roles.cache.has(roleId)) continue;
    const can = botCanManageRole(member.guild, role);
    if (!can.ok) {
      logger.warn(`[autorole] ${role.name}: ${can.reason}`);
      continue;
    }
    await member.roles.add(role, 'Auto-Rolle').then(() => added.push(role)).catch((err) =>
      logger.warn(`[autorole] roles.add fehlgeschlagen: ${err.message}`),
    );
  }

  if (added.length) {
    await logService.log({
      guildId: member.guild.id,
      category: 'general',
      type: 'autorole',
      title: '➕ Auto-Rolle vergeben',
      color: config.branding.success,
      fields: [
        { name: 'Mitglied', value: `<@${member.id}>`, inline: true },
        { name: 'Rollen', value: added.map((r) => `<@&${r.id}>`).join(', '), inline: true },
      ],
      targetId: member.id,
    });
  }
}

/**
 * Vergibt die Auto-Rollen einmalig an ALLE passenden Mitglieder.
 * @param {import('discord.js').Guild} guild
 * @returns {Promise<{ humans: number, bots: number }>}
 */
async function applyToAll(guild) {
  const settings = settingsModel.get(guild.id);
  const humanRoles = idsFor(settings, false);
  const botRoles = idsFor(settings, true);
  if (!humanRoles.length && !botRoles.length) return { humans: 0, bots: 0 };

  const members = await guild.members.fetch();
  let humans = 0;
  let bots = 0;

  for (const member of members.values()) {
    const roleIds = member.user.bot ? botRoles : humanRoles;
    if (!roleIds.length) continue;
    let changed = false;
    for (const roleId of roleIds) {
      const role = guild.roles.cache.get(roleId);
      if (!role || member.roles.cache.has(roleId)) continue;
      if (!botCanManageRole(guild, role).ok) continue;
      await member.roles.add(role, 'Auto-Rolle (nachträglich)').then(() => {
        changed = true;
      }).catch(() => null);
    }
    if (changed) {
      if (member.user.bot) bots++;
      else humans++;
    }
  }

  return { humans, bots };
}

module.exports = { applyOnJoin, applyToAll };
