'use strict';

const logger = require('../utils/logger');
const guildsModel = require('../database/models/guilds');
const settingsModel = require('../database/models/settings');
const scheduler = require('../services/schedulerService');
const presenceService = require('../services/presenceService');
const tempVoiceService = require('../services/tempVoiceService');

module.exports = {
  // discord.js >= 14.17 nutzt "clientReady"; ältere Versionen "ready".
  name: 'clientReady',
  once: true,
  async execute(client) {
    logger.success(`[bot] Eingeloggt als ${client.user.tag} (${client.user.id})`);
    logger.info(`[bot] Auf ${client.guilds.cache.size} Server(n) aktiv`);

    presenceService.apply();

    // Guilds + Settings in DB synchronisieren
    for (const guild of client.guilds.cache.values()) {
      try {
        guildsModel.upsertFromGuild(guild);
        settingsModel.ensure(guild.id);
      } catch (err) {
        logger.error(`[bot] Guild-Sync ${guild.id} fehlgeschlagen:`, err.message);
      }
    }

    // Scheduler starten (Giveaways + temporaere Rollen wiederherstellen)
    await scheduler.start();

    // Verwaiste Temp-Voice-Kanäle aufräumen
    await tempVoiceService.cleanup(client).catch((err) => logger.warn('[tempvoice] cleanup:', err.message));

    client.isReady && logger.success('[bot] Bereit.');
  },
};
