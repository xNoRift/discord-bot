'use strict';

const ticketsModel = require('../database/models/tickets');
const ticketPanels = require('../database/models/ticketPanels');
const settingsModel = require('../database/models/settings');
const ticketService = require('../services/ticketService');
const { isSupport } = require('../utils/permissions');
const countingService = require('../services/countingService');
const suggestionService = require('../services/suggestionService');
const protectionService = require('../services/protectionService');
const levelService = require('../services/levelService');
const logger = require('../utils/logger');

/** Auto-Claim: Schreibt ein Teammitglied in ein freies Ticket, übernimmt es das Ticket. */
async function maybeAutoClaim(message, ticket) {
  if (ticket.claimed_by || !ticket.panel_id || message.author.id === ticket.opener_id || !message.member) return;
  const settings = settingsModel.get(message.guildId);
  if (!isSupport(message.member, settings, ticket)) return;
  const panel = ticketPanels.getPanel(ticket.panel_id);
  const cat = ticket.category_id ? ticketPanels.getCategory(ticket.category_id) : null;
  if (!ticketPanels.effectiveAuto(panel, cat).autoClaim) return;
  await ticketService.claimTicket(message.channel, message.member).catch((err) => logger.warn('[messageCreate] Auto-Claim:', err.message));
}

/**
 * - Aktualisiert den Aktivitätszeitstempel eines Tickets (Auto-Close).
 * - Verarbeitet das Zähl-Spiel im konfigurierten Kanal.
 * - Wandelt Nachrichten im Vorschläge-Kanal in Abstimmungs-Embeds um.
 */
module.exports = {
  name: 'messageCreate',
  async execute(message) {
    if (message.author?.bot || !message.inGuild()) return;

    try {
      await protectionService.onMessage(message);
    } catch (err) {
      logger.warn('[messageCreate] Guild Protection:', err.message);
    }

    try {
      const ticket = ticketsModel.getByChannel(message.channelId);
      if (ticket && ticket.status === 'open') {
        ticketsModel.touchByChannel(message.channelId);
        await maybeAutoClaim(message, ticket);
      }
    } catch {
      /* ignore */
    }

    try {
      await levelService.onMessage(message);
    } catch (err) {
      logger.warn('[messageCreate] Level:', err.message);
    }

    try {
      await countingService.handleMessage(message);
    } catch (err) {
      logger.warn('[messageCreate] Zähl-Spiel:', err.message);
    }

    try {
      await suggestionService.handleMessage(message);
    } catch (err) {
      logger.warn('[messageCreate] Vorschläge:', err.message);
    }
  },
};
