'use strict';

const { MessageFlags } = require('discord.js');

const embeds = require('../../utils/embeds');
const applicationService = require('../../services/applicationService');
const { isApplicationTeam } = require('../../utils/permissions');

module.exports = {
  prefix: 'app:review',
  async execute(interaction) {
    const parts = interaction.customId.split(':'); // app:review:<action>:<id>
    const action = parts[2];
    const applicationId = Number.parseInt(parts[3], 10);
    const decision = action === 'accept' ? 'accepted' : 'rejected';

    if (!isApplicationTeam(interaction.member, interaction.settings)) {
      return interaction.reply({
        embeds: [embeds.error(undefined, 'Du bist nicht berechtigt, Bewerbungen zu bearbeiten.')],
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
            ? embeds.success('✅ Bewerbung angenommen', `Bewerbung #${applicationId} wurde angenommen.${roleNote}`)
            : embeds.error('❌ Bewerbung abgelehnt', `Bewerbung #${applicationId} wurde abgelehnt.`),
        ],
      });
    } catch (err) {
      await interaction.editReply({ embeds: [embeds.error(undefined, err.message)] });
    }
  },
};
