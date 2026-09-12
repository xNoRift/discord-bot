'use strict';

const { MessageFlags } = require('discord.js');

const embeds = require('../../utils/embeds');
const giveaways = require('../../database/models/giveaways');
const giveawayTicketButtons = require('../../database/models/giveawayTicketButtons');
const ticketService = require('../../services/ticketService');

module.exports = {
  prefix: 'giveaway:ticket',
  async execute(interaction) {
    const [, , giveawayIdRaw, buttonIdRaw] = interaction.customId.split(':');
    const giveawayId = Number.parseInt(giveawayIdRaw, 10);
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

    const btn = buttonIdRaw ? giveawayTicketButtons.get(Number.parseInt(buttonIdRaw, 10)) : null;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const { channel } = await ticketService.createTicket(interaction.guild, interaction.member, {
        overrides: {
          discordCategoryId: btn?.discord_category_id || undefined,
          supportRoleId: btn?.support_role_id || undefined,
          nameFormat: btn?.name_format || undefined,
          welcomeMessage: btn?.welcome_message || undefined,
          prize: btn && btn.show_prize === 0 ? undefined : giveaway.prize,
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
