'use strict';

const { MessageFlags } = require('discord.js');

const embeds = require('../../utils/embeds');
const tempVoiceService = require('../../services/tempVoiceService');

module.exports = {
  prefix: 'tempvoice:modal',
  async execute(interaction) {
    const action = interaction.customId.split(':')[2];
    const channel = interaction.channel;

    const check = tempVoiceService.assertControl(channel?.id, interaction.member);
    if (!check.ok) {
      return interaction.reply({ embeds: [embeds.error(undefined, check.reason)], flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      let msg;
      if (action === 'rename') {
        msg = await tempVoiceService.rename(channel, interaction.fields.getTextInputValue('name'));
      } else if (action === 'limit') {
        msg = await tempVoiceService.setLimit(channel, interaction.fields.getTextInputValue('limit'));
      } else {
        msg = 'Unbekannte Aktion.';
      }
      await interaction.editReply({ embeds: [embeds.success(undefined, msg)] });
    } catch (err) {
      await interaction.editReply({ embeds: [embeds.error(undefined, err.message)] });
    }
  },
};
