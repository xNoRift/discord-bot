'use strict';

const modmailService = require('../../services/modmailService');

/**
 * Auswahlmenü "modmail:guild" (in der DM) – der Nutzer wählt den Server,
 * an den seine ModMail-Anfrage gehen soll.
 */
module.exports = {
  prefix: 'modmail:guild',
  async execute(interaction) {
    await modmailService.resolveGuildChoice(interaction);
  },
};
