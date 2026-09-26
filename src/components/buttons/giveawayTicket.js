'use strict';

const { MessageFlags } = require('discord.js');

const embeds = require('../../utils/embeds');
const giveaways = require('../../database/models/giveaways');
const giveawayTicketButtons = require('../../database/models/giveawayTicketButtons');
const ticketService = require('../../services/ticketService');
const giveawayService = require('../../services/giveawayService');
const { L } = require('../../utils/i18n');

module.exports = {
  prefix: 'giveaway:ticket',
  async execute(interaction) {
    const [, , giveawayIdRaw, buttonIdRaw] = interaction.customId.split(':');
    const giveawayId = Number.parseInt(giveawayIdRaw, 10);
    const giveaway = giveaways.get(giveawayId);

    if (!giveaway) {
      return interaction.reply({
        embeds: [embeds.error(undefined, L('Dieses Giveaway wurde nicht gefunden.', 'This giveaway was not found.'))],
        flags: MessageFlags.Ephemeral,
      });
    }

    const winnerIds = JSON.parse(giveaway.winners_json || '[]');
    if (!winnerIds.includes(interaction.user.id)) {
      return interaction.reply({
        embeds: [embeds.error(L('Nicht möglich', 'Not possible'), L('Nur Gewinner dieses Giveaways können hierüber ein Ticket erstellen.', 'Only winners of this giveaway can create a ticket here.'))],
        flags: MessageFlags.Ephemeral,
      });
    }

    const btn = buttonIdRaw ? giveawayTicketButtons.get(Number.parseInt(buttonIdRaw, 10)) : null;

    const questions = btn ? giveawayTicketButtons.listQuestions(btn.id) : [];
    if (questions.length) {
      return interaction.showModal(
        ticketService.buildQuestionsModal(`giveaway:ticketform:${giveawayId}:${btn.id}`, `Ticket: ${btn.label}`, questions),
      );
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const { channel } = await ticketService.createTicket(interaction.guild, interaction.member, {
        overrides: giveawayService.ticketOverridesFor(giveaway, btn),
      });
      await interaction.editReply({
        embeds: [embeds.success(L('Ticket erstellt', 'Ticket created'), L('Dein Ticket wurde erstellt: {channel}', 'Your ticket has been created: {channel}', { channel: String(channel) }))],
      });
    } catch (err) {
      await interaction.editReply({ embeds: [embeds.error(undefined, err.message)] });
    }
  },
};
