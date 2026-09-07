'use strict';

const { MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const tempVoiceService = require('../../services/tempVoiceService');

/**
 * Auswahlmenüs des TempVoice-Interfaces:
 *   tempvoice:sel:region                 – StringSelect mit Regionen
 *   tempvoice:sel:permit|reject|block|unblock|disconnect – UserSelect
 */
module.exports = {
  prefix: 'tempvoice:sel',
  async execute(interaction) {
    const action = interaction.customId.split(':')[2];
    const channel = interaction.channel;

    const check = tempVoiceService.assertControl(channel?.id, interaction.member);
    if (!check.ok) {
      return interaction.update({ embeds: [embeds.error(undefined, check.reason)], components: [], content: '' }).catch(() =>
        interaction.reply({ embeds: [embeds.error(undefined, check.reason)], flags: MessageFlags.Ephemeral }),
      );
    }
    const { row } = check;

    try {
      let msg;
      if (action === 'region') {
        msg = await tempVoiceService.setRegion(channel, interaction.values[0]);
      } else {
        const targetId = interaction.values[0];
        if (action === 'permit') msg = await tempVoiceService.permitUser(channel, targetId);
        else if (action === 'reject') msg = await tempVoiceService.rejectUser(channel, targetId, row);
        else if (action === 'block') msg = await tempVoiceService.blockUser(channel, targetId, row);
        else if (action === 'unblock') msg = await tempVoiceService.unblockUser(channel, targetId);
        else if (action === 'disconnect') msg = await tempVoiceService.disconnectUser(channel, targetId, row);
        else msg = 'Unbekannte Aktion.';
      }
      await interaction.update({ embeds: [embeds.success(undefined, msg)], components: [], content: '' });
    } catch (err) {
      await interaction.update({ embeds: [embeds.error(undefined, err.message)], components: [], content: '' }).catch(() => null);
    }
  },
};
