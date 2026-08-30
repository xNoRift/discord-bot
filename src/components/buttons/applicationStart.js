'use strict';

const { MessageFlags } = require('discord.js');

const embeds = require('../../utils/embeds');
const appModel = require('../../database/models/applications');
const applicationService = require('../../services/applicationService');

module.exports = {
  prefix: 'app:start',
  async execute(interaction) {
    const typeId = Number.parseInt(interaction.customId.split(':')[2], 10);
    const type = appModel.getType(typeId);

    if (!type || type.guild_id !== interaction.guildId || !type.enabled) {
      return interaction.reply({
        embeds: [embeds.error(undefined, 'Diese Bewerbungsart ist nicht verfügbar.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (!interaction.settings?.application_enabled) {
      return interaction.reply({
        embeds: [embeds.error(undefined, 'Das Bewerbungssystem ist derzeit deaktiviert.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (appModel.hasPending(interaction.guildId, interaction.user.id, typeId)) {
      return interaction.reply({
        embeds: [embeds.warning('Bereits beworben', 'Du hast bereits eine offene Bewerbung für diese Position.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const questions = appModel.listQuestions(typeId);
    if (!questions.length) {
      return interaction.reply({
        embeds: [embeds.error(undefined, 'Für diese Bewerbungsart wurden noch keine Fragen konfiguriert.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.showModal(applicationService.buildModal(type, questions));
  },
};
