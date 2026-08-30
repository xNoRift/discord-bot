'use strict';

const { MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const ticketService = require('../../services/ticketService');
const ticketPanels = require('../../database/models/ticketPanels');

/**
 * Button "ticket:open:<categoryId>" – erstellt ein Ticket für die gewählte Kategorie.
 * Hat die Kategorie ein Öffnen-Formular, wird zuerst ein Modal gezeigt.
 */
module.exports = {
  prefix: 'ticket:open',
  async execute(interaction) {
    const categoryId = Number.parseInt(interaction.customId.split(':')[2], 10);
    const cat = ticketPanels.getCategory(categoryId);
    if (!cat || cat.guild_id !== interaction.guildId) {
      return interaction.reply({
        embeds: [embeds.error(undefined, 'Diese Kategorie existiert nicht mehr.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const questions = ticketPanels.listQuestions(categoryId);
    if (questions.length) {
      return interaction.showModal(ticketService.buildTicketModal(cat, questions));
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const { channel } = await ticketService.createTicket(interaction.guild, interaction.member, { categoryId });
      await interaction.editReply({
        embeds: [embeds.success('🎫 Ticket erstellt', `Dein Ticket wurde erstellt: ${channel}`)],
      });
    } catch (err) {
      await interaction.editReply({ embeds: [embeds.error(undefined, err.message)] });
    }
  },
};
