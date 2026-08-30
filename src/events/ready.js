'use strict';

const { ActivityType } = require('discord.js');
const logger = require('../utils/logger');
const guildsModel = require('../database/models/guilds');
const settingsModel = require('../database/models/settings');
const scheduler = require('../services/schedulerService');

module.exports = {
  // discord.js >= 14.17 nutzt "clientReady"; ältere Versionen "ready".
  name: 'clientReady',
  once: true,
  async execute(client) {
    logger.success(`[bot] Eingeloggt als ${client.user.tag} (${client.user.id})`);
    logger.info(`[bot] Auf ${client.guilds.cache.size} Server(n) aktiv`);

    client.user.setPresence({
      status: 'online',
      activities: [{ name: '/help • Dashboard', type: ActivityType.Watching }],
    });

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

    client.isReady && logger.success('[bot] Bereit.');
  },
};
