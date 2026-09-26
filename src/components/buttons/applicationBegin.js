'use strict';

const embeds = require('../../utils/embeds');
const appModel = require('../../database/models/applications');
const applicationService = require('../../services/applicationService');
const flow = require('../../services/applicationFlowService');
const { L } = require('../../utils/i18n');

/** Button "app:begin:<typeId>" – „Starten“ in der Bestätigung einer DM-Bewerbung. */
module.exports = {
  prefix: 'app:begin',
  async execute(interaction) {
    const type = appModel.getType(Number.parseInt(interaction.customId.split(':')[2], 10));
    const problem = interaction.member ? applicationService.eligibilityError(interaction.member, type, interaction.settings) : L('Nur auf einem Server möglich.', 'Only possible on a server.');
    if (problem) return interaction.update({ embeds: [embeds.warning(L('Bewerbung nicht möglich', 'Application not possible'), problem)], components: [] });

    await interaction.deferUpdate();
    try {
      await flow.start(interaction.user, interaction.guild, type);
      await interaction.editReply({
        embeds: [embeds.success(L('📨 Ich habe dir eine Direktnachricht geschickt', '📨 I sent you a direct message'), L('Beantworte die Fragen dort. Viel Erfolg!', 'Answer the questions there. Good luck!'))],
        components: [],
      });
    } catch (err) {
      await interaction.editReply({ embeds: [embeds.error(undefined, err.message)], components: [] });
    }
  },
};
