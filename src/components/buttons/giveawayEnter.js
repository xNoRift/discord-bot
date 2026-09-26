'use strict';

const { MessageFlags } = require('discord.js');

const embeds = require('../../utils/embeds');
const giveaways = require('../../database/models/giveaways');
const giveawayService = require('../../services/giveawayService');
const { L } = require('../../utils/i18n');

module.exports = {
  prefix: 'giveaway:enter',
  async execute(interaction) {
    const giveawayId = Number.parseInt(interaction.customId.split(':')[2], 10);
    const giveaway = giveaways.get(giveawayId);

    if (!giveaway || giveaway.ended || giveaway.cancelled) {
      return interaction.reply({
        embeds: [embeds.error(undefined, L('Dieses Giveaway ist nicht mehr aktiv.', 'This giveaway is no longer active.'))],
        flags: MessageFlags.Ephemeral,
      });
    }

    // Rollen-Voraussetzung pruefen
    if (giveaway.required_role_id && !interaction.member.roles.cache.has(giveaway.required_role_id)) {
      return interaction.reply({
        embeds: [embeds.error(L('Teilnahme nicht möglich', 'Cannot enter'), L('Du benötigst die Rolle {role}, um teilzunehmen.', 'You need the role {role} to enter.', { role: `<@&${giveaway.required_role_id}>` }))],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (giveaways.hasEntry(giveawayId, interaction.user.id)) {
      giveaways.removeEntry(giveawayId, interaction.user.id);
      await interaction.reply({
        embeds: [embeds.warning(L('Teilnahme zurückgezogen', 'Entry withdrawn'), L('Du nimmst nicht mehr an diesem Giveaway teil.', 'You are no longer entered in this giveaway.'))],
        flags: MessageFlags.Ephemeral,
      });
    } else {
      giveaways.addEntry(giveawayId, interaction.user.id);
      await interaction.reply({
        embeds: [embeds.success(L('🎉 Du bist dabei!', '🎉 You\'re in!'), L('Du nimmst jetzt an **{prize}** teil. Viel Glück!', 'You have entered **{prize}**. Good luck!', { prize: giveaway.prize }))],
        flags: MessageFlags.Ephemeral,
      });
    }

    await giveawayService.refreshGiveawayMessage(giveawayId).catch(() => null);
  },
};
