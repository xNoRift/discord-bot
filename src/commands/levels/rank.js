'use strict';

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const levels = require('../../database/models/levels');
const moduleSettings = require('../../database/models/moduleSettings');
const config = require('../../../config/config');
const { L } = require('../../utils/i18n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Zeigt Level und XP an.')
    .addUserOption((o) => o.setName('nutzer').setDescription('Anderes Mitglied (optional)')),
  async execute(interaction) {
    if (!moduleSettings.get(interaction.guildId, 'levels').enabled) {
      return interaction.reply({ content: L('Das Level-System ist auf diesem Server nicht aktiv.', 'The level system is not enabled on this server.'), flags: MessageFlags.Ephemeral });
    }
    const user = interaction.options.getUser('nutzer') || interaction.user;
    const row = levels.get(interaction.guildId, user.id);
    if (!row) return interaction.reply({ content: L('{user} hat noch keine XP gesammelt.', '{user} has not earned any XP yet.', { user: user.username }), flags: MessageFlags.Ephemeral });
    const { level, into, needed } = levels.levelInfo(interaction.guildId, row.xp);
    const embed = new EmbedBuilder()
      .setColor(config.branding.color)
      .setAuthor({ name: user.username, iconURL: user.displayAvatarURL() })
      .addFields(
        { name: 'Level', value: String(level), inline: true },
        { name: L('Rang', 'Rank'), value: `#${levels.rankOf(interaction.guildId, user.id)}`, inline: true },
        { name: 'XP', value: needed ? `${into} / ${needed} (${L('gesamt', 'total')} ${row.xp})` : L('Höchstes Level erreicht (gesamt {xp})', 'Max level reached (total {xp})', { xp: row.xp }), inline: true },
        { name: L('Nachrichten', 'Messages'), value: String(row.messages), inline: true },
        { name: L('Sprachzeit', 'Voice time'), value: `${row.voice_minutes} ${L('Min.', 'min')}`, inline: true },
      );
    return interaction.reply({ embeds: [embed] });
  },
};
