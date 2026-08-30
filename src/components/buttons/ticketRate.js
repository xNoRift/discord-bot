'use strict';

const { MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const ticketService = require('../../services/ticketService');

/** Button "ticket:rate:<ticketId>:<stars>" */
module.exports = {
  prefix: 'ticket:rate',
  async execute(interaction) {
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
        embeds: [embeds.success('Danke!', `Deine Bewertung (${'⭐'.repeat(Number(stars))}) wurde gespeichert.`)],
      });
      await interaction.message.edit({ components: [] }).catch(() => null);
    } catch (err) {
      await interaction.editReply({ embeds: [embeds.error(undefined, err.message)] });
    }
  },
};
