'use strict';

const logger = require('../utils/logger');
const guildsModel = require('../database/models/guilds');
const settingsModel = require('../database/models/settings');
const notificationService = require('../services/notificationService');
const config = require('../../config/config');

module.exports = {
  name: 'guildCreate',
  async execute(guild) {
    logger.info(`[bot] Neuem Server beigetreten: ${guild.name} (${guild.id})`);
    guildsModel.upsertFromGuild(guild);
    settingsModel.ensure(guild.id);
    notificationService
      .notifyOwners('➕ Neuer Server', `**${guild.name}** (${guild.id})\nMitglieder: ${guild.memberCount ?? '?'}`, {
        color: config.branding.success,
      })
      .catch(() => null);
  },
};
