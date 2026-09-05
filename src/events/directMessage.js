'use strict';

const { ChannelType } = require('discord.js');
const modmailService = require('../services/modmailService');
const logger = require('../utils/logger');

/**
 * ModMail-Relay. Läuft als ZWEITER messageCreate-Listener (mehrere Event-Dateien
 * mit demselben Namen sind erlaubt – alle feuern).
 *  - DM an den Bot  -> in den passenden ModMail-Ticket-Kanal spiegeln / Ticket öffnen
 *  - Nachricht im ModMail-Ticket-Kanal -> als DM an den Nutzer weiterleiten
 */
module.exports = {
  name: 'messageCreate',
  async execute(message) {
    if (message.author?.bot) return;
    if (message.system) return;

    try {
      if (message.channel?.type === ChannelType.DM || !message.inGuild()) {
        await modmailService.relayDmToChannel(message);
      } else {
        await modmailService.relayChannelToDm(message);
      }
    } catch (err) {
      logger.warn('[modmail] Relay fehlgeschlagen:', err.message);
    }
  },
};
