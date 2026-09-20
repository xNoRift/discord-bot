'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const moduleSettings = require('../database/models/moduleSettings');
const moderationService = require('../services/moderationService');

/**
 * Baut einen Moderations-Slash-Command. Prüft Modul-Status und Rollenrechte
 * (Dashboard → Moderation → Berechtigungen), bevor `run` ausgeführt wird.
 */
function makeModCommand({ name, description, needs, extra, run }) {
  const builder = new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .setDMPermission(false)
    .addUserOption((o) => o.setName('nutzer').setDescription('Betroffenes Mitglied').setRequired(true));
  if (extra) extra(builder);

  return {
    data: builder,
    async execute(interaction) {
      const cfg = moduleSettings.get(interaction.guildId, 'moderation');
      const reply = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
      if (!cfg.enabled) return reply('Das Moderations-Modul ist auf diesem Server nicht aktiviert.');
      if (!moderationService.canUse(interaction.member, needs, cfg)) return reply('Dafür hast du keine Berechtigung.');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        const user = interaction.options.getUser('nutzer');
        const reason = interaction.options.getString('grund') || '';
        const text = await run({ interaction, user, reason });
        return interaction.editReply(text);
      } catch (err) {
        return interaction.editReply(`❌ ${err.message}`);
      }
    },
  };
}

const withReason = (b) => b.addStringOption((o) => o.setName('grund').setDescription('Grund').setMaxLength(400));

module.exports = { makeModCommand, withReason };
