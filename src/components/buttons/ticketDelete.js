'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const ticketService = require('../../services/ticketService');
const ticketsModel = require('../../database/models/tickets');
const { isSupport } = require('../../utils/permissions');

/**
 * "Löschen"-Button -> Sicherheitsabfrage.
 * "ticket:delete"         -> Bestätigungsbuttons anzeigen
 * "ticket:delete:confirm" -> endgültig löschen
 * "ticket:delete:cancel"  -> abbrechen
 */
module.exports = {
  prefix: 'ticket:delete',
  async execute(interaction) {
    if (!isSupport(interaction.member, interaction.settings)) {
      return interaction.reply({
        embeds: [embeds.error(undefined, 'Nur das Support-Team kann Tickets löschen.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const ticket = ticketsModel.getByChannel(interaction.channelId);
    if (!ticket) {
      return interaction.reply({ embeds: [embeds.error(undefined, 'Kein Ticket gefunden.')], flags: MessageFlags.Ephemeral });
    }

    const action = interaction.customId.split(':')[2]; // undefined | 'confirm' | 'cancel'

    if (action === 'cancel') {
      return interaction.update({
        embeds: [embeds.info('Abgebrochen', 'Das Ticket wird nicht gelöscht.')],
        components: [],
      });
    }

    if (action === 'confirm') {
      await interaction.update({
        embeds: [embeds.error('🗑️ Ticket wird gelöscht', 'Der Kanal wird jetzt entfernt…')],
        components: [],
      });
      await ticketService.deleteTicket(interaction.channel, interaction.member);
      return;
    }

    // Erste Stufe: Bestätigung anfordern
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ticket:delete:confirm')
        .setLabel('Endgültig löschen')
        .setEmoji('🗑️')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('ticket:delete:cancel')
        .setLabel('Abbrechen')
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.reply({
      embeds: [
        embeds.warning(
          '⚠️ Ticket wirklich löschen?',
          'Dies entfernt den Kanal **endgültig**. Das Ticket-Log bleibt erhalten.',
        ),
      ],
      components: [row],
      flags: MessageFlags.Ephemeral,
    });
  },
};
