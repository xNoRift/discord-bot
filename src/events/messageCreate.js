'use strict';

const ticketsModel = require('../database/models/tickets');
const countingService = require('../services/countingService');
const suggestionService = require('../services/suggestionService');
const automodService = require('../services/automodService');
const customCommandService = require('../services/customCommandService');
const logger = require('../utils/logger');

/**
 * - Prüft AutoMod-Filter (Spam, Links, Wortfilter, …) und löscht ggf. sofort.
 * - Führt Custom Commands aus (Prefix-Befehle).
 * - Aktualisiert den Aktivitätszeitstempel eines Tickets (Auto-Close).
 * - Verarbeitet das Zähl-Spiel im konfigurierten Kanal.
 * - Wandelt Nachrichten im Vorschläge-Kanal in Abstimmungs-Embeds um.
 */
module.exports = {
  name: 'messageCreate',
  async execute(message) {
    if (message.author?.bot || !message.inGuild()) return;

    try {
      const deleted = await automodService.handleMessage(message);
      if (deleted) return;
    } catch (err) {
      logger.warn('[messageCreate] AutoMod:', err.message);
    }

    try {
      const handled = await customCommandService.handleMessage(message);
      if (handled) return;
    } catch (err) {
      logger.warn('[messageCreate] Custom Command:', err.message);
    }

    try {
      const ticket = ticketsModel.getByChannel(message.channelId);
      if (ticket && ticket.status === 'open') {
        ticketsModel.touchByChannel(message.channelId);
      }
    } catch {
      /* ignore */
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
