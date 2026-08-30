'use strict';

const logger = require('../utils/logger');
const guildsModel = require('../database/models/guilds');

module.exports = {
  name: 'guildDelete',
  async execute(guild) {
    logger.info(`[bot] Server verlassen: ${guild.name ?? guild.id}`);
    guildsModel.markLeft(guild.id);
  },
};
