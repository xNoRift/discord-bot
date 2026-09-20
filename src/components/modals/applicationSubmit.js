'use strict';

const { MessageFlags } = require('discord.js');

const embeds = require('../../utils/embeds');
const appModel = require('../../database/models/applications');
const applicationService = require('../../services/applicationService');

/** Modal "app:modal:<typeId>" – Bewerbung im Discord-Fenster abgegeben. */
module.exports = {
  prefix: 'app:modal',
  async execute(interaction) {
    const typeId = Number.parseInt(interaction.customId.split(':')[2], 10);
    const type = appModel.getType(typeId);

    if (!type || type.guild_id !== interaction.guildId) {
      return interaction.reply({ embeds: [embeds.error(undefined, 'Bewerbung nicht gefunden.')], flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const problem = applicationService.eligibilityError(interaction.member, type, interaction.settings);
    if (problem) return interaction.editReply({ embeds: [embeds.warning('Bewerbung nicht möglich', problem)] });

    const questions = appModel.listQuestions(typeId).slice(0, applicationService.MODAL_MAX_QUESTIONS);
    const answers = applicationService.readModal(interaction.fields, questions);

    try {
      const application = await applicationService.submitApplication(
        interaction.guild,
        { id: interaction.user.id, tag: interaction.user.tag },
        type,
        answers,
        { source: 'modal' },
      );
      const cfg = appModel.typeCfg(type);
      await interaction.editReply({
        embeds: [
          embeds.success(
            '📋 Bewerbung eingereicht',
            `${applicationService.fillTemplate(cfg.completionMessage, { applicationName: type.name, server: interaction.guild.name })}\n(#${application.id})`,
          ),
        ],
      });
    } catch (err) {
      await interaction.editReply({ embeds: [embeds.error(undefined, err.message)] });
    }
  },
};
