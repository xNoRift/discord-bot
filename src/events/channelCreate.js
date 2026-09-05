'use strict';

const antiNukeService = require('../services/antiNukeService');
const logger = require('../utils/logger');

module.exports = {
  name: 'channelCreate',
  async execute(channel) {
    try {
      await antiNukeService.onChannelCreate(channel);
    } catch (err) {
      logger.error('[channelCreate] Anti-Nuke:', err.message);
    }
  },
};
