'use strict';

const logger = require('../utils/logger');
const guildsModel = require('../database/models/guilds');
const settingsModel = require('../database/models/settings');

module.exports = {
  name: 'guildCreate',
  async execute(guild) {
    logger.info(`[bot] Neuem Server beigetreten: ${guild.name} (${guild.id})`);
    guildsModel.upsertFromGuild(guild);
    settingsModel.ensure(guild.id);
  },
};
