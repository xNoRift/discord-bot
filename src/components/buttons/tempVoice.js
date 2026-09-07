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

function ephemeral(interaction, text, ok = false) {
  const embed = ok ? embeds.success(undefined, text) : embeds.error(undefined, text);
  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

// Sprachserver-Regionen (Discord RTC-Region-IDs). "auto" = Automatisch.
const REGION_OPTIONS = [
  { label: 'Automatisch', value: 'auto', emoji: '🌍' },
  { label: 'Frankfurt', value: 'frankfurt' },
  { label: 'Rotterdam', value: 'rotterdam' },
  { label: 'Stockholm', value: 'stockholm' },
  { label: 'Finnland', value: 'finland' },
  { label: 'Madrid', value: 'madrid' },
  { label: 'Mailand', value: 'milan' },
  { label: 'Bukarest', value: 'bucharest' },
  { label: 'Russland', value: 'russia' },
  { label: 'US Ost', value: 'us-east' },
  { label: 'US Zentral', value: 'us-central' },
  { label: 'US West', value: 'us-west' },
  { label: 'Singapur', value: 'singapore' },
  { label: 'Japan', value: 'japan' },
  { label: 'Indien', value: 'india' },
  { label: 'Sydney', value: 'sydney' },
  { label: 'Brasilien', value: 'brazil' },
  { label: 'Südafrika', value: 'southafrica' },
];

// Aktion -> Text im ephemeren Auswahl-Prompt
const USER_PROMPTS = {
  permit: 'Wen möchtest du hinzufügen (Zugriff geben)?',
  reject: 'Wen möchtest du entfernen (Zugriff nehmen)?',
  block: 'Wen möchtest du blockieren?',
  unblock: 'Wen möchtest du entblockieren?',
  disconnect: 'Wen möchtest du aus dem Kanal trennen?',
};

module.exports = {
  prefix: 'tempvoice:btn',
  async execute(interaction) {
    const action = interaction.customId.split(':')[2];
    const channel = interaction.channel;
    const row = tempVoice.get(channel?.id);
    if (!row) return ephemeral(interaction, 'Dieser Kanal ist kein temporärer Sprachkanal (mehr).');

    // "Übernehmen" hat eigene Logik – sonst Besitzer/Manager-Check.
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
            .setTitle('Benutzerlimit')
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
        return ephemeral(interaction, await tempVoiceService.toggleLock(channel, row), true);
      }
      if (action === 'hide') {
        return ephemeral(interaction, await tempVoiceService.toggleHide(channel, row), true);
      }
      if (action === 'claim') {
        const msg = await tempVoiceService.claim(channel, interaction.member);
        return interaction.reply({ embeds: [embeds.success(undefined, msg)] });
      }
      if (action === 'delete') {
        await interaction.reply({ embeds: [embeds.info(undefined, 'Kanal wird gelöscht …')], flags: MessageFlags.Ephemeral });
        return tempVoiceService.destroy(channel);
      }

      if (action === 'region') {
        return interaction.reply({
          content: 'Wähle die Sprachserver-Region:',
          components: [
            new ActionRowBuilder().addComponents(
              new StringSelectMenuBuilder()
                .setCustomId('tempvoice:sel:region')
                .setPlaceholder('Region …')
                .addOptions(REGION_OPTIONS),
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
      }

      if (USER_PROMPTS[action]) {
        return interaction.reply({
          content: USER_PROMPTS[action],
          components: [
            new ActionRowBuilder().addComponents(
              new UserSelectMenuBuilder()
                .setCustomId(`tempvoice:sel:${action}`)
                .setPlaceholder('Mitglied wählen …')
                .setMinValues(1)
                .setMaxValues(1),
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
      }

      return ephemeral(interaction, 'Unbekannte Aktion.');
    } catch (err) {
      return ephemeral(interaction, err.message);
    }
  },
};
