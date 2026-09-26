'use strict';

const { MessageFlags } = require('discord.js');

const embeds = require('../../utils/embeds');
const appModel = require('../../database/models/applications');
const applicationService = require('../../services/applicationService');
const { isApplicationTeam } = require('../../utils/permissions');
const { L } = require('../../utils/i18n');

module.exports = {
  prefix: 'app:review',
  async execute(interaction) {
    const parts = interaction.customId.split(':'); // app:review:<action>:<id>
    const action = parts[2];
    const applicationId = Number.parseInt(parts[3], 10);
    const decision = action === 'accept' ? 'accepted' : 'rejected';

    if (!isApplicationTeam(interaction.member, interaction.settings, appModel.getApplication(applicationId))) {
      return interaction.reply({
        embeds: [embeds.error(undefined, L('Du bist nicht berechtigt, Bewerbungen zu bearbeiten.', 'You are not allowed to review applications.'))],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const note = interaction.fields.getTextInputValue('note')?.trim() || null;

    try {
      const { roleNote } = await applicationService.reviewApplication(
        interaction.guild,
        applicationId,
        { id: interaction.user.id, tag: interaction.user.tag },
        decision,
        note,
      );
      await interaction.editReply({
        embeds: [
          decision === 'accepted'
            ? embeds.success(L('✅ Bewerbung angenommen', '✅ Application accepted'), L('Bewerbung #{id} wurde angenommen.', 'Application #{id} has been accepted.', { id: applicationId }) + roleNote)
            : embeds.error(L('❌ Bewerbung abgelehnt', '❌ Application rejected'), L('Bewerbung #{id} wurde abgelehnt.', 'Application #{id} has been rejected.', { id: applicationId })),
        ],
      });
    } catch (err) {
      await interaction.editReply({ embeds: [embeds.error(undefined, err.message)] });
    }
  },
};
