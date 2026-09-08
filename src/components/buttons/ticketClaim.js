'use strict';

const { MessageFlags } = require('discord.js');

const embeds = require('../../utils/embeds');
const i18n = require('../../utils/i18n');
const ticketService = require('../../services/ticketService');
const { isSupport } = require('../../utils/permissions');

module.exports = {
  prefix: 'ticket:claim',
  async execute(interaction) {
    const tg = i18n.forGuild(interaction.guildId);
    if (!isSupport(interaction.member, interaction.settings)) {
      return interaction.reply({
        embeds: [embeds.error(undefined, tg('tickets.errors.perm_claim'))],
        flags: MessageFlags.Ephemeral,
      });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      await ticketService.claimTicket(interaction.channel, interaction.member);
      await interaction.editReply({ embeds: [embeds.success(tg('tickets.claim.reply_title'), tg('tickets.claim.reply_desc'))] });
    } catch (err) {
      await interaction.editReply({ embeds: [embeds.error(undefined, err.message)] });
    }
  },
};
