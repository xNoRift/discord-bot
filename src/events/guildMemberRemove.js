'use strict';

const settingsModel = require('../database/models/settings');
const ticketsModel = require('../database/models/tickets');
const ticketService = require('../services/ticketService');
const logger = require('../utils/logger');

/**
 * "Aktion beim Verlassen" für Tickets: schließt oder löscht offene Tickets,
 * wenn der Ersteller den Server verlässt.
 */
module.exports = {
  name: 'guildMemberRemove',
  async execute(member) {
    try {
      const settings = settingsModel.get(member.guild.id);
      const action = settings.ticket_on_leave || 'nothing';
      if (action === 'nothing') return;

      const open = ticketsModel.listOpenByUser(member.guild.id, member.id);
      const me = member.guild.members.me;
      for (const ticket of open) {
        const channel =
          member.guild.channels.cache.get(ticket.channel_id) ??
          (await member.guild.channels.fetch(ticket.channel_id).catch(() => null));
        if (!channel) continue;
        await channel
          .send(`ℹ️ Der Ersteller (<@${member.id}>) hat den Server verlassen.`)
          .catch(() => null);
        if (action === 'delete') {
          await ticketService.deleteTicket(channel, me).catch((e) => logger.warn(`[onLeave] delete: ${e.message}`));
        } else if (action === 'close') {
          await ticketService.closeTicket(channel, me).catch((e) => logger.warn(`[onLeave] close: ${e.message}`));
        }
      }
    } catch (err) {
      logger.error('[guildMemberRemove]', err.message);
    }
  },
};
