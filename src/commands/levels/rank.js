'use strict';

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const levels = require('../../database/models/levels');
const moduleSettings = require('../../database/models/moduleSettings');
const config = require('../../../config/config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Zeigt Level und XP an.')
    .addUserOption((o) => o.setName('nutzer').setDescription('Anderes Mitglied (optional)')),
  async execute(interaction) {
    if (!moduleSettings.get(interaction.guildId, 'levels').enabled) {
      return interaction.reply({ content: 'Das Level-System ist auf diesem Server nicht aktiv.', flags: MessageFlags.Ephemeral });
    }
    const user = interaction.options.getUser('nutzer') || interaction.user;
    const row = levels.get(interaction.guildId, user.id);
    if (!row) return interaction.reply({ content: `${user.username} hat noch keine XP gesammelt.`, flags: MessageFlags.Ephemeral });
    const { level, into, needed } = levels.levelInfo(interaction.guildId, row.xp);
    const embed = new EmbedBuilder()
      .setColor(config.branding.color)
      .setAuthor({ name: user.username, iconURL: user.displayAvatarURL() })
      .addFields(
        { name: 'Level', value: String(level), inline: true },
        { name: 'Rang', value: `#${levels.rankOf(interaction.guildId, user.id)}`, inline: true },
        { name: 'XP', value: needed ? `${into} / ${needed} (gesamt ${row.xp})` : `Höchstes Level erreicht (gesamt ${row.xp})`, inline: true },
        { name: 'Nachrichten', value: String(row.messages), inline: true },
        { name: 'Sprachzeit', value: `${row.voice_minutes} Min.`, inline: true },
      );
    return interaction.reply({ embeds: [embed] });
  },
};
