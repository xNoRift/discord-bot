'use strict';

const { MessageFlags } = require('discord.js');

const embeds = require('../../utils/embeds');
const ticketService = require('../../services/ticketService');

module.exports = {
  prefix: 'ticket:create',
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const { channel } = await ticketService.createTicket(interaction.guild, interaction.member);
      await interaction.editReply({
        embeds: [embeds.success('🎫 Ticket erstellt', `Dein Ticket wurde erstellt: ${channel}`)],
      });
    } catch (err) {
      await interaction.editReply({ embeds: [embeds.error(undefined, err.message)] });
    }
  },
};
