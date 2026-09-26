'use strict';

const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  MessageFlags,
} = require('discord.js');
const embeds = require('../../utils/embeds');
const appModel = require('../../database/models/applications');
const { isApplicationTeam } = require('../../utils/permissions');
const { L } = require('../../utils/i18n');

/**
 * Buttons "app:accept:<id>" und "app:reject:<id>".
 * Öffnen ein Modal für eine optionale Nachricht an den Bewerber.
 */
module.exports = {
  prefix: 'app',
  // wird über matchComponent auch für app:accept / app:reject getroffen
  async execute(interaction) {
    const [, action, idRaw] = interaction.customId.split(':');
    if (action !== 'accept' && action !== 'reject') return;

    const applicationId = Number.parseInt(idRaw, 10);
    const application = appModel.getApplication(applicationId);

    if (!application || application.guild_id !== interaction.guildId) {
      return interaction.reply({ embeds: [embeds.error(undefined, L('Bewerbung nicht gefunden.', 'Application not found.'))], flags: MessageFlags.Ephemeral });
    }
    if (!isApplicationTeam(interaction.member, interaction.settings, application)) {
      return interaction.reply({
        embeds: [embeds.error(undefined, L('Du bist nicht berechtigt, Bewerbungen zu bearbeiten.', 'You are not allowed to review applications.'))],
        flags: MessageFlags.Ephemeral,
      });
    }
    if (application.status !== 'pending') {
      return interaction.reply({
        embeds: [embeds.warning(L('Bereits bearbeitet', 'Already reviewed'), L('Diese Bewerbung wurde bereits bearbeitet.', 'This application has already been reviewed.'))],
        flags: MessageFlags.Ephemeral,
      });
    }

    const modal = new ModalBuilder()
      .setCustomId(`app:review:${action}:${applicationId}`)
      .setTitle(action === 'accept' ? L('Bewerbung annehmen', 'Accept application') : L('Bewerbung ablehnen', 'Reject application'))
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('note')
            .setLabel(L('Nachricht an den Bewerber (optional)', 'Message to the applicant (optional)'))
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setMaxLength(1000),
        ),
      );

    await interaction.showModal(modal);
  },
};
