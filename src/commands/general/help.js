'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const config = require('../../../config/config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Infos zum Bot und Link zum Dashboard.'),
  async execute(interaction) {
    const embed = embeds
      .brand(
        '🤖 ' + config.branding.name,
        'Tickets, Giveaways, Bewerbungen, Willkommen, Moderation u. v. m. werden über das **Web-Dashboard** verwaltet.',
      )
      .addFields(
        {
          name: '🎵 Musik-Befehle',
          value:
            '`/play` · `/radio` · `/skip` · `/stop` · `/pause` · `/resume` · `/queue` · `/np` · `/volume` · `/loop` · `/shuffle` · `/leave`',
        },
        { name: '🎫 Tickets · 🎉 Giveaways · 📋 Bewerbungen', value: 'Alles im Dashboard.' },
        { name: '🌐 Dashboard öffnen', value: config.dashboard.url },
      )
      .setFooter({ text: 'Anmeldung am Dashboard mit deinem Discord-Konto.' });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
