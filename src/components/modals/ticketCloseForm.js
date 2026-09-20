'use strict';

const { MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const i18n = require('../../utils/i18n');
const ticketService = require('../../services/ticketService');
const ticketsModel = require('../../database/models/tickets');

/**
 * Modal "ticket:closeform:<ticketId>" – Schließen-Formular einer Ticket-Kategorie.
 * Die Antworten landen im Schließen-Hinweis, im Log und im Transkript-Umfeld.
 */
module.exports = {
  prefix: 'ticket:closeform',
  async execute(interaction) {
    const tg = i18n.forGuild(interaction.guildId);
    const ticketId = Number.parseInt(interaction.customId.split(':')[2], 10);
    const ticket = ticketsModel.get(ticketId);
    const reply = (embed) => interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });

    if (!ticket || ticket.guild_id !== interaction.guildId || ticket.status !== 'open') {
      return reply(embeds.error(undefined, tg('tickets.errors.no_ticket_found')));
    }
    const denied = ticketService.closePermissionError(interaction.member, ticket, interaction.settings);
    if (denied) return reply(embeds.error(undefined, denied));

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const answers = ticketService.readModalAnswers(interaction.fields, ticketService.closeFormQuestions(ticket));
      const channel = interaction.guild.channels.cache.get(ticket.channel_id) ?? interaction.channel;
      await ticketService.closeTicket(channel, interaction.member, { answers });
      await interaction.editReply({ embeds: [embeds.success(tg('tickets.close.reply_title'), tg('tickets.close.reply_desc'))] });
    } catch (err) {
      await interaction.editReply({ embeds: [embeds.error(undefined, err.message)] });
    }
  },
};
