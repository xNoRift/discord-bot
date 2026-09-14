'use strict';

const { MessageFlags } = require('discord.js');

const embeds = require('../../utils/embeds');
const giveaways = require('../../database/models/giveaways');
const giveawayTicketButtons = require('../../database/models/giveawayTicketButtons');
const ticketService = require('../../services/ticketService');
const giveawayService = require('../../services/giveawayService');

/**
 * Modal "giveaway:ticketform:<giveawayId>:<buttonId>" – Formular für einen
 * Giveaway-Ticket-Button mit eigenen Fragen.
 */
module.exports = {
  prefix: 'giveaway:ticketform',
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

    const questions = btn ? giveawayTicketButtons.listQuestions(btn.id).slice(0, 5) : [];
    const answers = questions.map((q) => {
      let value = '';
      try {
        value = interaction.fields.getTextInputValue(`q_${q.id}`);
      } catch {
        value = '';
      }
      return { question: q.label, answer: value };
    });

    try {
      const { channel } = await ticketService.createTicket(interaction.guild, interaction.member, {
        overrides: giveawayService.ticketOverridesFor(giveaway, btn),
        answers,
      });
      await interaction.editReply({
        embeds: [embeds.success('Ticket erstellt', `Dein Ticket wurde erstellt: ${channel}`)],
      });
    } catch (err) {
      await interaction.editReply({ embeds: [embeds.error(undefined, err.message)] });
    }
  },
};
