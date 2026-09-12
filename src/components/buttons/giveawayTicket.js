'use strict';

const { MessageFlags } = require('discord.js');

const embeds = require('../../utils/embeds');
const giveaways = require('../../database/models/giveaways');
const settingsModel = require('../../database/models/settings');
const ticketService = require('../../services/ticketService');

module.exports = {
  prefix: 'giveaway:ticket',
  async execute(interaction) {
    const giveawayId = Number.parseInt(interaction.customId.split(':')[2], 10);
    const giveaway = giveaways.get(giveawayId);

    if (!giveaway) {
      return interaction.reply({
        embeds: [embeds.error(undefined, 'Dieses Giveaway wurde nicht gefunden.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const winnerIds = JSON.parse(giveaway.winners_json || '[]');
    if (!winnerIds.includes(interaction.user.id)) {
      return interaction.reply({
        embeds: [embeds.error('Nicht möglich', 'Nur Gewinner dieses Giveaways können hierüber ein Ticket erstellen.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const settings = settingsModel.get(interaction.guildId);
      const { channel } = await ticketService.createTicket(interaction.guild, interaction.member, {
        overrides: {
          discordCategoryId: settings.giveaway_ticket_category_id || undefined,
          supportRoleId: settings.giveaway_ticket_support_role_id || undefined,
          nameFormat: settings.giveaway_ticket_name_format || undefined,
          welcomeMessage: settings.giveaway_ticket_welcome_message || undefined,
        },
      });
      await interaction.editReply({
        embeds: [embeds.success('Ticket erstellt', `Dein Ticket wurde erstellt: ${channel}`)],
      });
    } catch (err) {
      await interaction.editReply({ embeds: [embeds.error(undefined, err.message)] });
    }
  },
};
