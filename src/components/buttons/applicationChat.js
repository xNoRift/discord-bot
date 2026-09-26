'use strict';

const { MessageFlags } = require('discord.js');

const embeds = require('../../utils/embeds');
const appModel = require('../../database/models/applications');
const applicationService = require('../../services/applicationService');
const { isApplicationTeam } = require('../../utils/permissions');
const { L } = require('../../utils/i18n');

/**
 * Button "app:chat:<id>" an der Bewerbungs-Nachricht:
 * öffnet einen privaten Chat (Ticket) mit dem Bewerber oder verweist auf den vorhandenen.
 */
module.exports = {
  prefix: 'app:chat',
  async execute(interaction) {
    const applicationId = Number.parseInt(interaction.customId.split(':')[2], 10);
    const application = appModel.getApplication(applicationId);

    if (!application || application.guild_id !== interaction.guildId) {
      return interaction.reply({ embeds: [embeds.error(undefined, L('Bewerbung nicht gefunden.', 'Application not found.'))], flags: MessageFlags.Ephemeral });
    }
    if (!isApplicationTeam(interaction.member, interaction.settings, application)) {
      return interaction.reply({
        embeds: [embeds.error(undefined, L('Du bist nicht berechtigt, Bewerber-Chats zu öffnen.', 'You are not allowed to open applicant chats.'))],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const { channel, created } = await applicationService.openChat(interaction.guild, application, {
        id: interaction.user.id,
      });
      await interaction.editReply({
        embeds: [
          embeds.success(
            created ? L('💬 Chat geöffnet', '💬 Chat opened') : L('💬 Chat bereits vorhanden', '💬 Chat already exists'),
            L('Der Chat mit {user} ist hier: {channel}', 'The chat with {user} is here: {channel}', { user: `<@${application.user_id}>`, channel: `<#${channel.id}>` }),
          ),
        ],
      });
    } catch (err) {
      await interaction.editReply({ embeds: [embeds.error(undefined, err.message)] });
    }
  },
};
