'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const appModel = require('../../database/models/applications');
const applicationService = require('../../services/applicationService');

/** /apply – sich auf eine offene Bewerbung des Servers bewerben. */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('apply')
    .setDescription('Auf eine Bewerbung dieses Servers bewerben')
    .setDMPermission(false)
    .addStringOption((o) =>
      o.setName('bewerbung').setDescription('Wofür möchtest du dich bewerben?').setRequired(true).setAutocomplete(true),
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const list = appModel
      .listTypes(interaction.guildId, { onlyEnabled: true })
      .filter((t) => t.name.toLowerCase().includes(focused))
      .slice(0, 25)
      .map((t) => ({ name: t.name.slice(0, 100), value: String(t.id) }));
    await interaction.respond(list);
  },

  async execute(interaction) {
    const typeId = Number.parseInt(interaction.options.getString('bewerbung'), 10);
    if (!Number.isFinite(typeId)) {
      return interaction.reply({ embeds: [embeds.error(undefined, 'Bitte wähle eine Bewerbung aus der Liste.')], flags: MessageFlags.Ephemeral });
    }
    await applicationService.beginApplication(interaction, typeId);
  },
};
