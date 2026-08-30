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
        'Dieser Bot wird komplett über das **Web-Dashboard** verwaltet – es gibt (außer diesem) keine Befehle.',
      )
      .addFields(
        { name: '🎫 Tickets', value: 'Panel, Kategorie, Support-Rolle, Logs – alles im Dashboard.' },
        { name: '🎉 Giveaways', value: 'Erstellen, beenden, neu auslosen, Gewinnerrolle – alles im Dashboard.' },
        { name: '📋 Bewerbungen', value: 'Bewerbungsarten, Fragen, Panel, Annehmen/Ablehnen – alles im Dashboard.' },
        { name: '🌐 Dashboard öffnen', value: config.dashboard.url },
      )
      .setFooter({ text: 'Anmeldung am Dashboard mit deinem Discord-Konto.' });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
