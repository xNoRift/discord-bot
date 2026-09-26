'use strict';

const { EmbedBuilder, MessageFlags } = require('discord.js');

const embeds = require('../../utils/embeds');
const giveaways = require('../../database/models/giveaways');
const config = require('../../../config/config');
const { L } = require('../../utils/i18n');

const MAX_SHOWN = 60;

module.exports = {
  prefix: 'giveaway:list',
  async execute(interaction) {
    const giveawayId = Number.parseInt(interaction.customId.split(':')[2], 10);
    const giveaway = giveaways.get(giveawayId);

    if (!giveaway) {
      return interaction.reply({
        embeds: [embeds.error(undefined, L('Dieses Giveaway wurde nicht gefunden.', 'This giveaway was not found.'))],
        flags: MessageFlags.Ephemeral,
      });
    }

    const entryIds = giveaways.getEntries(giveawayId);
    const count = entryIds.length;
    const shown = entryIds.slice(0, MAX_SHOWN);
    const more = count - shown.length;

    const isIn = entryIds.includes(interaction.user.id);
    const chance = isIn && count > 0 ? Math.min(100, (giveaway.winner_count / count) * 100) : 0;

    const embed = new EmbedBuilder()
      .setColor(config.branding.color)
      .setTitle(`👥 Teilnehmer – ${giveaway.prize}`)
      .setDescription(
        count
          ? shown.map((id) => `<@${id}>`).join(', ') + (more > 0 ? '\n' + L('… und {n} weitere', '… and {n} more', { n: more }) : '')
          : L('Noch keine Teilnahmen.', 'No entries yet.'),
      )
      .addFields(
        { name: L('Teilnehmer', 'Entrants'), value: String(count), inline: true },
        { name: L('Gewinner', 'Winners'), value: String(giveaway.winner_count), inline: true },
        {
          name: 'Deine Gewinnchance',
          value: isIn ? `${chance.toFixed(1).replace(/\.0$/, '')} %` : L('Du nimmst noch nicht teil', 'You haven\'t entered yet'),
          inline: true,
        },
      );

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
