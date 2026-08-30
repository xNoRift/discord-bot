'use strict';

const { MessageFlags } = require('discord.js');

const embeds = require('../../utils/embeds');
const ticketService = require('../../services/ticketService');
const { isSupport } = require('../../utils/permissions');

module.exports = {
  prefix: 'ticket:reopen',
  async execute(interaction) {
    if (!isSupport(interaction.member, interaction.settings)) {
      return interaction.reply({
        embeds: [embeds.error(undefined, 'Nur das Support-Team kann Tickets wieder öffnen.')],
        flags: MessageFlags.Ephemeral,
      });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      await ticketService.reopenTicket(interaction.channel, interaction.member);
      await interaction.editReply({ embeds: [embeds.success('🔓 Wieder geöffnet', 'Das Ticket ist wieder offen.')] });
    } catch (err) {
      await interaction.editReply({ embeds: [embeds.error(undefined, err.message)] });
    }
  },
};
