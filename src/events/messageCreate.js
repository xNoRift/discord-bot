'use strict';

const ticketsModel = require('../database/models/tickets');

/**
 * Aktualisiert den Aktivitätszeitstempel eines Tickets, sobald jemand
 * (kein Bot) darin schreibt. Grundlage für die Auto-Close-Funktion.
 */
module.exports = {
  name: 'messageCreate',
  async execute(message) {
    if (message.author?.bot || !message.inGuild()) return;
    try {
      const ticket = ticketsModel.getByChannel(message.channelId);
      if (ticket && ticket.status === 'open') {
        ticketsModel.touchByChannel(message.channelId);
      }
    } catch {
      /* ignore */
    }
  },
};
