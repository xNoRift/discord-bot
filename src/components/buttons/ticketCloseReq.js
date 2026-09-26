'use strict';

const { MessageFlags } = require('discord.js');
const embeds = require('../../utils/embeds');
const ticketService = require('../../services/ticketService');
const ticketsModel = require('../../database/models/tickets');
const { isSupport } = require('../../utils/permissions');
const { L } = require('../../utils/i18n');

/**
 * Close-Request:
 *  - "ticket:closereq"                     -> Team fragt den Ersteller, ob das Ticket geschlossen werden kann
 *  - "ticket:closereq:accept:<ticketId>"   -> Ersteller (oder Team) bestätigt
 *  - "ticket:closereq:decline:<ticketId>"  -> Ersteller (oder Team) lehnt ab
 */
module.exports = {
  prefix: 'ticket:closereq',
  async execute(interaction) {
    const reply = (embed) => interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    const ticket = ticketsModel.getByChannel(interaction.channelId);
    if (!ticket) return reply(embeds.error(undefined, L('Dies ist kein Ticket-Kanal.', 'This is not a ticket channel.')));

    const support = isSupport(interaction.member, interaction.settings, ticket);
    const action = interaction.customId.split(':')[2];

    if (!action) {
      if (!support) return reply(embeds.error(undefined, L('Nur das Support-Team kann eine Close-Request senden.', 'Only the support team can send a close request.')));
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        await ticketService.requestClose(interaction.channel, interaction.member);
        return interaction.editReply({ embeds: [embeds.success(L('📨 Gesendet', '📨 Sent'), L('Der Ersteller wurde gefragt.', 'The creator has been asked.'))] });
      } catch (err) {
        return interaction.editReply({ embeds: [embeds.error(undefined, err.message)] });
      }
    }

    if (!support && interaction.user.id !== ticket.opener_id) {
      return reply(embeds.error(undefined, L('Nur der Ersteller oder das Team kann darauf antworten.', 'Only the creator or the team can answer this.')));
    }
    await interaction.deferUpdate();
    try {
      await interaction.message.edit({ components: [] }).catch(() => null);
      await ticketService.answerCloseRequest(interaction.channel, interaction.member, action === 'accept');
    } catch (err) {
      await interaction.followUp({ embeds: [embeds.error(undefined, err.message)], flags: MessageFlags.Ephemeral }).catch(() => null);
    }
  },
};
