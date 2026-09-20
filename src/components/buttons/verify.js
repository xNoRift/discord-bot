'use strict';

const { MessageFlags } = require('discord.js');
const moduleSettings = require('../../database/models/moduleSettings');

module.exports = {
  prefix: 'verify',
  async execute(interaction) {
    const reply = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
    const cfg = moduleSettings.get(interaction.guildId, 'verification');
    if (!cfg.enabled) return reply('Die Verifizierung ist gerade nicht aktiv.');
    const role = interaction.guild.roles.cache.get(cfg.roleId);
    if (!role) return reply('Die Verifizierungs-Rolle existiert nicht mehr. Bitte einen Admin informieren.');
    if (interaction.member.roles.cache.has(role.id)) return reply('Du bist bereits verifiziert. ✅');
    try {
      await interaction.member.roles.add(role, 'Verifizierung');
      if (cfg.removeRoleId && interaction.member.roles.cache.has(cfg.removeRoleId)) {
        await interaction.member.roles.remove(cfg.removeRoleId, 'Verifizierung').catch(() => null);
      }
    } catch {
      return reply('Ich konnte dir die Rolle nicht geben (die Bot-Rolle muss über der Rolle stehen). Bitte einen Admin informieren.');
    }
    return reply('Du wurdest verifiziert. Willkommen! 🎉');
  },
};
