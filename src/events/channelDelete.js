'use strict';

const antiNukeService = require('../services/antiNukeService');
const logger = require('../utils/logger');

module.exports = {
  name: 'channelDelete',
  async execute(channel) {
    try {
      await antiNukeService.onChannelDelete(channel);
    } catch (err) {
      logger.error('[channelDelete] Anti-Nuke:', err.message);
    }
  },
};
