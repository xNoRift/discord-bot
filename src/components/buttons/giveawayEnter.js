'use strict';

const { MessageFlags } = require('discord.js');

const embeds = require('../../utils/embeds');
const giveaways = require('../../database/models/giveaways');
const giveawayService = require('../../services/giveawayService');

module.exports = {
  prefix: 'giveaway:enter',
  async execute(interaction) {
    const giveawayId = Number.parseInt(interaction.customId.split(':')[2], 10);
    const giveaway = giveaways.get(giveawayId);

    if (!giveaway || giveaway.ended || giveaway.cancelled) {
      return interaction.reply({
        embeds: [embeds.error(undefined, 'Dieses Giveaway ist nicht mehr aktiv.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    // Rollen-Voraussetzung pruefen
    if (giveaway.required_role_id && !interaction.member.roles.cache.has(giveaway.required_role_id)) {
      return interaction.reply({
        embeds: [embeds.error('Teilnahme nicht möglich', `Du benötigst die Rolle <@&${giveaway.required_role_id}>, um teilzunehmen.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (giveaways.hasEntry(giveawayId, interaction.user.id)) {
      giveaways.removeEntry(giveawayId, interaction.user.id);
      await interaction.reply({
        embeds: [embeds.warning('Teilnahme zurückgezogen', 'Du nimmst nicht mehr an diesem Giveaway teil.')],
        flags: MessageFlags.Ephemeral,
      });
    } else {
      giveaways.addEntry(giveawayId, interaction.user.id);
      await interaction.reply({
        embeds: [embeds.success('🎉 Du bist dabei!', `Du nimmst jetzt an **${giveaway.prize}** teil. Viel Glück!`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    await giveawayService.refreshGiveawayMessage(giveawayId).catch(() => null);
  },
};
