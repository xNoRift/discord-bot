'use strict';

const { MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const ticketService = require('../../services/ticketService');
const ticketPanels = require('../../database/models/ticketPanels');

/**
 * Modal "ticket:form:<categoryId>" – Formular beim Öffnen eines Tickets.
 */
module.exports = {
  prefix: 'ticket:form',
  async execute(interaction) {
    const categoryId = Number.parseInt(interaction.customId.split(':')[2], 10);
    const cat = ticketPanels.getCategory(categoryId);
    if (!cat || cat.guild_id !== interaction.guildId) {
      return interaction.reply({
        embeds: [embeds.error(undefined, 'Kategorie nicht gefunden.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const questions = ticketPanels.listQuestions(categoryId).slice(0, 5);
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
        categoryId,
        answers,
      });
      await interaction.editReply({
        embeds: [embeds.success('🎫 Ticket erstellt', `Dein Ticket wurde erstellt: ${channel}`)],
      });
    } catch (err) {
      await interaction.editReply({ embeds: [embeds.error(undefined, err.message)] });
    }
  },
};
