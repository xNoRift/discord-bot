'use strict';

const { MessageFlags } = require('discord.js');

const embeds = require('../../utils/embeds');
const appModel = require('../../database/models/applications');
const applicationService = require('../../services/applicationService');

module.exports = {
  prefix: 'app:modal',
  async execute(interaction) {
    const typeId = Number.parseInt(interaction.customId.split(':')[2], 10);
    const type = appModel.getType(typeId);

    if (!type || type.guild_id !== interaction.guildId) {
      return interaction.reply({ embeds: [embeds.error(undefined, 'Bewerbungsart nicht gefunden.')], flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const questions = appModel.listQuestions(typeId);
    const answers = questions.slice(0, applicationService.MAX_QUESTIONS).map((q) => {
      let value = '';
      try {
        value = interaction.fields.getTextInputValue(`q_${q.id}`);
      } catch {
        value = '';
      }
      return { question: q.label, answer: value };
    });

    try {
      const application = await applicationService.submitApplication(
        interaction.guild,
        { id: interaction.user.id, tag: interaction.user.tag },
        type,
        answers,
      );
      await interaction.editReply({
        embeds: [
          embeds.success(
            '📋 Bewerbung eingereicht',
            `Deine Bewerbung als **${type.name}** (#${application.id}) wurde an das Team weitergeleitet. Danke!`,
          ),
        ],
      });
    } catch (err) {
      await interaction.editReply({ embeds: [embeds.error(undefined, err.message)] });
    }
  },
};
