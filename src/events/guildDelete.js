'use strict';

const logger = require('../utils/logger');
const guildsModel = require('../database/models/guilds');
const notificationService = require('../services/notificationService');
const config = require('../../config/config');

module.exports = {
  name: 'guildDelete',
  async execute(guild) {
    logger.info(`[bot] Server verlassen: ${guild.name ?? guild.id}`);
    guildsModel.markLeft(guild.id);
    notificationService
      .notifyOwners('➖ Server verlassen', `**${guild.name ?? guild.id}** (${guild.id})`, {
        color: config.branding.warning,
      })
      .catch(() => null);
  },
};
