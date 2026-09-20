'use strict';

const { MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const i18n = require('../../utils/i18n');
const ticketService = require('../../services/ticketService');
const ticketPanels = require('../../database/models/ticketPanels');
const ticketsModel = require('../../database/models/tickets');

/**
 * Button "ticket:rate:<ticketId>:<stars>".
 * Hat die Kategorie ein Bewertungs-Formular, folgt danach ein Modal (Kommentar u. a.).
 */
module.exports = {
  prefix: 'ticket:rate',
  async execute(interaction) {
    const tg = i18n.forGuild(interaction.guildId);
    const [, , ticketId, stars] = interaction.customId.split(':');
    const ticket = ticketsModel.get(Number.parseInt(ticketId, 10));

    const questions = ticket?.category_id ? ticketPanels.listQuestions(ticket.category_id, 'rating') : [];
    if (questions.length) {
      return interaction.showModal(
        ticketService.buildQuestionsModal(`ticket:rateform:${ticketId}:${stars}`, 'Deine Bewertung', questions),
      );
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      await ticketService.submitRating(
        interaction.guild,
        Number.parseInt(ticketId, 10),
        Number.parseInt(stars, 10),
        interaction.member,
      );
      await interaction.editReply({
        embeds: [embeds.success(tg('tickets.rating.thanks_title'), tg('tickets.rating.thanks_desc', { stars: '⭐'.repeat(Number(stars)) }))],
      });
      await interaction.message.edit({ components: [] }).catch(() => null);
    } catch (err) {
      await interaction.editReply({ embeds: [embeds.error(undefined, err.message)] });
    }
  },
};
