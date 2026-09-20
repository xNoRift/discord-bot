'use strict';

const embeds = require('../../utils/embeds');
const appModel = require('../../database/models/applications');
const applicationService = require('../../services/applicationService');
const flow = require('../../services/applicationFlowService');

/** Button "app:begin:<typeId>" – „Starten“ in der Bestätigung einer DM-Bewerbung. */
module.exports = {
  prefix: 'app:begin',
  async execute(interaction) {
    const type = appModel.getType(Number.parseInt(interaction.customId.split(':')[2], 10));
    const problem = interaction.member ? applicationService.eligibilityError(interaction.member, type, interaction.settings) : 'Nur auf einem Server möglich.';
    if (problem) return interaction.update({ embeds: [embeds.warning('Bewerbung nicht möglich', problem)], components: [] });

    await interaction.deferUpdate();
    try {
      await flow.start(interaction.user, interaction.guild, type);
      await interaction.editReply({
        embeds: [embeds.success('📨 Ich habe dir eine Direktnachricht geschickt', 'Beantworte die Fragen dort. Viel Erfolg!')],
        components: [],
      });
    } catch (err) {
      await interaction.editReply({ embeds: [embeds.error(undefined, err.message)], components: [] });
    }
  },
};
