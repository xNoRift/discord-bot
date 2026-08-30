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
      return interaction.reply({ embeds: [embeds.error(undefined, 'Bewerbung nicht gefunden.')], flags: MessageFlags.Ephemeral });
    }
    if (!isApplicationTeam(interaction.member, interaction.settings)) {
      return interaction.reply({
        embeds: [embeds.error(undefined, 'Du bist nicht berechtigt, Bewerbungen zu bearbeiten.')],
        flags: MessageFlags.Ephemeral,
      });
    }
    if (application.status !== 'pending') {
      return interaction.reply({
        embeds: [embeds.warning('Bereits bearbeitet', 'Diese Bewerbung wurde bereits bearbeitet.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const modal = new ModalBuilder()
      .setCustomId(`app:review:${action}:${applicationId}`)
      .setTitle(action === 'accept' ? 'Bewerbung annehmen' : 'Bewerbung ablehnen')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('note')
            .setLabel('Nachricht an den Bewerber (optional)')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setMaxLength(1000),
        ),
      );

    await interaction.showModal(modal);
  },
};
