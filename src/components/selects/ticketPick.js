'use strict';

const { MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const i18n = require('../../utils/i18n');
const ticketService = require('../../services/ticketService');
const ticketPanels = require('../../database/models/ticketPanels');

/**
 * Auswahlmenü "ticket:pick:<panelId>" – der Wert ist die gewählte Kategorie-ID.
 * Nach jeder Auswahl wird das Panel neu gezeichnet, damit im Menü wieder
 * "Wähle eine Kategorie ..." steht (statt der zuletzt gewählten Option).
 */
module.exports = {
  prefix: 'ticket:pick',
  async execute(interaction) {
    const tg = i18n.forGuild(interaction.guildId);
    const panelId = Number.parseInt(interaction.customId.split(':')[2], 10);
    const resetMenu = () =>
      ticketService.rerenderPanelMessage(interaction.message, panelId).catch(() => null);

    const categoryId = Number.parseInt(interaction.values[0], 10);
    const cat = ticketPanels.getCategory(categoryId);
    if (!cat || cat.guild_id !== interaction.guildId) {
      await resetMenu();
      return interaction.reply({
        embeds: [embeds.error(undefined, tg('tickets.errors.category_no_longer'))],
        flags: MessageFlags.Ephemeral,
      });
    }

    const questions = ticketPanels.listQuestions(categoryId);
    if (questions.length) {
      await interaction.showModal(ticketService.buildTicketModal(cat, questions));
      await resetMenu();
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const { channel } = await ticketService.createTicket(interaction.guild, interaction.member, { categoryId });
      await interaction.editReply({
        embeds: [embeds.success(tg('tickets.created_reply_title'), tg('tickets.created_reply_desc', { channel }))],
      });
    } catch (err) {
      await interaction.editReply({ embeds: [embeds.error(undefined, err.message)] });
    } finally {
      await resetMenu();
    }
  },
};
