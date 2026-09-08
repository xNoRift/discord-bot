'use strict';

const { MessageFlags } = require('discord.js');

const embeds = require('../../utils/embeds');
const i18n = require('../../utils/i18n');
const ticketService = require('../../services/ticketService');

module.exports = {
  prefix: 'ticket:create',
  async execute(interaction) {
    const tg = i18n.forGuild(interaction.guildId);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const { channel } = await ticketService.createTicket(interaction.guild, interaction.member);
      await interaction.editReply({
        embeds: [embeds.success(tg('tickets.created_reply_title'), tg('tickets.created_reply_desc', { channel }))],
      });
    } catch (err) {
      await interaction.editReply({ embeds: [embeds.error(undefined, err.message)] });
    }
  },
};
