'use strict';

const { MessageFlags } = require('discord.js');

const embeds = require('../../utils/embeds');
const i18n = require('../../utils/i18n');
const ticketService = require('../../services/ticketService');
const ticketsModel = require('../../database/models/tickets');
const { isSupport } = require('../../utils/permissions');

module.exports = {
  prefix: 'ticket:unclaim',
  async execute(interaction) {
    const tg = i18n.forGuild(interaction.guildId);
    const ticket = ticketsModel.getByChannel(interaction.channelId);
    const isClaimer = ticket && ticket.claimed_by === interaction.user.id;
    if (!isClaimer && !isSupport(interaction.member, interaction.settings)) {
      return interaction.reply({
        embeds: [embeds.error(undefined, tg('tickets.replies.perm_unclaim_full'))],
        flags: MessageFlags.Ephemeral,
      });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      await ticketService.unclaimTicket(interaction.channel, interaction.member);
      await interaction.editReply({ embeds: [embeds.success(tg('tickets.replies.unclaimed_title'), tg('tickets.replies.unclaimed_desc'))] });
    } catch (err) {
      await interaction.editReply({ embeds: [embeds.error(undefined, err.message)] });
    }
  },
};
