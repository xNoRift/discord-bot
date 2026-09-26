'use strict';

const {
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  UserSelectMenuBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');

const embeds = require('../../utils/embeds');
const tempVoiceService = require('../../services/tempVoiceService');
const tempVoice = require('../../database/models/tempVoice');
const { L } = require('../../utils/i18n');

function ephemeral(interaction, text, ok = false) {
  const embed = ok ? embeds.success(undefined, text) : embeds.error(undefined, text);
  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

// Sprachserver-Regionen (Discord RTC-Region-IDs). "auto" = Automatisch. Als Funktion, damit die Sprache pro Server passt.
const regionOptions = () => [
  { label: L('Automatisch', 'Automatic'), value: 'auto', emoji: '🌍' },
  { label: 'Frankfurt', value: 'frankfurt' },
  { label: 'Rotterdam', value: 'rotterdam' },
  { label: 'Stockholm', value: 'stockholm' },
  { label: L('Finnland', 'Finland'), value: 'finland' },
  { label: 'Madrid', value: 'madrid' },
  { label: L('Mailand', 'Milan'), value: 'milan' },
  { label: L('Bukarest', 'Bucharest'), value: 'bucharest' },
  { label: L('Russland', 'Russia'), value: 'russia' },
  { label: L('US Ost', 'US East'), value: 'us-east' },
  { label: L('US Zentral', 'US Central'), value: 'us-central' },
  { label: L('US West', 'US West'), value: 'us-west' },
  { label: L('Singapur', 'Singapore'), value: 'singapore' },
  { label: 'Japan', value: 'japan' },
  { label: L('Indien', 'India'), value: 'india' },
  { label: 'Sydney', value: 'sydney' },
  { label: L('Brasilien', 'Brazil'), value: 'brazil' },
  { label: L('Südafrika', 'South Africa'), value: 'southafrica' },
];

// Aktion -> Text im ephemeren Auswahl-Prompt
const userPrompt = (action) =>
  ({
    permit: L('Wen möchtest du hinzufügen (Zugriff geben)?', 'Who do you want to add (give access)?'),
    reject: L('Wen möchtest du entfernen (Zugriff nehmen)?', 'Who do you want to remove (take access)?'),
    block: L('Wen möchtest du blockieren?', 'Who do you want to block?'),
    unblock: L('Wen möchtest du entblockieren?', 'Who do you want to unblock?'),
    disconnect: L('Wen möchtest du aus dem Kanal trennen?', 'Who do you want to disconnect from the channel?'),
  })[action];

module.exports = {
  prefix: 'tempvoice:btn',
  async execute(interaction) {
    const action = interaction.customId.split(':')[2];
    const channel =
      tempVoiceService.resolveUserChannel(interaction.member) ||
      (tempVoice.get(interaction.channel?.id) ? interaction.channel : null);
    if (!channel) {
      return ephemeral(interaction, L('Du sitzt in keinem eigenen Temp-Voice-Kanal. Betritt zuerst deinen Kanal.', 'You are not in your own temp voice channel. Join your channel first.'));
    }
    const row = tempVoice.get(channel.id);

    const check = tempVoiceService.assertControl(channel.id, interaction.member);
    if (!check.ok) return ephemeral(interaction, check.reason);

    try {
      if (action === 'rename') {
        return interaction.showModal(
          new ModalBuilder()
            .setCustomId('tempvoice:modal:rename')
            .setTitle(L('Kanal umbenennen', 'Rename channel'))
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
            .setTitle('Benutzerlimit')
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId('limit')
                  .setLabel(L('Anzahl (0 = kein Limit, max. {max})', 'Number (0 = no limit, max. {max})', { max: tempVoiceService.MAX_LIMIT }))
                  .setStyle(TextInputStyle.Short)
                  .setMaxLength(2)
                  .setRequired(true),
              ),
            ),
        );
      }

      if (action === 'lock') {
        return ephemeral(interaction, await tempVoiceService.toggleLock(channel, row), true);
      }
      if (action === 'hide') {
        return ephemeral(interaction, await tempVoiceService.toggleHide(channel, row), true);
      }
      if (action === 'delete') {
        await interaction.reply({ embeds: [embeds.info(undefined, L('Kanal wird gelöscht …', 'Deleting channel …'))], flags: MessageFlags.Ephemeral });
        return tempVoiceService.destroy(channel);
      }

      if (action === 'region') {
        return interaction.reply({
          content: L('Wähle die Sprachserver-Region:', 'Choose the voice server region:'),
          components: [
            new ActionRowBuilder().addComponents(
              new StringSelectMenuBuilder()
                .setCustomId('tempvoice:sel:region')
                .setPlaceholder('Region …')
                .addOptions(regionOptions()),
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
      }

      if (userPrompt(action)) {
        return interaction.reply({
          content: userPrompt(action),
          components: [
            new ActionRowBuilder().addComponents(
              new UserSelectMenuBuilder()
                .setCustomId(`tempvoice:sel:${action}`)
                .setPlaceholder(L('Mitglied wählen …', 'Choose a member …'))
                .setMinValues(1)
                .setMaxValues(1),
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
      }

      return ephemeral(interaction, L('Unbekannte Aktion.', 'Unknown action.'));
    } catch (err) {
      return ephemeral(interaction, err.message);
    }
  },
};
