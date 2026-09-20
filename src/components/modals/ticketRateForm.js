'use strict';

const { MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const i18n = require('../../utils/i18n');
const ticketService = require('../../services/ticketService');
const ticketPanels = require('../../database/models/ticketPanels');
const ticketsModel = require('../../database/models/tickets');

/**
 * Modal "ticket:rateform:<ticketId>:<stars>" – Bewertungs-Formular einer Ticket-Kategorie
 * (Kommentar und weitere Felder zur Sternebewertung).
 */
module.exports = {
  prefix: 'ticket:rateform',
  async execute(interaction) {
    const tg = i18n.forGuild(interaction.guildId);
    const [, , ticketId, stars] = interaction.customId.split(':');
    const ticket = ticketsModel.get(Number.parseInt(ticketId, 10));
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      if (!ticket || ticket.guild_id !== interaction.guildId) throw new Error(tg('tickets.errors.no_ticket_found'));
      const questions = ticketPanels.listQuestions(ticket.category_id, 'rating');
      const answers = ticketService.readModalAnswers(interaction.fields, questions);
      const n = Math.min(5, Math.max(1, Number.parseInt(stars, 10) || 1));
      await ticketService.submitRating(interaction.guild, ticket.id, n, interaction.member, answers);
      await interaction.editReply({
        embeds: [embeds.success(tg('tickets.rating.thanks_title'), tg('tickets.rating.thanks_desc', { stars: '⭐'.repeat(n) }))],
      });
      await interaction.message?.edit({ components: [] }).catch(() => null);
    } catch (err) {
      await interaction.editReply({ embeds: [embeds.error(undefined, err.message)] });
    }
  },
};
