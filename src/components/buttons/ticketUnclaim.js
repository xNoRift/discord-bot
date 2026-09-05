'use strict';

const { MessageFlags } = require('discord.js');

const embeds = require('../../utils/embeds');
const ticketService = require('../../services/ticketService');
const ticketsModel = require('../../database/models/tickets');
const { isSupport } = require('../../utils/permissions');

module.exports = {
  prefix: 'ticket:unclaim',
  async execute(interaction) {
    const ticket = ticketsModel.getByChannel(interaction.channelId);
    const isClaimer = ticket && ticket.claimed_by === interaction.user.id;
    if (!isClaimer && !isSupport(interaction.member, interaction.settings)) {
      return interaction.reply({
        embeds: [embeds.error(undefined, 'Nur das Support-Team (oder wer das Ticket übernommen hat) kann es freigeben.')],
        flags: MessageFlags.Ephemeral,
      });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      await ticketService.unclaimTicket(interaction.channel, interaction.member);
      await interaction.editReply({ embeds: [embeds.success('📌 Freigegeben', 'Das Ticket ist wieder frei.')] });
    } catch (err) {
      await interaction.editReply({ embeds: [embeds.error(undefined, err.message)] });
    }
  },
};
