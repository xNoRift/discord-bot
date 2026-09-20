'use strict';

const { MessageFlags } = require('discord.js');

const embeds = require('../../utils/embeds');
const i18n = require('../../utils/i18n');
const ticketService = require('../../services/ticketService');
const ticketsModel = require('../../database/models/tickets');
const ticketPanels = require('../../database/models/ticketPanels');

module.exports = {
  prefix: 'ticket:close',
  async execute(interaction) {
    const tg = i18n.forGuild(interaction.guildId);
    const ticket = ticketsModel.getByChannel(interaction.channelId);
    if (!ticket) {
      return interaction.reply({ embeds: [embeds.error(undefined, tg('tickets.errors.no_ticket_found'))], flags: MessageFlags.Ephemeral });
    }
    const denied = ticketService.closePermissionError(interaction.member, ticket, interaction.settings);
    if (denied) {
      return interaction.reply({ embeds: [embeds.error(undefined, denied)], flags: MessageFlags.Ephemeral });
    }
    // Hat die Kategorie ein Schließen-Formular, zuerst danach fragen.
    const closeQs = ticketService.closeFormQuestions(ticket);
    if (closeQs.length) {
      return interaction.showModal(ticketService.buildQuestionsModal(`ticket:closeform:${ticket.id}`, 'Ticket schließen', closeQs));
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      await ticketService.closeTicket(interaction.channel, interaction.member);
      await interaction.editReply({ embeds: [embeds.success(tg('tickets.close.reply_title'), tg('tickets.close.reply_desc'))] });
    } catch (err) {
      await interaction.editReply({ embeds: [embeds.error(undefined, err.message)] });
    }
  },
};
