'use strict';

const { MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const i18n = require('../../utils/i18n');
const ticketService = require('../../services/ticketService');

/** Button "ticket:rate:<ticketId>:<stars>" */
module.exports = {
  prefix: 'ticket:rate',
  async execute(interaction) {
    const tg = i18n.forGuild(interaction.guildId);
    const [, , ticketId, stars] = interaction.customId.split(':');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      await ticketService.submitRating(
        interaction.guild,
        Number.parseInt(ticketId, 10),
        Number.parseInt(stars, 10),
        interaction.member,
      );
      await interaction.editReply({
        embeds: [embeds.success(tg('tickets.rating.thanks_title'), tg('tickets.rating.thanks_desc', { stars: '⭐'.repeat(Number(stars)) }))],
      });
      await interaction.message.edit({ components: [] }).catch(() => null);
    } catch (err) {
      await interaction.editReply({ embeds: [embeds.error(undefined, err.message)] });
    }
  },
};
