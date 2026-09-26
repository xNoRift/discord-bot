'use strict';

const { MessageFlags } = require('discord.js');
const moduleSettings = require('../../database/models/moduleSettings');
const { L } = require('../../utils/i18n');

module.exports = {
  prefix: 'verify',
  async execute(interaction) {
    const reply = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
    const cfg = moduleSettings.get(interaction.guildId, 'verification');
    if (!cfg.enabled) return reply(L('Die Verifizierung ist gerade nicht aktiv.', 'Verification is not active right now.'));
    const role = interaction.guild.roles.cache.get(cfg.roleId);
    if (!role) return reply(L('Die Verifizierungs-Rolle existiert nicht mehr. Bitte einen Admin informieren.', 'The verification role no longer exists. Please let an admin know.'));
    if (interaction.member.roles.cache.has(role.id)) return reply(L('Du bist bereits verifiziert. ✅', 'You are already verified. ✅'));
    try {
      await interaction.member.roles.add(role, 'Verifizierung');
      if (cfg.removeRoleId && interaction.member.roles.cache.has(cfg.removeRoleId)) {
        await interaction.member.roles.remove(cfg.removeRoleId, 'Verifizierung').catch(() => null);
      }
    } catch {
      return reply(L('Ich konnte dir die Rolle nicht geben (die Bot-Rolle muss über der Rolle stehen). Bitte einen Admin informieren.', 'I couldn\'t give you the role (the bot role must be above it). Please let an admin know.'));
    }
    return reply(L('Du wurdest verifiziert. Willkommen! 🎉', 'You have been verified. Welcome! 🎉'));
  },
};
