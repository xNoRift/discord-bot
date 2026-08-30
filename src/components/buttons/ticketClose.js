'use strict';

const { MessageFlags } = require('discord.js');

const embeds = require('../../utils/embeds');
const ticketService = require('../../services/ticketService');
const ticketsModel = require('../../database/models/tickets');
const { isSupport } = require('../../utils/permissions');

module.exports = {
  prefix: 'ticket:close',
  async execute(interaction) {
    const ticket = ticketsModel.getByChannel(interaction.channelId);
    if (!ticket) {
      return interaction.reply({ embeds: [embeds.error(undefined, 'Kein Ticket gefunden.')], flags: MessageFlags.Ephemeral });
    }
    const support = isSupport(interaction.member, interaction.settings);
    if (interaction.settings?.ticket_close_restricted === 1 && !support) {
      return interaction.reply({
        embeds: [embeds.error(undefined, 'Nur Teammitglieder können Tickets schließen.')],
        flags: MessageFlags.Ephemeral,
      });
    }
    if (!support && interaction.user.id !== ticket.opener_id) {
      return interaction.reply({
        embeds: [embeds.error(undefined, 'Nur das Support-Team oder der Ersteller kann das Ticket schließen.')],
        flags: MessageFlags.Ephemeral,
      });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      await ticketService.closeTicket(interaction.channel, interaction.member);
      await interaction.editReply({ embeds: [embeds.success('🔒 Geschlossen', 'Das Ticket wurde geschlossen.')] });
    } catch (err) {
      await interaction.editReply({ embeds: [embeds.error(undefined, err.message)] });
    }
  },
};
