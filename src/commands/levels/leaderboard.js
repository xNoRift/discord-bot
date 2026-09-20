'use strict';

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const levels = require('../../database/models/levels');
const moduleSettings = require('../../database/models/moduleSettings');
const config = require('../../../config/config');

module.exports = {
  data: new SlashCommandBuilder().setName('leaderboard').setDescription('Zeigt die Top 10 des Servers.'),
  async execute(interaction) {
    if (!moduleSettings.get(interaction.guildId, 'levels').enabled) {
      return interaction.reply({ content: 'Das Level-System ist auf diesem Server nicht aktiv.', flags: MessageFlags.Ephemeral });
    }
    const rows = levels.top(interaction.guildId, 10);
    const medals = ['🥇', '🥈', '🥉'];
    const text = rows.length
      ? rows.map((r, i) => `${medals[i] || `**${i + 1}.**`} <@${r.user_id}> – Level ${r.level} · ${r.xp} XP`).join('\n')
      : 'Noch niemand hat XP gesammelt.';
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(config.branding.color).setTitle('🏆 Rangliste').setDescription(text)],
      allowedMentions: { parse: [] },
    });
  },
};
