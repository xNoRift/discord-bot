'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const config = require('../../../config/config');
const { L } = require('../../utils/i18n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Infos zum Bot und Link zum Dashboard.'),
  async execute(interaction) {
    const embed = embeds
      .brand(
        '🤖 ' + config.branding.name,
        L('Tickets, Giveaways, Bewerbungen, Willkommen, Moderation u. v. m. werden über das **Web-Dashboard** verwaltet.', 'Tickets, giveaways, applications, welcome messages, moderation and more are managed in the **web dashboard**.'),
      )
      .addFields(
        {
          name: L('🎵 Musik-Befehle', '🎵 Music commands'),
          value:
            '`/join` · `/play` · `/radio` · `/skip` · `/stop` · `/pause` · `/resume` · `/queue` · `/np` · `/volume` · `/loop` · `/shuffle` · `/leave`',
        },
        { name: L('🎫 Tickets · 🎉 Giveaways · 📋 Bewerbungen', '🎫 Tickets · 🎉 Giveaways · 📋 Applications'), value: L('Alles im Dashboard. Bewerben: `/apply`', 'Everything is in the dashboard. Apply: `/apply`') },
        { name: L('🌐 Dashboard öffnen', '🌐 Open dashboard'), value: config.dashboard.url },
      )
      .setFooter({ text: L('Anmeldung am Dashboard mit deinem Discord-Konto.', 'Log in to the dashboard with your Discord account.') });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
