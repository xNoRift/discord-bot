'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const i18n = require('../../utils/i18n');
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
    const tg = i18n.forGuild(interaction.guildId);
    if (!isSupport(interaction.member, interaction.settings)) {
      return interaction.reply({
        embeds: [embeds.error(undefined, tg('tickets.replies.perm_delete'))],
        flags: MessageFlags.Ephemeral,
      });
    }

    const ticket = ticketsModel.getByChannel(interaction.channelId);
    if (!ticket) {
      return interaction.reply({ embeds: [embeds.error(undefined, tg('tickets.errors.no_ticket_found'))], flags: MessageFlags.Ephemeral });
    }

    const action = interaction.customId.split(':')[2]; // undefined | 'confirm' | 'cancel'

    if (action === 'cancel') {
      return interaction.update({
        embeds: [embeds.info(tg('tickets.delete_confirm.cancelled_title'), tg('tickets.delete_confirm.cancelled_desc'))],
        components: [],
      });
    }

    if (action === 'confirm') {
      await interaction.update({
        embeds: [embeds.error(tg('tickets.delete_confirm.deleting_title'), tg('tickets.delete_confirm.deleting_desc'))],
        components: [],
      });
      await ticketService.deleteTicket(interaction.channel, interaction.member);
      return;
    }

    // Erste Stufe: Bestätigung anfordern
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ticket:delete:confirm')
        .setLabel(tg('tickets.delete_confirm.confirm_label'))
        .setEmoji('🗑️')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('ticket:delete:cancel')
        .setLabel(tg('tickets.delete_confirm.cancel_label'))
        .setStyle(ButtonStyle.Secondary),
    );

    await interaction.reply({
      embeds: [embeds.warning(tg('tickets.delete_confirm.prompt_title'), tg('tickets.delete_confirm.prompt_desc'))],
      components: [row],
      flags: MessageFlags.Ephemeral,
    });
  },
};
