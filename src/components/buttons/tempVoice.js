'use strict';

const {
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require('discord.js');

const embeds = require('../../utils/embeds');
const tempVoiceService = require('../../services/tempVoiceService');
const tempVoice = require('../../database/models/tempVoice');

function ephemeral(interaction, text, ok = false) {
  const embed = ok ? embeds.success(undefined, text) : embeds.error(undefined, text);
  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

module.exports = {
  prefix: 'tempvoice:btn',
  async execute(interaction) {
    const action = interaction.customId.split(':')[2];
    const channel = interaction.channel;
    const row = tempVoice.get(channel?.id);
    if (!row) return ephemeral(interaction, 'Dieser Kanal ist kein temporärer Sprachkanal (mehr).');

    // Für "Übernehmen" gilt eine eigene Logik – sonst Besitzer/Manager-Check.
    if (action !== 'claim') {
      const check = tempVoiceService.assertControl(channel.id, interaction.member);
      if (!check.ok) return ephemeral(interaction, check.reason);
    }

    try {
      if (action === 'rename') {
        return interaction.showModal(
          new ModalBuilder()
            .setCustomId('tempvoice:modal:rename')
            .setTitle('Kanal umbenennen')
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId('name')
                  .setLabel('Neuer Kanalname')
                  .setStyle(TextInputStyle.Short)
                  .setMaxLength(100)
                  .setRequired(true),
              ),
            ),
        );
      }

      if (action === 'limit') {
        return interaction.showModal(
          new ModalBuilder()
            .setCustomId('tempvoice:modal:limit')
            .setTitle('User-Limit')
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId('limit')
                  .setLabel(`Anzahl (0 = kein Limit, max. ${tempVoiceService.MAX_LIMIT})`)
                  .setStyle(TextInputStyle.Short)
                  .setMaxLength(2)
                  .setRequired(true),
              ),
            ),
        );
      }

      if (action === 'lock') {
        const msg = await tempVoiceService.toggleLock(channel, row);
        return ephemeral(interaction, msg, true);
      }
      if (action === 'hide') {
        const msg = await tempVoiceService.toggleHide(channel, row);
        return ephemeral(interaction, msg, true);
      }
      if (action === 'claim') {
        const msg = await tempVoiceService.claim(channel, interaction.member);
        return interaction.reply({ embeds: [embeds.success(undefined, msg)] });
      }
      if (action === 'delete') {
        await interaction.reply({ embeds: [embeds.info(undefined, 'Kanal wird gelöscht …')], flags: MessageFlags.Ephemeral });
        return tempVoiceService.destroy(channel);
      }
      return ephemeral(interaction, 'Unbekannte Aktion.');
    } catch (err) {
      return ephemeral(interaction, err.message);
    }
  },
};
